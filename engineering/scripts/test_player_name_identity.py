"""Focused checks for bounded player-name proposals and provider separation."""
import base64
import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import ssl
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from player_name_identity import (REPO_ROOT, TokenPlanVision, OpenRouterVision, _effective_ranges, _select_evidence,
                                  _resolve_team, create_qwen_token_plan_provider, recognize_player_names,
                                  apply_reference_slot_identities, _safe_request_error, _jpeg_request_payload)


class FakeTactics:
    def frames(self, video, clip, indices):
        image = Image.new('RGB', (100, 120), 'white')
        output = io.BytesIO(); image.save(output, 'JPEG')
        value = 'data:image/jpeg;base64,' + base64.b64encode(output.getvalue()).decode()
        return [{'frame': frame, 'dataUrl': value} for frame in indices]


class FakeProvider:
    def read(self, images, labels):
        return {'readings': [{'evidenceId': label, 'teamText': 'BOS', 'jerseyText': '00'}
                             for label in labels]}


class PartialProvider:
    def read(self, images, labels):
        return {'readings': [{'evidenceId': label, 'teamText': 'BOS', 'jerseyText': '00'}
                             for label in labels[:2]]}


class ConflictingProvider:
    def read(self, images, labels):
        return {'readings': [{'evidenceId': label, 'teamText': 'BOS',
                              'jerseyText': '00' if index < 3 else '0'}
                             for index, label in enumerate(labels[:4])]}


class SegmentProvider:
    def read(self, images, labels):
        readings = []
        for label in labels:
            jersey = '00' if '-S0-' in label else '0'
            readings.append({'evidenceId': label, 'teamText': 'BOS', 'jerseyText': jersey})
        return {'readings': readings}


class DuplicateEvidenceProvider:
    def read(self, images, labels):
        return {'readings': [{'evidenceId': labels[0], 'teamText': 'BOS', 'jerseyText': '00'},
                             {'evidenceId': labels[0], 'teamText': 'BOS', 'jerseyText': '0'},
                             {'evidenceId': labels[1], 'teamText': 'BOS', 'jerseyText': '00'}]}


class FollowupProvider:
    def __init__(self):
        self.calls = []

    def read(self, images, labels):
        self.calls.append(list(labels))
        chosen = labels if len(self.calls) > 1 else labels[:1]
        return {'readings': [{'evidenceId': label, 'teamText': 'BOS', 'jerseyText': '00'}
                             for label in chosen]}


class GenerateContractProvider:
    def __init__(self):
        self.calls = 0

    def generate(self, **kwargs):
        self.calls += 1
        self.assertion = (kwargs['schema'].is_file(), isinstance(kwargs['job']['cancel'], threading.Event),
                          'process' in kwargs['job'])
        return {'readings': [{'evidenceId': path.stem, 'teamText': 'BOS', 'jerseyText': '00'}
                             for path in kwargs['images'][:2]]}


class FakeRoster:
    def options(self, season=None):
        return {'seasons': ['2024-25'], 'teams': [{'abbreviation': team} for team in ('BOS', 'NYK', 'DAL', 'HOU')]}

    def lookup(self, season, team, jersey):
        return {'status': 'unique_candidate', 'candidates': [{'name': 'Double Zero',
            'player_id': 'name:doublezero', 'season_roster': [{'url': 'https://example.org/roster'}]}]}


def fixture():
    frames = [{'frame': i, 'time': i / 25, 'tracks': [[10, 5, 50, 115, 7, .9, 2]]}
              for i in range(6)]
    clip = {'width': 100, 'height': 120, 'frames': frames, 'sourceCuts': [],
            'video_sha256': 'video', 'tracking_fingerprint': 'tracking', 'tracking_revision': 1}
    entities = [{'id': f'P{i}', 'role': 'player', 'anchors': [], 'identityKeyframes': [],
                 'bindings': [], 'modelBindings': []} for i in range(1, 11)]
    entities[0]['bindings'] = [{'kind': 'track', 'trackId': 7, 'start': 0, 'end': 5}]
    session = {'version': 1, 'videoHash': 'video', 'maxGapSeconds': 0.3, 'cuts': [], 'entities': entities}
    return session, clip


def name_proposal(entity,number,name,track,start,end,frames,qa=False):
    player='name:'+name.lower().replace(' ','')
    return {'entityId':entity,'status':'candidate','trackId':track,'start':start,'end':end,
        'playerId':player,'season':'2025-26','team':'HOU','jersey':number,'evidenceMethod':'direct_jersey',
        'nameCandidate':{'name':name,'player_id':player,'namespace':'normalized_name_key',
            'lookupStatus':'unique_candidate','season':'2025-26','team':'HOU','jersey':number},
        'evidence':[{'evidenceId':f'{entity}-T{track}-F{frame}','frame':frame,'trackId':track,
            'jerseyText':number,'teamText':'HOU','targetConfirmed':True,'visibility':'clear',
            'confidence':.98,'quality':{'qaReference':qa}} for frame in frames],
        'verified':False,'reviewRequired':True}


class PlayerNameIdentityTests(unittest.TestCase):
    def tempdir(self):
        root = REPO_ROOT / 'tmp' / 'test-player-name-identity'
        root.mkdir(parents=True, exist_ok=True)
        return tempfile.TemporaryDirectory(dir=root)

    def test_selected_frames_are_distributed_across_interval(self):
        segment = {'values': [(i, [0, 0, 20 + i, 40 + i, 7, .9]) for i in range(20)]}
        selected = _select_evidence(segment, 4)
        self.assertEqual(len(selected), 4)
        self.assertGreaterEqual(selected[-1][0] - selected[0][0], 15)

    def test_role_risk_splits_or_removes_evidence(self):
        session, clip = fixture()
        clip['frames'][2]['track_evidence'] = {'7': {'identity_review_required': True}}
        ranges = _effective_ranges(session, clip)
        self.assertEqual([(r['start'], r['end']) for r in ranges], [(0, 1), (3, 5)])

    def test_cut_splits_same_track_into_separate_finite_segments(self):
        session, clip = fixture()
        session['cuts'] = [3]
        session['entities'][0]['bindings'] = [
            {'kind': 'track', 'trackId': 7, 'start': 0, 'end': 2, 'order': 1},
            {'kind': 'track', 'trackId': 7, 'start': 4, 'end': 5, 'order': 2}]
        ranges = _effective_ranges(session, clip)
        p1 = [row for row in ranges if row['entity']['id'] == 'P1']
        self.assertEqual([(r['start'], r['end'], r['trackId']) for r in p1], [(0, 2, 7), (4, 5, 7)])

    def test_manual_unassigned_keyframe_blocks_later_model_suggestion(self):
        session, clip = fixture()
        entity = session['entities'][0]
        entity['bindings'] = []
        entity['modelBindings'] = [{'kind': 'track', 'trackId': 7, 'start': 0, 'end': 5}]
        entity['identityKeyframes'] = [{'frame': 2, 'kind': 'unassigned', 'trackId': None, 'order': 3}]
        ranges = _effective_ranges(session, clip)
        p1 = [row for row in ranges if row['entity']['id'] == 'P1']
        self.assertEqual([(r['start'], r['end']) for r in p1], [(0, 1)])

    def test_dismissed_machine_suggestions_do_not_reappear(self):
        session, clip = fixture()
        entity = session['entities'][0]
        entity['bindings'] = []
        entity['modelBindings'] = [{'kind': 'track', 'trackId': 7, 'start': 0, 'end': 5}]
        entity['identitySuggestionsDismissed'] = True
        self.assertFalse([r for r in _effective_ranges(session, clip) if r['entity']['id'] == 'P1'])

    def test_multiple_track_segments_share_only_existing_p_identity(self):
        session, clip = fixture()
        for frame in clip['frames'][3:]:
            frame['tracks'] = [[12, 5, 52, 115, 8, .9, 2]]
        entity = session['entities'][0]
        entity['bindings'] = []
        entity['identityKeyframes'] = [
            {'frame': 0, 'kind': 'track', 'trackId': 7, 'order': 1},
            {'frame': 3, 'kind': 'track', 'trackId': 8, 'order': 2}]
        ranges = _effective_ranges(session, clip)
        p1 = [row for row in ranges if row['entity']['id'] == 'P1']
        self.assertEqual([(r['start'], r['end'], r['trackId']) for r in p1], [(0, 2, 7), (3, 5, 8)])
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=FakeProvider(), max_frames_per_entity=8, work_dir=directory)
        proposals = [row for row in result['candidates'] if row['entityId'] == 'P1' and row['status'] == 'candidate']
        self.assertEqual([(row['start'], row['end'], row['trackId']) for row in proposals], [(0, 2, 7), (3, 5, 8)])
        self.assertTrue(all(row['verified'] is False for row in proposals))

    def test_token_plan_requires_explicit_key_and_trusted_endpoint(self):
        with self.assertRaises(ValueError):
            TokenPlanVision(config={})
        with self.assertRaises(ValueError):
            TokenPlanVision(config={'QWEN_TOKEN_PLAN_KEY': 'secret',
                                    'QWEN_TOKEN_PLAN_BASE_URL': 'https://example.com/v1'})

    def test_existing_qwen_key_does_not_implicitly_enable_token_plan(self):
        with self.assertRaises(ValueError):
            TokenPlanVision(config={'QWEN_KEY': 'paid-key'})

    def test_openrouter_names_use_astra_and_the_existing_reading_contract(self):
        requests=[]
        def open_request(request, timeout):
            requests.append((request,timeout))
            return io.BytesIO(json.dumps({'choices':[{'message':{'content':json.dumps({'readings':[], 'continuities':[]})}}]}).encode())
        provider=OpenRouterVision(config={'OPEN_ROUTER_KEY':'test-key'},opener=open_request)
        self.assertEqual(provider.review([],[]),{'readings':[], 'continuities':[]})
        request,timeout=requests[0];body=json.loads(request.data)
        self.assertEqual(request.full_url,'https://openrouter.ai/api/v1/chat/completions')
        self.assertEqual(body['model'],'openai/gpt-6-astra')
        self.assertNotIn('enable_thinking',body)
        self.assertEqual(body['reasoning'],{'effort':'low'})
        self.assertEqual(provider.status()['provider'],'openrouter')
        unavailable=OpenRouterVision(config={'QWEN_TOKEN_PLAN_KEY':'not-openrouter'},opener=open_request)
        self.assertFalse(unavailable.status()['available'])
        with self.assertRaises(ValueError):
            unavailable.review([],[])
        self.assertEqual(len(requests),1)

    def test_unique_roster_match_is_candidate_and_never_verified(self):
        session, clip = fixture()
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=PartialProvider(), max_frames_per_entity=4, work_dir=directory)
        candidate = next(row for row in result['candidates'] if row['entityId'] == 'P1')
        self.assertEqual(candidate['status'], 'candidate')
        self.assertEqual(candidate['jersey'], '00')
        self.assertEqual(candidate['nameCandidate']['namespace'], 'normalized_name_key')
        self.assertEqual(candidate['nameCandidate']['seasonRoster'][0]['url'], 'https://example.org/roster')
        self.assertFalse(candidate['verified'])
        self.assertTrue(candidate['reviewRequired'])
        self.assertEqual(len(candidate['evidence']), 4)
        self.assertEqual(sum(bool(item['jerseyText']) for item in candidate['evidence']), 2)
        self.assertTrue(all(item['trackId'] == 7 and item['box'] for item in candidate['evidence']))

    def test_single_outlier_and_unreadable_frames_do_not_veto_two_frame_segment_vote(self):
        session, clip = fixture()
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=ConflictingProvider(), max_frames_per_entity=4, work_dir=directory)
        candidate = next(row for row in result['candidates'] if row['entityId'] == 'P1')
        self.assertEqual(candidate['status'], 'candidate')
        self.assertEqual(candidate['jersey'], '00')

    def test_two_numbers_with_independent_support_in_one_segment_remain_unknown(self):
        session, clip = fixture()
        class TwoNumberProvider:
            def read(self, images, labels):
                return {'readings': [{'evidenceId': label, 'teamText': 'BOS',
                    'jerseyText': '00' if index % 2 == 0 else '0'} for index, label in enumerate(labels[:4])]}
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=TwoNumberProvider(), max_frames_per_entity=4, work_dir=directory)
        candidate = next(row for row in result['candidates'] if row['entityId'] == 'P1')
        self.assertEqual(candidate['status'], 'unknown')
        self.assertIsNone(candidate['nameCandidate'])

    def test_different_reliable_segments_are_local_candidates_with_identity_issue(self):
        session, clip = fixture()
        entity = session['entities'][0]
        for frame in clip['frames'][3:]:
            frame['tracks'] = [[12, 5, 52, 115, 8, .9, 2]]
        entity['bindings'] = [{'kind': 'track', 'trackId': 7, 'start': 0, 'end': 2, 'order': 1},
                              {'kind': 'track', 'trackId': 8, 'start': 3, 'end': 5, 'order': 2}]
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=SegmentProvider(), max_frames_per_entity=4, work_dir=directory)
        rows = [row for row in result['candidates'] if row['entityId'] == 'P1']
        self.assertEqual([row['status'] for row in rows], ['candidate', 'candidate'])
        issue = next(row for row in result['issues'] if row['entityId'] == 'P1')
        self.assertEqual(issue['kind'], 'identity_conflict')
        self.assertEqual([row['jersey'] for row in issue['segments']], ['00', '0'])

    def test_repeated_evidence_id_with_disagreement_does_not_count_as_two_votes(self):
        session, clip = fixture()
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=DuplicateEvidenceProvider(), max_frames_per_entity=4, work_dir=directory)
        candidate = next(row for row in result['candidates'] if row['entityId'] == 'P1')
        self.assertEqual(candidate['status'], 'unknown')
        self.assertTrue(any(item.get('readConflict') for item in candidate['evidence']))

    def test_visible_team_label_conflicting_with_team_map_is_not_overridden(self):
        session, _ = fixture()
        entity = session['entities'][0]
        self.assertIsNone(_resolve_team(entity, 'MAVS', {'red': 'HOU'}, FakeRoster(), '2024-25'))
        self.assertEqual(_resolve_team(entity, 'MAVS', {'red': 'DAL'}, FakeRoster(), '2024-25'), 'DAL')

    def test_single_bounded_followup_uses_only_new_frames_and_reports_usage(self):
        session, clip = fixture()
        provider = FollowupProvider()
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=provider, max_frames_per_entity=4, work_dir=directory)
        candidate = next(row for row in result['candidates'] if row['entityId'] == 'P1')
        self.assertEqual(candidate['status'], 'candidate')
        self.assertEqual(len(provider.calls), 2)
        self.assertFalse(set(provider.calls[0]) & set(provider.calls[1]))
        self.assertEqual(result['usage']['followupRequests'], 1)
        self.assertEqual(result['usage']['successfulModelRequests'],2)
        self.assertEqual(result['usage']['failedModelRequests'],0)
        self.assertLessEqual(result['usage']['evidenceImages'], 8)
        self.assertTrue(any(item.get('pass') == 2 for item in candidate['evidence']))

    def test_existing_vision_provider_contract_gets_schema_and_cancel_state(self):
        session, clip = fixture()
        provider = GenerateContractProvider()
        with self.tempdir() as directory:
            result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
                season='2024-25', provider=provider, max_frames_per_entity=4, work_dir=directory)
        self.assertEqual(provider.calls, 1)
        self.assertEqual(provider.assertion, (True, True, True))
        self.assertEqual(next(row for row in result['candidates'] if row['entityId'] == 'P1')['status'], 'candidate')

    def test_cancellation_stops_before_first_player_model_call(self):
        session, clip = fixture()
        provider = GenerateContractProvider()
        cancelled = threading.Event(); cancelled.set()
        result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(),
            season='2024-25', provider=provider, cancel_event=cancelled)
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(provider.calls, 0)
        self.assertEqual(result['usage']['successfulModelRequests'],0)
        self.assertEqual(result['usage']['failedModelRequests'],0)

    def test_missing_season_is_pending_and_provider_must_be_explicit(self):
        session, clip = fixture()
        result = recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster())
        self.assertEqual(result['status'], 'pending_context')
        with self.assertRaisesRegex(ValueError, '显式传入'):
            recognize_player_names(session, clip, 'video.mp4', FakeTactics(), FakeRoster(), season='2024-25')

    def test_unknown_wordmark_does_not_veto_confirmed_team_context(self):
        session,clip=fixture()
        class WordmarkProvider:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':label,'teamText':'CITY','jerseyText':'00'} for label in labels]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                team_map={'A':'BOS'},provider=WordmarkProvider(),work_dir=directory)
        self.assertEqual(result['candidates'][0]['status'],'candidate')

    def test_neighbor_number_is_not_a_target_identity_vote(self):
        session,clip=fixture()
        class NeighborProvider:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':label,'teamText':'BOS','jerseyText':'00',
                    'targetConfirmed':False,'visibility':'clear','confidence':.99,
                    'reason':'Digits belong to a foreground neighbor'} for label in labels]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=NeighborProvider(),work_dir=directory)
        self.assertEqual(result['candidates'][0]['status'],'unknown')

    def test_clear_single_anchor_labels_continuous_observed_same_track(self):
        session,clip=fixture()
        class ClearProvider:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':labels[0],'teamText':'BOS','jerseyText':'00',
                    'targetConfirmed':True,'visibility':'clear','confidence':.99}]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=ClearProvider(),work_dir=directory)
        row=result['candidates'][0]
        self.assertEqual((row['status'],row['start'],row['end']),('candidate',0,5))
        self.assertFalse(row['verified'])

    def test_reference_comparison_continues_a_new_track_without_requiring_new_number(self):
        session,clip=fixture()
        clip['frames']=[{'frame':i,'time':i/25,'tracks':[[10,5,50,115,7 if i<20 else 8,.9,2]]} for i in range(40)]
        session['entities'][0]['bindings']=[{'kind':'track','trackId':7,'start':0,'end':19},
            {'kind':'track','trackId':8,'start':20,'end':39}]
        class ComparisonProvider:
            def review(self,images,labels,context=None):
                if context:
                    return {'readings':[], 'continuities':[{**link,'samePerson':True,'confidence':.95,
                        'reason':'Matching face, hair and body proportions'} for link in context['comparisons']]}
                return {'readings':[{'evidenceId':label,'teamText':'BOS','jerseyText':'00',
                    'targetConfirmed':True,'visibility':'clear','confidence':.98} for label in labels if '-T7-' in label]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=ComparisonProvider(),max_frames_per_entity=4,work_dir=directory)
        rows=[x for x in result['candidates'] if x['entityId']=='P1']
        self.assertEqual([x['status'] for x in rows],['candidate','candidate'])
        self.assertEqual(rows[1]['evidenceMethod'],'visual_same_person')
        self.assertTrue(rows[1]['referenceEvidence'][0]['evidenceId'])
        self.assertEqual(result['usage']['modelRequests'],2)

    def test_ordered_same_track_number_change_is_split_into_finite_ranges(self):
        session,clip=fixture()
        class ChangeProvider:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':label,'teamText':'BOS',
                    'jerseyText':'00' if int(label.split('-F')[1].split('-')[0])<3 else '0',
                    'targetConfirmed':True,'visibility':'clear','confidence':.99} for label in labels]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=ChangeProvider(),max_frames_per_entity=4,work_dir=directory)
        rows=[x for x in result['candidates'] if x['entityId']=='P1']
        self.assertEqual([x['jersey'] for x in rows],['00','0'])
        self.assertTrue(rows[0]['end']<rows[1]['start'])

    def test_roster_rejected_number_does_not_create_reliable_identity_conflict(self):
        session,clip=fixture()
        class Roster(FakeRoster):
            def lookup(self,season,team,jersey):
                return {'status':'not_found','candidates':[]} if jersey=='8' else super().lookup(season,team,jersey)
        class ReadProvider:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':label,'teamText':'BOS','jerseyText':'8' if i==0 else '00',
                    'targetConfirmed':True,'visibility':'clear','confidence':.99} for i,label in enumerate(labels)]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),Roster(),season='2024-25',
                provider=ReadProvider(),work_dir=directory)
        self.assertEqual(result['candidates'][0]['status'],'candidate')
        self.assertFalse(any(x['kind']=='identity_conflict' for x in result['issues']))
        self.assertTrue(any(x['kind']=='roster_read_mismatch' for x in result['issues']))

    def test_source_quality_selects_the_clearest_pose_in_each_time_bin(self):
        segment={'values':[(i,[0,0,30,60,7]) for i in range(8)],
            'quality':{i:{'score':100 if i in (1,6) else 1} for i in range(8)}}
        self.assertEqual([x[0] for x in _select_evidence(segment,2)],[1,6])

    def test_explicit_observed_target_can_correct_only_machine_owned_slot(self):
        session,clip=fixture()
        for frame in clip['frames'][3:]:
            frame['tracks']=[[10,5,50,115,8,.9,2]]
        session['entities'][0]['bindings']=[{'kind':'track','trackId':7,'start':0,'end':2}]
        session['entities'][1]['bindings']=[{'kind':'track','trackId':8,'start':3,'end':5,'origin':'ai_visual_reference'}]
        target={'entityId':'P1','trackId':8,'start':3,'end':5}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=FakeProvider(),reference_frames={'P1':[0,2]},correction_targets=[target],work_dir=directory)
        correction=result['correctedBindings'][0]
        self.assertEqual((correction['entityId'],correction['originalEntityId'],correction['trackId']),('P1','P2',8))
        self.assertTrue(correction['bindingCorrection'])
        self.assertEqual(session['entities'][1]['bindings'][0]['trackId'],8)
        session['entities'][1]['bindings'][0]['origin']='human_range_replacement'
        session['entities'][1]['bindings'][0].update(exclusive=True,order=1)
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=FakeProvider(),reference_frames={'P1':[0,2]},correction_targets=[target],work_dir=directory)
        self.assertEqual(result['correctedBindings'],[])

    def test_color_history_conflict_is_available_for_target_visual_review(self):
        session,clip=fixture()
        clip['frames'][2]['track_evidence']={'7':{'color_conflict':True}}
        self.assertEqual([(x['start'],x['end']) for x in _effective_ranges(session,clip)],[(0,5)])
        clip['frames'][2]['track_evidence']['7']['identity_review_required']=True
        self.assertEqual([(x['start'],x['end']) for x in _effective_ranges(session,clip)],[(0,5)])

    def test_sticky_color_review_is_not_a_role_veto_but_referee_evidence_remains_one(self):
        session,clip=fixture()
        clip['frames'][1]['track_evidence']={'7':{'color_conflict':True,'identity_review_required':True}}
        clip['frames'][2]['track_evidence']={'7':{'color_conflict':False,'identity_review_required':True,
            'torso':{'label':None,'overlap':.77}}}
        self.assertEqual([(x['start'],x['end']) for x in _effective_ranges(session,clip)],[(0,5)])
        clip['frames'][2]['track_evidence']['7']['role_evidence']={'role':'referee'}
        self.assertEqual([(x['start'],x['end']) for x in _effective_ranges(session,clip)],[(0,1),(3,5)])

    def test_clear_terminal_opposing_number_limits_propagation_without_vetoing_anchor(self):
        session,clip=fixture()
        class EndSwitch:
            def read(self,images,labels):
                return {'readings':[{'evidenceId':label,'teamText':'BOS',
                    'jerseyText':'0' if '-F5' in label else '00','targetConfirmed':True,
                    'visibility':'clear','confidence':.99} for label in labels]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=EndSwitch(),work_dir=directory)
        rows=[x for x in result['candidates'] if x['entityId']=='P1']
        self.assertEqual([(x['start'],x['end'],x['status']) for x in rows],[(0,4,'candidate'),(5,5,'unknown')])

    def test_failed_actual_model_request_is_counted(self):
        session,clip=fixture()
        class FailedProvider:
            def read(self,images,labels):
                raise ValueError('Transport failed')
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=FailedProvider(),work_dir=directory)
        self.assertEqual(result['usage']['modelRequests'],1)
        self.assertEqual(result['usage']['successfulModelRequests'],0)
        self.assertEqual(result['usage']['failedModelRequests'],1)

    def test_partial_success_keeps_success_count_when_followup_fails(self):
        session,clip=fixture()
        class PartialThenFailed:
            def __init__(self):
                self.calls=0
            def read(self,images,labels):
                self.calls+=1
                if self.calls==2:
                    raise ValueError('Followup transport failed')
                return {'readings':[{'evidenceId':labels[0],'teamText':'BOS','jerseyText':'00'}]}
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=PartialThenFailed(),max_frames_per_entity=4,work_dir=directory)
        self.assertEqual(result['usage']['modelRequests'],2)
        self.assertEqual(result['usage']['successfulModelRequests'],1)
        self.assertEqual(result['usage']['failedModelRequests'],1)
        self.assertTrue(result['candidates'][0]['evidence'])

    def test_selected_entities_limits_calls_without_clearing_other_source_owners(self):
        session,clip=fixture()
        for frame in clip['frames']:
            frame['tracks'].append([55,5,95,115,8,.9,2])
        session['entities'][1]['bindings']=[{'kind':'track','trackId':8,'start':0,'end':5,'origin':'ai_visual_reference'}]
        original=json.dumps(session,sort_keys=True)
        provider=GenerateContractProvider()
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=provider,selected_entities=['P1','P2'],work_dir=directory)
        self.assertEqual(provider.calls,2)
        self.assertEqual({x['entityId'] for x in result['candidates']},{'P1','P2'})
        self.assertEqual(json.dumps(session,sort_keys=True),original)

    def test_canonical_reference_routes_two_clear_foreign_frames_without_changing_raw(self):
        result={'algorithm':'raw-v4','candidates':[
            name_proposal('P2','10','Jabari Smith',6,0,3,[0,2],True),
            name_proposal('P5','7','Kevin Durant',9,100,110,[100,110],True),
            name_proposal('P2','7','Kevin Durant',14,10,20,[10,20])],
            'issues':[],'usage':{'modelRequests':3}}
        before=json.dumps(result,sort_keys=True)
        fixed=apply_reference_slot_identities(result)
        self.assertEqual(json.dumps(result,sort_keys=True),before)
        routed=fixed['candidates'][2]
        self.assertEqual((routed['entityId'],routed['originalEntityId']),('P5','P2'))
        self.assertTrue(routed['bindingCorrection'])
        self.assertEqual(len(fixed['playerProfiles']),2)
        self.assertEqual(fixed['issues'][-1]['resolution'],'routed')
        self.assertTrue(fixed['issues'][-1]['referenceEvidence'])
        self.assertEqual(fixed['referenceSlotAnalysis']['newModelRequests'],0)
        self.assertEqual(fixed['usage'],result['usage'])

    def test_canonical_reference_releases_foreign_single_read_without_guessing_destination(self):
        result={'algorithm':'raw-v4','candidates':[
            name_proposal('P2','10','Jabari Smith',6,0,3,[0,2],True),
            name_proposal('P5','7','Kevin Durant',9,100,110,[100,110],True),
            name_proposal('P2','7','Kevin Durant',14,10,20,[10])],'issues':[]}
        fixed=apply_reference_slot_identities(result)
        foreign=fixed['candidates'][2]
        self.assertEqual(foreign['status'],'unknown')
        self.assertEqual(foreign['observedNameCandidate']['name'],'Kevin Durant')
        self.assertEqual(fixed['issues'][-1]['resolution'],'unassigned')
        self.assertEqual((fixed['issues'][-1]['start'],fixed['issues'][-1]['end']),(10,20))

    def test_postprocess_cannot_establish_canonical_identity_from_saved_label(self):
        proposal=name_proposal('P2','7','Kevin Durant',14,10,20,[10,20])
        proposal['jersey']='10'
        result={'algorithm':'raw-v4','candidates':[proposal],'issues':[],'jersey':'10'}
        fixed=apply_reference_slot_identities(result)
        self.assertEqual(fixed['playerProfiles'],[])
        self.assertEqual(fixed['referenceSlotAnalysis']['routedSegments'],0)

    def test_postprocess_does_not_route_to_two_slots_claiming_same_reference_identity(self):
        result={'algorithm':'raw-v4','candidates':[
            name_proposal('P2','10','Jabari Smith',6,0,3,[0,2],True),
            name_proposal('P5','7','Kevin Durant',9,100,110,[100,110],True),
            name_proposal('P4','7','Kevin Durant',8,200,210,[200,210],True),
            name_proposal('P2','7','Kevin Durant',14,10,20,[10,20])],'issues':[]}
        fixed=apply_reference_slot_identities(result)
        self.assertEqual(fixed['candidates'][3]['status'],'unknown')
        self.assertEqual(fixed['referenceSlotAnalysis']['routedSegments'],0)

    def test_explicit_correction_window_receives_first_pass_budget_before_short_fragments(self):
        session,clip=fixture()
        clip['frames']=[{'frame':i,'time':i/25,
            'tracks':[[10,5,50,115,7+i//2 if i<16 else 99,.9,2]]} for i in range(20)]
        session['entities'][0]['bindings']=[{'kind':'track','trackId':7+i//2,
            'start':i,'end':i+1,'origin':'ai_visual_reference'} for i in range(0,16,2)]
        session['entities'][1]['bindings']=[{'kind':'track','trackId':99,'start':16,'end':19,'origin':'ai_visual_reference'}]
        class RecordingProvider(FakeProvider):
            def __init__(self):
                self.labels=[]
            def read(self,images,labels):
                self.labels.append(list(labels))
                return super().read(images,labels)
        provider=RecordingProvider()
        with self.tempdir() as directory:
            recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=provider,reference_frames={'P1':[0,1]},selected_entities=['P1'],
                correction_targets=[{'entityId':'P1','trackId':99,'start':16,'end':19,'frames':[16,17,19]}],
                max_frames_per_entity=6,work_dir=directory)
        target_labels=[label for label in provider.labels[0] if '-T99-' in label]
        self.assertEqual({int(label.split('-F')[1]) for label in target_labels},{16,17,19})

    def test_transport_error_classification_never_leaks_reason_text_or_auth(self):
        secret='Bearer private-api-key request-body-cookie'
        error=urllib.error.URLError(ConnectionResetError(10054,secret))
        message=_safe_request_error(error)
        self.assertIn('connection_reset',message)
        self.assertIn('errno=10054',message)
        self.assertNotIn(secret,message)
        self.assertIn('timeout',_safe_request_error(TimeoutError(secret)))
        self.assertIn('tls_error',_safe_request_error(urllib.error.URLError(ssl.SSLError(1,secret))))
        self.assertIn('HTTP 429',_safe_request_error(urllib.error.HTTPError(
            'https://example.com/?key='+secret,429,secret,{'Authorization':secret},None)))

    def test_request_jpeg_preserves_dimensions_and_does_not_enlarge_original(self):
        with self.tempdir() as directory:
            path=Path(directory)/'evidence.jpg'
            Image.effect_noise((320,180),70).convert('RGB').save(path,'JPEG',quality=94)
            data=_jpeg_request_payload(path)
            self.assertLessEqual(len(data),path.stat().st_size)
            self.assertEqual(Image.open(io.BytesIO(data)).size,(320,180))

    def test_unreadable_repair_gets_two_comparisons_before_ordinary_fragments(self):
        session,clip=fixture()
        clip['frames']=[{'frame':i,'time':i/25,
            'tracks':[[10,5,50,115,7+i//2 if i<16 else 99,.9,2]]} for i in range(20)]
        session['entities'][0]['bindings']=[{'kind':'track','trackId':7+i//2,
            'start':i,'end':i+1,'origin':'ai_visual_reference'} for i in range(0,16,2)]
        session['entities'][1]['bindings']=[{'kind':'track','trackId':99,'start':16,'end':19,'origin':'ai_visual_reference'}]
        class CompareProvider:
            def __init__(self):
                self.comparisons=[]
            def review(self,images,labels,context=None):
                if context:
                    self.comparisons=context['comparisons']
                    return {'readings':[{'evidenceId':label,'teamText':'','jerseyText':'',
                        'targetConfirmed':False,'visibility':'unreadable','confidence':.1} for label in labels],
                        'continuities':[{**link,'samePerson':True,'targetVisible':True,'confidence':.96,
                            'reason':'Visible target face, hair and build match the clear reference'} for link in self.comparisons]}
                return {'readings':[{'evidenceId':label,'teamText':'BOS','jerseyText':'00',
                    'targetConfirmed':True,'visibility':'clear','confidence':.98} for label in labels if '-T7-' in label]}
        provider=CompareProvider()
        with self.tempdir() as directory:
            result=recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=provider,reference_frames={'P1':[0,1]},selected_entities=['P1'],
                correction_targets=[{'entityId':'P1','trackId':99,'start':16,'end':19,'frames':[16,17,19]}],
                max_frames_per_entity=6,work_dir=directory)
        self.assertGreaterEqual(sum('-T99-' in x['targetEvidenceId'] for x in provider.comparisons),2)
        repair=next(x for x in result['candidates'] if x['entityId']=='P1' and x['trackId']==99)
        self.assertEqual((repair['status'],repair['evidenceMethod']),('candidate','visual_same_person'))
        self.assertLessEqual(result['usage']['evidenceImages'],12)

    def test_same_frame_track_aliases_do_not_displace_external_qa_reference(self):
        session,clip=fixture()
        clip['frames']=[{'frame':i,'time':i/25,'tracks':[[10,5,50,115,7 if i<4 else 99,.9,2]]}
            for i in range(10)]
        session['entities'][0]['bindings']=[{'kind':'track','trackId':7,'start':0,'end':3,'origin':'ai_visual_reference'},
            {'kind':'track','trackId':99,'start':4,'end':8,'origin':'ai_visual_reference'}]
        session['entities'][1]['bindings']=[{'kind':'track','trackId':99,'start':9,'end':9,'origin':'ai_visual_reference'}]
        class Recorder(FakeProvider):
            def __init__(self):self.labels=[]
            def read(self,images,labels):
                self.labels.append(list(labels));return super().read(images,labels)
        provider=Recorder()
        with self.tempdir() as directory:
            recognize_player_names(session,clip,'video',FakeTactics(),FakeRoster(),season='2024-25',
                provider=provider,reference_frames={'P1':[0,2,6,8]},selected_entities=['P1'],
                correction_targets=[{'entityId':'P1','trackId':99,'start':4,'end':9,'frames':[6,8]}],
                max_frames_per_entity=8,work_dir=directory)
        first=provider.labels[0]
        keys=[(label.split('-T')[1].split('-F')[0],label.split('-F')[1]) for label in first]
        self.assertEqual(len(keys),len(set(keys)))
        self.assertTrue(any('-T7-' in label for label in first))


if __name__ == '__main__':
    unittest.main()
