import json
from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch

from commentary_polish import MATERIALS, estimate_speech_seconds, merge_texts, messages_for, polish_plan, unwrap, request_completion
from commentary_plan import model_config


class PolishTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'summary': '突破分球', 'events': [{'eventId': 'e', 'description': '传球后命中', 'evidenceFrames': [10]}],
                     'uncertainties': ['姓名未知'], 'cues': [
                         {'cueId': 'c1', 'eventId': 'e', 'text': '传球后命中。', 'suggestedStartTime': 1,
                          'suggestedEndTime': 5, 'delivery': 'during_play', 'evidenceFrames': [10]}]}

    def test_only_text_changes_with_same_ids_even_if_return_order_changes(self):
        before = deepcopy(self.plan)
        result = merge_texts(self.plan, {'cues': [{'cueId': 'c1', 'text': '这球喂得舒服！'}]})
        result['cues'][0]['text'] = before['cues'][0]['text']
        self.assertEqual(result, before)
        self.assertEqual(self.plan, before)
        for rows in ([], [{'cueId': 'unknown', 'text': '球进了。'}],
                     [{'cueId': 'c1', 'text': '球进了。', 'suggestedStartTime': 0}],
                     [{'cueId': 'c1', 'text': '球进了。'}] * 2):
            with self.assertRaises(ValueError):
                merge_texts(self.plan, {'cues': rows})

    def test_mixed_language_duration_and_invalid_input(self):
        self.assertGreater(estimate_speech_seconds('Oh my god！球进了。'), estimate_speech_seconds('球进了。'))
        self.plan['cues'][0]['suggestedEndTime'] = 2
        with self.assertRaisesRegex(ValueError, '只有'):
            merge_texts(self.plan, {'cues': [{'cueId': 'c1', 'text': 'Oh my god！这球竟然还能打进！'}]})
        self.plan['cues'][0]['suggestedEndTime'] = float('nan')
        with self.assertRaises(ValueError):
            unwrap(self.plan)

    def test_materials_actually_reach_model_and_ablation_removes_cards(self):
        full = messages_for(self.plan)
        self.assertIn('BBQ Chicken', full[0]['content'])
        self.assertIn('姓名未知', full[1]['content'])
        self.assertNotIn('BBQ Chicken', messages_for(self.plan, False)[0]['content'])
        cards = json.loads((MATERIALS / 'basketball-memes.json').read_text(encoding='utf-8'))
        self.assertEqual(len(cards), len({c['id'] for c in cards}))
        self.assertTrue(all(c.get('source') and c.get('when') and c.get('avoid') for c in cards))

    def test_pause_budget_allows_small_variation_but_not_long_monologues(self):
        self.plan['cues'][0]['delivery'] = 'pause'
        merge_texts(self.plan, {'cues': [{'cueId': 'c1', 'text': '这球喂得舒服，接球就进！'}]})
        with self.assertRaisesRegex(ValueError, '暂停句'):
            merge_texts(self.plan, {'cues': [{'cueId': 'c1', 'text': '这球喂得舒服，接球就进！' * 5}]})

    def test_identity_nodes_and_config_survive_text_polish_and_reach_prompt(self):
        self.plan.update(planId='host-plan', revision=2, digest='saved-only',
                         producerConfigSnapshot=model_config(), participants=[{'participantId': 'P1-f10',
                            'entityId': 'P1', 'displayName': 'Alice', 'nameRecordRef': 'named-record',
                            'validRange': {'startFrame': 10, 'endFrame': 12}, 'identityStatus': 'machine_accepted', 'identityVerified': False}],
                         nodes=[{'nodeId': 'n1', 'eventId': 'e', 'cueIds': ['c1'], 'anchorAssetFrame': 10}])
        self.plan['cues'][0].update(participantRefs=['P1-f10'], nameRecordRefs=['named-record'])
        before = deepcopy(self.plan)
        edited = merge_texts(self.plan, {'cues': [{'cueId': 'c1', 'text': '这球喂得舒服！'}]})
        edited['cues'][0]['text'] = before['cues'][0]['text']
        self.assertEqual(edited, before)
        inputs = json.loads(messages_for(self.plan)[1]['content'])
        self.assertEqual(inputs['participants'][0]['displayName'], 'Alice')
        self.assertEqual(inputs['cues'][0]['nameRecordRefs'], ['named-record'])
        self.assertEqual(inputs['nodes'][0]['anchorAssetFrame'], 10)

    @patch('commentary_polish.urllib.request.urlopen')
    def test_request_uses_locked_real_model_capabilities_without_astra_reasoning(self, urlopen):
        locked = model_config({'model': 'test/vision', 'reasoning': 'off',
            'modelCapabilities': {'input': ['text', 'image'], 'reasoning': False, 'contextWindow': 32000, 'maxTokens': 4000}})
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self): return json.dumps({'model': 'test/vision', 'choices': [{'finish_reason': 'stop', 'message': {'content': '{}'}}]}).encode()
        urlopen.return_value = Response()
        _, meta = request_completion([], 'fake-key', 'test/vision', locked)
        body = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(body['model'], 'test/vision')
        self.assertEqual(body['max_tokens'], 4000)
        self.assertNotIn('reasoning', body)
        self.assertEqual(meta['model'], 'test/vision')

    @patch('commentary_polish.provider_environment', return_value=({}, 'test-secret'))
    def test_one_targeted_repair_and_bounded_failure(self, env):
        calls = []
        def complete(messages, key, model):
            calls.append(deepcopy(messages))
            content = '{}' if len(calls) == 1 else json.dumps({'cues': [{'cueId': 'c1', 'text': '这球喂得舒服！'}]})
            return content, {'elapsedSeconds': 1, 'model': model, 'usage': {}}
        result = polish_plan(self.plan, Path('.env'), complete=complete)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result['originalPlan'], self.plan)
        self.assertIn('validationError', result['polish']['attempts'][0])
        self.assertIn('只修正', calls[1][-1]['content'])
        with self.assertRaisesRegex(ValueError, '两次'):
            polish_plan(self.plan, Path('.env'), complete=lambda *args: ('{}', {'elapsedSeconds': 1}))


if __name__ == '__main__':
    unittest.main()
