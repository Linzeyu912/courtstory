"""Verify detector variants retain isolated data through actual video trimming."""
import argparse
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from review_video_trim import trim_review_clip
from serve_player_review import load_clip


class VariantTests(unittest.TestCase):
    def setUp(self):
        import av
        import numpy as np
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.video = self.root / 'source.mp4'
        with av.open(str(self.video), 'w') as container:
            stream = container.add_stream('libx264', rate=10)
            stream.width = 64; stream.height = 48; stream.pix_fmt = 'yuv420p'
            for i in range(6):
                frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), i * 30, np.uint8), format='rgb24')
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        with av.open(str(self.video)) as container:
            times = [float(frame.time) for frame in container.decode(video=0)]
        self.digest = hashlib.sha256(self.video.read_bytes()).hexdigest()
        for variant in ['original', 'ebard']:
            data = [{'frame': i, 'time': t, 'tracks': [[1, 2, 20, 40, i + (10 if variant == 'ebard' else 1), .9, 2 if variant == 'ebard' else 0]],
                     'objects': [{'kind': 'hoop', 'box': [3, 4, 8, 9], 'score': .8, 'groundPoint': False}] if variant == 'ebard' else [],
                     'track_roles': {str(i + 10): 'player'} if variant == 'ebard' else {}}
                    for i, t in enumerate(times)]
            path = self.root / f'{variant}.json'
            path.write_text(json.dumps(data), encoding='utf-8')
            path.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': self.digest, 'frames': 6}), encoding='utf-8')
        self.sample = {'id': 'test', 'video': str(self.video), 'tracks': str(self.root / 'original.json'),
                       'videoSha256': self.digest, 'originalLabel': '通用 YOLOv8s', 'defaultVariant': 'ebard',
                       'trackingVariants': [{'id': 'ebard', 'tracks': str(self.root / 'ebard.json'), 'label': 'E-BARD', 'recommended': True}]}

    def load(self, sample=None):
        return load_clip(argparse.ArgumentParser(), sample or self.sample)

    def test_default_and_fingerprints_do_not_mix_models(self):
        clip = self.load()
        self.assertEqual(clip['defaultVariant'], 'ebard')
        a, b = [json.loads(clip['payloads'][k]) for k in ['original', 'ebard']]
        self.assertNotEqual(a['tracking_fingerprint'], b['tracking_fingerprint'])
        self.assertEqual(a['variant'], 'original');self.assertEqual(b['variant'], 'ebard')
        self.assertEqual(b['variants'][1]['recommended'], True)
        self.assertFalse(a['frames'][0]['objects']);self.assertEqual(b['frames'][0]['objects'][0]['kind'], 'hoop')

    def test_cut_preserves_both_models_objects_roles_and_lineage(self):
        clip = self.load()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        result = trim_review_clip({'video': self.video, 'payload': payloads['ebard'], 'payloads': payloads},
                                  [{'start': 0, 'end': 1}, {'start': 4, 'end': 5}], self.root / 'cut')
        cut = self.load(result)
        self.assertEqual(cut['defaultVariant'], 'ebard')
        self.assertEqual(set(cut['payloads']), {'original', 'ebard'})
        for variant in cut['payloads']:
            payload = json.loads(cut['payloads'][variant])
            self.assertEqual(payload['sourceCuts'], [2])
            self.assertEqual([row['source_frame'] for row in payload['frames']], [0, 1, 4, 5])
            for row, index in zip(payload['frames'], [0, 1, 4, 5]):
                self.assertEqual(row['tracks'], payloads[variant]['frames'][index]['tracks'])
                self.assertEqual(row['objects'], payloads[variant]['frames'][index]['objects'])
                self.assertEqual(row['track_roles'], payloads[variant]['frames'][index]['track_roles'])
            self.assertEqual(payload['source_video_sha256'], self.digest)

    def test_wrong_video_or_unavailable_default_is_rejected(self):
        wrong = {**self.sample, 'defaultVariant': 'missing'}
        with self.assertRaises(SystemExit):self.load(wrong)
        meta = self.root / 'ebard.meta.json'
        meta.write_text(json.dumps({'video_sha256': 'other-video', 'frames': 6}), encoding='utf-8')
        with self.assertRaises(SystemExit):self.load()

    def test_misaligned_version_rejected_before_any_trim_files(self):
        clip = self.load()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        payloads['original']['frames'][1]['time'] += .1
        output = self.root / 'invalid'
        with self.assertRaises(ValueError):
            trim_review_clip({'video': self.video, 'payload': payloads['ebard'], 'payloads': payloads}, [{'start': 0, 'end': 2}], output)
        self.assertFalse(output.exists())

    def test_multiversion_trim_preserves_team_presentation_and_splits_suggestions_at_source_cuts(self):
        records = json.loads((self.root / 'original.json').read_text())
        for index, record in enumerate(records):
            record['tracks'] = [] if index == 4 else [[1, 2, 20, 40, 1, .9, 2]]
        path = self.root / 'team-stable.json'
        path.write_text(json.dumps(records), encoding='utf-8')
        suggestions = {'version': 1, 'method': 'team_proposal', 'verified': False,
            'teamGrouping': {'version': 1, 'verified': False, 'layout': 'reserved_5_plus_5_v1'},
            'entities': [{'id': 'P6', 'teamGroup': 'B', 'teamHint': 'white',
                          'bindings': [{'start': 0, 'end': 5, 'trackId': 1}]}]}
        metadata = {'video_sha256': self.digest, 'frames': 6, 'tracker': 'BoT-SORT',
            'identitySuggestions': suggestions,
            'presentation': {'version': 1, 'default_stable': True, 'source_records_unchanged': True},
            'presentation_geometry_comparison': {'scope': 'complete_parent'}}
        path.with_suffix('.meta.json').write_text(json.dumps(metadata), encoding='utf-8')
        self.sample['trackingVariants'].append({'id': 'team-stable', 'label': '分队稳定', 'tracks': str(path)})
        self.sample.update(defaultVariant='team-stable', sourceCuts=[3])
        clip = self.load()
        payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
        result = trim_review_clip({'video': self.video, 'payload': payloads['team-stable'], 'payloads': payloads},
            [{'start': 0, 'end': 1}, {'start': 3, 'end': 5}], self.root / 'team-cut')
        child = self.load({**result, 'id': 'child'})
        self.assertEqual(set(child['payloads']), {'original', 'ebard', 'team-stable'})
        self.assertEqual(child['defaultVariant'], 'team-stable')
        team = json.loads(child['payloads']['team-stable'])
        self.assertEqual(team['sourceCuts'], [2])
        self.assertEqual([row['source_frame'] for row in team['frames']], [0, 1, 3, 4, 5])
        self.assertEqual(team['trackingMetadata']['source_tracking_metadata'], metadata)
        self.assertEqual(team['trackingMetadata']['source_tracking_revision'], 'team-stable')
        self.assertEqual(team['trackingMetadata']['source_tracking_fingerprint'], payloads['team-stable']['tracking_fingerprint'])
        self.assertFalse(team['trackingMetadata']['presentation']['source_records_unchanged'])
        self.assertNotIn('presentation_geometry_comparison', team['trackingMetadata'])
        self.assertEqual(team['identitySuggestions']['entities'], [{'id': 'P6', 'teamGroup': 'B', 'teamHint': 'white',
            'bindings': [{'start': 0, 'end': 1, 'trackId': 1}, {'start': 2, 'end': 2, 'trackId': 1},
                         {'start': 4, 'end': 4, 'trackId': 1}]}])
        nested_payloads = {key: json.loads(value) for key, value in child['payloads'].items()}
        nested_result = trim_review_clip({'video': result['video'], 'payload': team, 'payloads': nested_payloads},
            [{'start': 0, 'end': 4}], self.root / 'nested-team-cut')
        nested = json.loads(self.load({**nested_result, 'id': 'nested'})['payloads']['team-stable'])
        self.assertEqual(nested['sourceCuts'], [2])
        self.assertEqual(nested['identitySuggestions']['entities'], team['identitySuggestions']['entities'])
        self.assertEqual(nested['trackingMetadata']['origin_tracking_revision'], 'team-stable')
        self.assertEqual(nested['trackingMetadata']['origin_tracking_fingerprint'], payloads['team-stable']['tracking_fingerprint'])

    def test_variant_source_cuts_or_nonfinite_pts_are_rejected_before_creating_trim_directory(self):
        clip = self.load()
        for defect in ['cuts', 'nan']:
            payloads = {key: json.loads(value) for key, value in clip['payloads'].items()}
            if defect == 'cuts':payloads['original']['sourceCuts'] = [2]
            else:payloads['original']['frames'][1]['time'] = float('nan')
            output = self.root / ('invalid-' + defect)
            with self.assertRaises(ValueError):
                trim_review_clip({'video': self.video, 'payload': payloads['ebard'], 'payloads': payloads},
                    [{'start': 0, 'end': 2}], output)
            self.assertFalse(output.exists())

    def test_legacy_jersey_trim_and_nested_reload_keep_reserved_variant_and_raw_draft_fingerprints(self):
        records = json.loads((self.root / 'original.json').read_text())
        for record in records:record['tracks'][0][4] = 7
        jersey = self.root / 'jersey.json'
        jersey.write_text(json.dumps(records), encoding='utf-8')
        jersey.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': self.digest, 'frames': 6,
            'tracker': 'jersey-constrained', 'identitySuggestions': {'version': 1, 'method': 'legacy_jersey',
                'verified': False, 'entities': [{'id': 'P2', 'bindings': [{'start': 0, 'end': 5, 'trackId': 7}]}]}}),
            encoding='utf-8')
        self.sample.update(alternativeTracks=str(jersey), trackingVariants=[], defaultVariant='jersey', sourceCuts=[4])
        parent = self.load()
        payloads = {key: json.loads(value) for key, value in parent['payloads'].items()}
        original_bytes, jersey_bytes = (self.root / 'original.json').read_bytes(), jersey.read_bytes()
        result = trim_review_clip({'video': self.video, 'payload': payloads['jersey'], 'payloads': payloads},
            [{'start': 0, 'end': 1}, {'start': 3, 'end': 5}], self.root / 'legacy-cut')
        try:child = self.load({**result, 'id': 'child'})
        except SystemExit as error:self.fail(f'Legacy jersey trim must reload as a reserved variant: {error}')
        self.assertIn('alternativeTracks', result)
        self.assertFalse(any(config['id'] == 'jersey' for config in result['trackingVariants']))
        self.assertEqual(child['defaultVariant'], 'jersey')
        self.assertEqual(set(child['payloads']), {'original', 'jersey'})
        payload = json.loads(child['payloads']['jersey'])
        self.assertEqual(payload['sourceCuts'], [2, 3])
        self.assertEqual(payload['variants'][1]['label'], payloads['jersey']['variants'][1]['label'])
        self.assertEqual(payload['tracking_fingerprint'], hashlib.sha256(Path(result['alternativeTracks']).read_bytes()).hexdigest())
        self.assertEqual(json.loads(child['payloads']['original'])['tracking_fingerprint'],
            hashlib.sha256(Path(result['tracks']).read_bytes()).hexdigest())
        self.assertEqual(payload['trackingMetadata']['source_tracking_fingerprint'], payloads['jersey']['tracking_fingerprint'])
        self.assertEqual(payload['identitySuggestions']['entities'][0]['bindings'],
            [{'start': 0, 'end': 1, 'trackId': 7}, {'start': 2, 'end': 2, 'trackId': 7}, {'start': 3, 'end': 4, 'trackId': 7}])
        child_payloads = {key: json.loads(value) for key, value in child['payloads'].items()}
        nested_result = trim_review_clip({'video': result['video'], 'payload': payload, 'payloads': child_payloads},
            [{'start': 0, 'end': 4}], self.root / 'legacy-nested-cut')
        nested = json.loads(self.load({**nested_result, 'id': 'nested'})['payloads']['jersey'])
        self.assertEqual(nested['sourceCuts'], [2, 3])
        self.assertEqual(nested['identitySuggestions'], payload['identitySuggestions'])
        self.assertEqual(nested['trackingMetadata']['origin_tracking_revision'], 'jersey')
        self.assertEqual(nested['trackingMetadata']['origin_tracking_fingerprint'], payloads['jersey']['tracking_fingerprint'])
        self.assertEqual(nested['tracking_fingerprint'], hashlib.sha256(Path(nested_result['alternativeTracks']).read_bytes()).hexdigest())
        self.assertEqual((self.root / 'original.json').read_bytes(), original_bytes)
        self.assertEqual(jersey.read_bytes(), jersey_bytes)

    def test_same_detector_identity_supplement_is_regenerated_after_multicut_and_nested_trim(self):
        records = json.loads((self.root / 'original.json').read_text())
        for record in records:record['tracks'] = [[1, 2, 20, 40, 1, .9, 2], [24, 2, 40, 40, 2, .8, 2]]
        grouped = {'version': 1, 'verified': False, 'method': 'team',
            'teamGrouping': {'version': 1, 'verified': False, 'layout': 'reserved_5_plus_5_v1'},
            'entities': [{'id': 'P6', 'sourcePlayerId': 'P1', 'teamGroup': 'B',
                          'bindings': [{'start': 0, 'end': 5, 'trackId': 1}]}]}
        ungrouped = {'version': 1, 'verified': False, 'method': 'conservative-common-frame-segments',
            'entities': [{'id': 'P1', 'bindings': [{'start': 0, 'end': 5, 'trackId': 1}]},
                         {'id': 'P2', 'bindings': [{'start': 0, 'end': 5, 'trackId': 2}]}]}
        for name, suggestions in [('team-stable', grouped), ('optimized', ungrouped)]:
            path = self.root / f'{name}.json';path.write_text(json.dumps(records), encoding='utf-8')
            path.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': self.digest, 'frames': 6,
                'identitySuggestions': suggestions, **({'presentation': {'version': 1}} if name == 'team-stable' else {})}),
                encoding='utf-8')
            self.sample['trackingVariants'].append({'id': name, 'label': name, 'tracks': str(path)})
        self.sample.update(defaultVariant='team-stable', sourceCuts=[4])
        parent = self.load();payloads = {k: json.loads(v) for k, v in parent['payloads'].items()}
        self.assertIsNotNone(payloads['team-stable'].get('identitySupplement'))
        result = trim_review_clip({'video': self.video, 'payload': payloads['team-stable'], 'payloads': payloads},
            [{'start': 0, 'end': 1}, {'start': 4, 'end': 5}], self.root / 'supplement-cut')
        child = self.load({**result, 'id': 'child'});entries = {k: json.loads(v) for k, v in child['payloads'].items()}
        team = entries['team-stable'];supplement = team['identitySupplement']
        self.assertEqual(supplement['tracking_raw_fingerprint'], team['tracking_raw_fingerprint'])
        self.assertNotEqual(supplement['tracking_raw_fingerprint'], payloads['team-stable']['tracking_raw_fingerprint'])
        self.assertEqual(supplement['video_sha256'], team['video_sha256'])
        self.assertEqual(supplement['sourceCuts'], [2])
        self.assertEqual(supplement['identitySuggestions'], entries['optimized']['identitySuggestions'])
        self.assertEqual(supplement['identitySuggestions']['entities'][1]['bindings'],
            [{'start': 0, 'end': 1, 'trackId': 2}, {'start': 2, 'end': 3, 'trackId': 2}])
        for path in [result['tracks'], *(v['tracks'] for v in result['trackingVariants'])]:
            self.assertNotIn('identitySupplement', json.loads(Path(path).with_suffix('.meta.json').read_text(encoding='utf-8')))
        nested_result = trim_review_clip({'video': result['video'], 'payload': team, 'payloads': entries},
            [{'start': 1, 'end': 3}], self.root / 'supplement-nested-cut')
        nested = self.load({**nested_result, 'id': 'nested'})
        nested_entries = {k: json.loads(v) for k, v in nested['payloads'].items()}
        supplement = nested_entries['team-stable']['identitySupplement']
        self.assertEqual(supplement['identitySuggestions'], nested_entries['optimized']['identitySuggestions'])
        self.assertEqual(supplement['sourceCuts'], [1])
        self.assertEqual(len(supplement['frameMapping']), 3)
        self.assertEqual(supplement['video_sha256'], nested_entries['team-stable']['video_sha256'])


if __name__ == '__main__':
    unittest.main()
