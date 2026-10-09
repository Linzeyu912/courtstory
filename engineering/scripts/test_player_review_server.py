"""Exercise review loading against real decoded video times and corrupt inputs."""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

from serve_player_review import load_clip, missing_sample_files, video_source_info
from detector_evidence import build_detector_evidence


class RaisingParser:
    def error(self, message):
        raise ValueError(message)


class ReviewServerTests(unittest.TestCase):
    def test_vfr_media_end_uses_stream_tail_instead_of_nominal_decoded_frame_duration(self):
        video=self.root/'vfr.mp4'
        with av.open(str(video),'w') as container:
            stream=container.add_stream('libx264',rate=10);stream.width=64;stream.height=48;stream.pix_fmt='yuv420p'
            stream.time_base=Fraction(1,1000);stream.codec_context.time_base=Fraction(1,1000)
            pts_values=sorted([i*100 for i in range(81)]+[i*100+50 for i in range(80) if i%2==0])
            for i,pts in enumerate(pts_values):
                frame=av.VideoFrame.from_ndarray(np.full((48,64,3),i,np.uint8),format='rgb24');frame.pts=pts;frame.time_base=Fraction(1,1000)
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        with av.open(str(video)) as container:
            stream=container.streams.video[0];decoded=list(container.decode(video=0));expected=float(((stream.start_time or 0)+stream.duration)*stream.time_base)
            self.assertNotAlmostEqual(expected,float(decoded[-1].time+decoded[-1].duration*decoded[-1].time_base))
        info=video_source_info(video,include_end=True);self.assertAlmostEqual(info[-1],expected);self.assertEqual(len(info[2]),121)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.video = self.root / 'source.mp4'
        with av.open(str(self.video), 'w') as container:
            stream = container.add_stream('libx264', rate=25)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            stream.codec_context.time_base = Fraction(1, 1000)
            for index, pts in enumerate([120, 160, 240, 280]):
                frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), index * 30, dtype=np.uint8), format='rgb24')
                frame.pts, frame.time_base = pts, Fraction(1, 1000)
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        with av.open(str(self.video)) as container:
            self.times = [float(frame.time) for frame in container.decode(video=0)]
        self.digest = hashlib.sha256(self.video.read_bytes()).hexdigest()
        self.records = [dict(frame=index, time=time, tracks=[[1, 2, 20, 40, 1, .9, 2]],
                             pending_detections=[[25, 3, 40, 42, .2, 2]], candidate_count=2)
                        for index, time in enumerate(self.times)]
        self.tracks = self.write_variant('original', self.records)
        self.sample = {'id': 'fixture', 'video': str(self.video), 'tracks': str(self.tracks), 'videoSha256': self.digest}

    def write_variant(self, name, records=None, **metadata):
        path = self.root / (name + '.json')
        path.write_text(json.dumps(self.records if records is None else records), encoding='utf-8')
        path.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': self.digest,
            'frames': len(self.times), 'model': 'fixture-player', 'identity_verified': False, **metadata}), encoding='utf-8')
        return path

    def load(self, variant='original'):
        clip = load_clip(RaisingParser(), self.sample)
        self.assertIn(variant, clip['payloads'], 'Missing explicitly configured tracking variant')
        return json.loads(clip['payloads'][variant])

    def add_variant(self, name='optimized', **metadata):
        path = self.write_variant(name, **metadata)
        self.sample['trackingVariants'] = [{'id': name, 'label': '篮球模型优化', 'tracks': str(path)}]
        return path

    def test_original_keeps_exact_existing_draft_fingerprint_and_source_pts(self):
        payload = self.load()
        self.assertEqual(payload['tracking_fingerprint'], hashlib.sha256(self.tracks.read_bytes()).hexdigest())
        self.assertEqual([frame['time'] for frame in payload['frames']], self.times)
        self.assertEqual(payload['video_sha256'], self.digest)
        self.assertEqual(self.video.read_bytes(), Path(self.sample['video']).read_bytes())
        self.assertFalse(payload['detectorEvidence']['partition_complete'])

    def test_video_stream_tail_is_published_without_using_the_previous_pts_delta(self):
        payload = self.load()
        with av.open(str(self.video)) as container:
            decoded = list(container.decode(video=0))
            last = decoded[-1];stream=container.streams.video[0]
            expected_end = float(((stream.start_time or 0)+stream.duration)*stream.time_base)
        self.assertGreater(last.duration, 0)
        self.assertEqual(payload['mediaEndTime'], expected_end)
        self.assertEqual(video_source_info(self.video, include_end=True)[-1], expected_end)
        self.assertEqual(len(video_source_info(self.video)), 4)

    def test_detector_evidence_is_derived_without_mutating_records_or_legacy_fingerprints(self):
        for row in self.records:
            row.update(suppressed_detections=[[2, 3, 18, 39, .7, 2]], raw_detection_count=3,
                       detection_indices={'tracks': [2], 'pending_detections': [0], 'suppressed_detections': [1]},
                       track_evidence={'1': {'raw_detection_index': 2, 'native_detection_index': 2}})
        self.write_variant('original', self.records)
        before = self.tracks.read_bytes()
        metadata_before = self.tracks.with_suffix('.meta.json').read_bytes()
        legacy = self.load()
        self.assertFalse(legacy['detectorEvidence']['partition_complete'])
        self.assertEqual(legacy['frames'], self.records)
        self.assertEqual(legacy['tracking_fingerprint'], hashlib.sha256(before).hexdigest())
        self.assertEqual(self.tracks.read_bytes(), before)
        self.assertEqual(self.tracks.with_suffix('.meta.json').read_bytes(), metadata_before)
        self.write_variant('original', self.records, detector_evidence=build_detector_evidence(self.records))
        declared = self.load()
        self.assertTrue(declared['detectorEvidence']['partition_complete'])
        self.assertEqual(declared['detectorEvidence']['raw_detection_count'], 12)
        self.assertEqual(declared['frames'], self.records)
        self.assertEqual(declared['tracking_fingerprint'], legacy['tracking_fingerprint'])

    def test_explicit_variant_returns_its_metadata_and_unverified_identity_suggestions(self):
        suggestions = {'version': 1, 'method': 'appearance_proposal', 'verified': False,
            'entities': [{'id': 'P1', 'teamHint': 'dark', 'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]}]}
        self.add_variant(identitySuggestions=suggestions, tracker='BoT-SORT')
        payload = self.load('optimized')
        self.assertEqual(payload['trackingMetadata']['tracker'], 'BoT-SORT')
        self.assertEqual(payload['identitySuggestions'], suggestions)
        self.assertEqual(payload['variants'], [{'id': 'original', 'label': '原跟踪 · 保留已有草稿', 'recommended': False},
                                              {'id': 'optimized', 'label': '篮球模型优化', 'recommended': False}])

    def test_shared_observation_file_keeps_each_version_payload_and_saved_draft_fingerprint(self):
        optimized = self.write_variant('optimized', variant='optimized')
        team = self.write_variant('team-stable', variant='team-stable',
            presentation={'version': 1, 'default_stable': True})
        self.sample['trackingVariants'] = [
            {'id': 'optimized', 'label': 'Raw', 'tracks': str(optimized)},
            {'id': 'team-stable', 'label': 'Stable', 'tracks': str(team)}]
        before = load_clip(RaisingParser(), self.sample)['payloads']
        self.sample['trackingVariants'][0].update(tracks=str(team), metadata=str(optimized.with_suffix('.meta.json')))
        optimized.unlink()
        self.assertEqual(missing_sample_files(self.sample), [])
        after = load_clip(RaisingParser(), self.sample)['payloads']
        self.assertEqual(after, before, 'Sharing raw bytes must not change any API payload or draft key')
        self.assertNotEqual(json.loads(after['optimized'])['tracking_fingerprint'],
                            json.loads(after['team-stable'])['tracking_fingerprint'])
        optimized.with_suffix('.meta.json').unlink()
        self.assertIn(optimized.with_suffix('.meta.json'), missing_sample_files(self.sample))
        with self.assertRaisesRegex(ValueError, 'optimized.*metadata'):
            self.load()

    def test_explicit_metadata_path_is_validated_and_cannot_fall_back_to_another_versions_sidecar(self):
        self.add_variant()
        variant = self.sample['trackingVariants'][0]
        for value in ['', ' ', None, 12, {}]:
            variant['metadata'] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'metadata path'):
                self.load()
        wrong = self.root / 'wrong.meta.json'
        wrong.write_text(json.dumps({'video_sha256': 'other-video', 'frames': len(self.times)}), encoding='utf-8')
        variant['metadata'] = str(wrong)
        with self.assertRaisesRegex(ValueError, 'metadata does not match'):
            self.load()
        variant.update(metadata=str(self.root / 'absent.json'), optional=True)
        self.assertNotIn('optimized', load_clip(RaisingParser(), self.sample)['payloads'])

    def test_team_overlay_static_assets_are_served_over_real_http_with_exact_contents(self):
        state=self.root/'http-server.json'
        command=[sys.executable,str(Path(__file__).with_name('serve_player_review.py')),'--video',str(self.video),
            '--tracks',str(self.tracks),'--port','0','--state-file',str(state),'--trim-root',str(self.root/'trim'),
            '--court-profile',str(self.root/'no-court.json'), '--import-cache',str(self.root/'imports'),
            '--video-folder',str(self.root/'inbox'), '--tactics-folder',str(self.root/'tactics')]
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+10
            while not state.is_file() and process.poll() is None and time.monotonic()<deadline:time.sleep(.02)
            self.assertTrue(state.is_file(),'Fixture HTTP server did not reach readiness')
            url=json.loads(state.read_text())['url'];static=Path(__file__).resolve().parents[1]/'tools/player-review'
            with urlopen(url+'app.mjs',timeout=3) as response:self.assertEqual(response.status,200)
            with urlopen(url+'api/commentary-drawing/status',timeout=3) as response:
                drawing=json.load(response)
            self.assertIn('available',drawing)
            self.assertNotIn('codex',str(drawing).lower())
            request=Request(url+'api/commentary-drawing/jobs',data=json.dumps({'sample':'legacy','variant':'original','qa':True}).encode(),
                            headers={'Content-Type':'application/json'},method='POST')
            with self.assertRaises(HTTPError) as missing_plan:urlopen(request,timeout=3)
            self.assertEqual(missing_plan.exception.code,400)
            def post_commentary(path,payload):
                request=Request(url+path,data=json.dumps({'sample':'legacy','variant':'original','qa':True,**payload}).encode(),
                                headers={'Content-Type':'application/json'},method='POST')
                with urlopen(request,timeout=5) as response:return json.load(response)
            plan={'summary':'人工测试稿','cues':[
                {'cueId':'c1','text':'传球','suggestedStartTime':0,'suggestedEndTime':.08,'delivery':'pause'},
                {'cueId':'c2','text':'接应','suggestedStartTime':.08,'suggestedEndTime':.16,'delivery':'pause'}]}
            saved=post_commentary('api/commentary/save',{'plan':plan,'expectedRevision':0})
            saved=saved.get('plan',saved)
            edited=post_commentary('api/commentary/cues/c1',{'patch':{'text':'传给队友','language':'zh-CN'},'expectedCue':saved['cues'][0]})
            self.assertEqual(edited['plan']['revision'],2)
            self.assertEqual(edited['plan']['cues'][1],saved['cues'][1])
            self.assertNotEqual(edited['plan']['digest'],saved['digest'])
            with self.assertRaises(HTTPError) as cue_conflict:
                post_commentary('api/commentary/cues/c1',{'patch':{'text':'过期修改'},'expectedCue':saved['cues'][0]})
            self.assertEqual(cue_conflict.exception.code,409)
            with self.assertRaises(HTTPError) as unknown_cancel:
                post_commentary('api/commentary/jobs/'+'a'*32+'/cancel',{})
            self.assertEqual(unknown_cancel.exception.code,400)
            for name,mime in [('team-overlay.mjs','text/javascript'),('team-overlay-policy.json','application/json'),
                              ('commentary-client.mjs','text/javascript'),('commentary-ui.mjs','text/javascript'),
                              ('commentary-ui.css','text/css'),
                              ('automatic-annotations.mjs','text/javascript'),
                              ('identity-continuation.mjs','text/javascript'),('identity-agent-client.mjs','text/javascript'),
                              ('tracking-display.mjs','text/javascript'),('court-trails.mjs','text/javascript'),
                              *[(name,'text/javascript') for name in ('tactics-time-range.mjs','court-preparation.mjs','court-smoothing.mjs','court-preparation-ui.mjs','identity-coverage.mjs','tactics-court-editor.mjs','tactics-keyframes.mjs','tactics-court-projection.mjs','tactics-timeline-ui.mjs')]]:
                with self.subTest(asset=name):
                    try:response=urlopen(url+name,timeout=3)
                    except HTTPError as error:response=error
                    with response:
                        self.assertEqual(response.status,200)
                        self.assertEqual(response.headers.get_content_type(),mime)
                        self.assertEqual(response.read(),(static/name).read_bytes())
        finally:
            if process.poll() is None:process.terminate()
            process.communicate(timeout=5)

    def test_identity_supplement_uses_only_exact_same_raw_detector_and_does_not_change_draft_fingerprint(self):
        records = copy.deepcopy(self.records)
        for record in records:record['tracks'].append([24, 2, 40, 40, 2, .8, 2])
        ungrouped = {'version': 1, 'verified': False, 'method': 'conservative-common-frame-segments',
            'entities': [{'id': 'P1', 'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]},
                         {'id': 'P2', 'bindings': [{'start': 0, 'end': 3, 'trackId': 2}]}]}
        grouped = {'version': 1, 'verified': False, 'method': 'reliable-multiframe-team-slots-v1',
            'teamGrouping': {'version': 1, 'verified': False, 'layout': 'reserved_5_plus_5_v1'},
            'entities': [{'id': 'P6', 'sourcePlayerId': 'P1', 'teamGroup': 'B',
                          'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]}]}
        optimized = self.write_variant('optimized', records, identitySuggestions=ungrouped)
        team = self.write_variant('team-stable', records, identitySuggestions=grouped,
                                  presentation={'version': 1, 'source_records_unchanged': True})
        self.sample.update(sourceCuts=[2], defaultVariant='team-stable', trackingVariants=[
            {'id': 'team-stable', 'label': 'Team', 'tracks': str(team)},
            {'id': 'optimized', 'label': 'Optimized', 'tracks': str(optimized)}])
        raw_hash = hashlib.sha256(team.read_bytes()).hexdigest()
        metadata = json.loads(team.with_suffix('.meta.json').read_text())
        legacy_fingerprint = hashlib.sha256(json.dumps({'tracks_sha256': raw_hash, 'trackingMetadata': metadata},
            sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        payload = self.load('team-stable')
        supplement = payload.get('identitySupplement')
        self.assertIsNotNone(supplement, 'Grouped proposals need same-detector ungrouped identities')
        self.assertEqual(supplement['identitySuggestions'], ungrouped)
        self.assertEqual(supplement['tracking_raw_fingerprint'], raw_hash)
        self.assertEqual(supplement['video_sha256'], self.digest)
        self.assertEqual(supplement['sourceCuts'], [2])
        self.assertEqual([row[:2] for row in supplement['frameMapping']], [[i, t] for i, t in enumerate(self.times)])
        self.assertEqual(payload['tracking_fingerprint'], legacy_fingerprint)
        self.assertIsNone(self.load('optimized').get('identitySupplement'))
        records[0]['tracks'][0][0] += 1
        optimized.write_text(json.dumps(records), encoding='utf-8')
        self.assertIsNone(self.load('team-stable').get('identitySupplement'), 'Another raw detector may not donate IDs')

    def test_legacy_alternative_is_still_jersey_with_independent_data(self):
        records = copy.deepcopy(self.records)
        records[0]['tracks'][0][4] = 7
        self.sample['alternativeTracks'] = str(self.write_variant('jersey', records))
        payload = self.load('jersey')
        self.assertEqual(payload['tracking_revision'], 'jersey')
        self.assertEqual(payload['frames'][0]['tracks'][0][4], 7)
        self.assertNotEqual(payload['tracking_fingerprint'], self.load()['tracking_fingerprint'])

    def test_player_only_variant_receives_same_video_objects_without_changing_tracks_or_fingerprint(self):
        source = copy.deepcopy(self.records)
        for row in source:
            row['objects'] = [{'kind': 'basketball', 'box': [3, 4, 8, 9], 'score': .8, 'groundPoint': False}]
        source[1]['objects'] = []
        ebard = self.write_variant('ebard', source)
        team = self.write_variant('team-stable')
        self.sample.update(defaultVariant='team-stable', trackingVariants=[
            {'id': 'ebard', 'label': 'Objects', 'tracks': str(ebard)},
            {'id': 'team-stable', 'label': 'People', 'tracks': str(team)}])
        original_bytes = team.read_bytes()
        before = self.load('team-stable')
        self.assertEqual([r['objects'] for r in before['frames']], [r['objects'] for r in source])
        self.assertEqual([r['tracks'] for r in before['frames']], [r['tracks'] for r in self.records])
        self.assertEqual(before['sceneObjectSource']['variant'], 'ebard')
        self.assertEqual(team.read_bytes(), original_bytes)
        # Reference content is independently identified, not folded into the
        # historic person-draft key. No T IDs or manual identities are borrowed.
        source[0]['objects'] = []
        ebard.write_text(json.dumps(source), encoding='utf-8')
        after = self.load('team-stable')
        self.assertEqual(before['tracking_fingerprint'], after['tracking_fingerprint'])
        self.assertNotEqual(before['sceneObjectSource'], after['sceneObjectSource'])

    def test_explicit_empty_object_observations_are_not_filled_and_bad_reference_time_is_rejected(self):
        source = copy.deepcopy(self.records)
        for row in source:
            row['objects'] = [{'kind': 'hoop', 'box': [3, 4, 8, 9], 'score': .8}]
        ebard = self.write_variant('ebard', source)
        explicit = [{**row, 'objects': []} for row in self.records]
        team = self.write_variant('team-stable', explicit)
        self.sample.update(trackingVariants=[{'id': 'ebard', 'label': 'Objects', 'tracks': str(ebard)},
            {'id': 'team-stable', 'label': 'Explicit misses', 'tracks': str(team)}])
        self.assertTrue(all(row['objects'] == [] for row in self.load('team-stable')['frames']))
        self.assertIsNone(self.load('team-stable')['sceneObjectSource'])
        source[0]['time'] += .5
        ebard.write_text(json.dumps(source), encoding='utf-8')
        with self.assertRaises(ValueError): self.load('team-stable')

    def test_actual_http_defaults_and_multiversion_trim_preserve_metadata_and_reject_escaped_cache_paths(self):
        ebard = self.write_variant('ebard', pipeline_version='ebard-yolov8n-bytetrack-v1', detector_id='ebard_yolov8n')
        team = self.write_variant('team-stable', presentation={'version': 1, 'default_stable': True},
            identitySuggestions={'version': 1, 'method': 'team', 'verified': False,
                'entities': [{'id': 'P6', 'teamGroup': 'B', 'teamHint': 'white',
                              'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]}]})
        self.sample.update(defaultVariant='team-stable', title='HTTP fixture', trackingVariants=[
            {'id': 'ebard', 'label': '远端篮球模型', 'tracks': str(ebard), 'recommended': True},
            {'id': 'team-stable', 'label': '本机分队', 'tracks': str(ebard), 'metadata': str(team.with_suffix('.meta.json'))}])
        team.unlink()  # The real HTTP trim must retain separate metadata for shared records.
        library = self.root / 'input-library.json'
        library.write_text(json.dumps({'defaultSample': 'fixture', 'samples': [self.sample]}), encoding='utf-8')
        cache = self.root / 'trim';cache.mkdir()
        safe_video, safe_tracks = cache / 'cached.mp4', cache / 'cached.json'
        safe_video.write_bytes(self.video.read_bytes());safe_tracks.write_bytes(self.tracks.read_bytes())
        (cache / 'library.json').write_text(json.dumps([{'id': 'escaped', 'parentSample': 'fixture',
            'parentVideoSha256': self.digest, 'video': str(safe_video), 'tracks': str(safe_tracks),
            'trackingVariants': [{'id': 'ebard', 'label': 'escaped variant', 'tracks': str(ebard)}]}]), encoding='utf-8')
        state = self.root / 'http-default-server.json'
        command = [sys.executable, str(Path(__file__).with_name('serve_player_review.py')), '--library', str(library),
            '--port', '0', '--state-file', str(state), '--trim-root', str(cache),
            '--import-cache',str(self.root/'imports'), '--video-folder',str(self.root/'inbox'),
            '--tactics-folder',str(self.root/'tactics')]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not state.is_file() and process.poll() is None and time.monotonic() < deadline:time.sleep(.02)
            self.assertTrue(state.is_file(), 'Fixture HTTP server did not reach readiness')
            url = json.loads(state.read_text())['url']
            with urlopen(url + 'api/library', timeout=3) as response:
                exposed = json.load(response)
            self.assertEqual([sample['id'] for sample in exposed['samples']], ['fixture'])
            self.assertEqual(exposed['samples'][0]['defaultVariant'], 'team-stable')
            with urlopen(url + 'api/clip?sample=fixture', timeout=3) as response:
                self.assertEqual(json.load(response)['variant'], 'team-stable')
            request = Request(url + 'api/trim', data=json.dumps({'sample': 'fixture', 'qa': True,
                'ranges': [{'start': 0, 'end': 1}, {'start': 3, 'end': 3}]}).encode(),
                headers={'Content-Type': 'application/json'}, method='POST')
            with urlopen(request, timeout=5) as response:
                cut = json.load(response)
            with urlopen(url + 'api/clip?sample=' + cut['sample'], timeout=3) as response:
                payload = json.load(response)
            self.assertEqual(payload['variant'], 'team-stable')
            self.assertEqual({entry['id'] for entry in payload['variants']}, {'original', 'ebard', 'team-stable'})
            self.assertEqual(payload['sourceCuts'], [2])
            self.assertEqual(payload['trackingMetadata']['source_tracking_revision'], 'team-stable')
            self.assertEqual(payload['identitySuggestions']['entities'][0]['teamGroup'], 'B')
            self.assertEqual(payload['identitySuggestions']['entities'][0]['bindings'],
                [{'start': 0, 'end': 1, 'trackId': 1}, {'start': 2, 'end': 2, 'trackId': 1}])
        finally:
            if process.poll() is None:process.terminate()
            process.communicate(timeout=5)

    def test_legacy_jersey_preserves_exact_old_draft_file_digest_when_metadata_changes(self):
        path = self.write_variant('jersey')
        self.sample['alternativeTracks'] = str(path)
        existing_draft_fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(self.load('jersey')['tracking_fingerprint'], existing_draft_fingerprint)
        self.write_variant('jersey', tracker='updated-description-only')
        self.assertEqual(self.load('jersey')['tracking_fingerprint'], existing_draft_fingerprint)

    def test_actual_http_legacy_jersey_post_and_nested_trim_keep_metadata_and_reserved_draft_identity(self):
        records = copy.deepcopy(self.records)
        for record in records:record['tracks'][0][4] = 7
        jersey = self.write_variant('jersey', records, identitySuggestions={'version': 1, 'method': 'legacy_jersey',
            'verified': False, 'entities': [{'id': 'P2', 'bindings': [{'start': 0, 'end': 3, 'trackId': 7}]}]})
        original_bytes, jersey_bytes = self.tracks.read_bytes(), jersey.read_bytes()
        state, cache = self.root / 'http-jersey-server.json', self.root / 'legacy-http-cuts'
        command = [sys.executable, str(Path(__file__).with_name('serve_player_review.py')), '--video', str(self.video),
            '--tracks', str(self.tracks), '--alternative-tracks', str(jersey), '--port', '0',
            '--state-file', str(state), '--trim-root', str(cache), '--court-profile', str(self.root / 'no-court.json'),
            '--import-cache',str(self.root/'imports'), '--video-folder',str(self.root/'inbox'),
            '--tactics-folder',str(self.root/'tactics')]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not state.is_file() and process.poll() is None and time.monotonic() < deadline:time.sleep(.02)
            self.assertTrue(state.is_file(), 'Legacy HTTP fixture did not reach readiness')
            url = json.loads(state.read_text())['url']
            with urlopen(url + 'api/clip?sample=legacy&variant=jersey', timeout=3) as response:
                parent = json.load(response)
            self.assertEqual(parent['tracking_fingerprint'], hashlib.sha256(jersey_bytes).hexdigest())
            request = Request(url + 'api/trim', data=json.dumps({'sample': 'legacy', 'variant': 'jersey', 'qa': True,
                'ranges': [{'start': 0, 'end': 1}, {'start': 3, 'end': 3}]}).encode(),
                headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urlopen(request, timeout=5) as response:cut = json.load(response)
            except Exception as error:self.fail(f'Legacy jersey POST trim must return a usable child: {error}')
            with urlopen(url + 'api/clip?sample=' + cut['sample'], timeout=3) as response:
                child = json.load(response)
            self.assertEqual(child['variant'], 'jersey')
            self.assertEqual({entry['id'] for entry in child['variants']}, {'original', 'jersey'})
            self.assertEqual(child['sourceCuts'], [2])
            self.assertEqual(child['variants'][1]['label'], parent['variants'][1]['label'])
            self.assertEqual(child['trackingMetadata']['source_tracking_fingerprint'], parent['tracking_fingerprint'])
            self.assertEqual(child['tracking_fingerprint'], hashlib.sha256((cache / cut['sample'] / 'tracks-jersey.json').read_bytes()).hexdigest())
            bindings = [{'start': 0, 'end': 1, 'trackId': 7}, {'start': 2, 'end': 2, 'trackId': 7}]
            self.assertEqual(child['identitySuggestions']['entities'][0]['bindings'], bindings)
            nested_request = Request(url + 'api/trim', data=json.dumps({'sample': cut['sample'], 'qa': True,
                'ranges': [{'start': 0, 'end': 2}]}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
            with urlopen(nested_request, timeout=5) as response:nested_cut = json.load(response)
            with urlopen(url + 'api/clip?sample=' + nested_cut['sample'], timeout=3) as response:
                nested = json.load(response)
            self.assertEqual(nested['variant'], 'jersey')
            self.assertEqual(nested['sourceCuts'], [2])
            self.assertEqual(nested['identitySuggestions']['entities'][0]['bindings'], bindings)
            self.assertEqual(nested['trackingMetadata']['origin_tracking_fingerprint'], parent['tracking_fingerprint'])
            self.assertEqual(self.tracks.read_bytes(), original_bytes)
            self.assertEqual(jersey.read_bytes(), jersey_bytes)
        finally:
            if process.poll() is None:process.terminate()
            process.communicate(timeout=5)

    def test_optional_unavailable_variant_keeps_original_and_falls_back_default(self):
        path = self.add_variant()
        self.sample['trackingVariants'][0]['optional'] = True
        self.sample['defaultVariant'] = 'optimized'
        path.unlink()
        payload = self.load()
        self.assertEqual(payload['defaultVariant'], 'original')
        self.assertEqual([entry['id'] for entry in payload['variants']], ['original'])

    def test_available_default_variant_is_exposed_and_unknown_default_is_rejected(self):
        self.add_variant()
        self.sample['defaultVariant'] = 'optimized'
        self.assertEqual(self.load()['defaultVariant'], 'optimized')
        self.sample['defaultVariant'] = 'typo'
        with self.assertRaisesRegex(ValueError, 'defaultVariant'):
            self.load()

    def test_remote_original_label_and_recommendation_are_exposed_with_local_label_compatibility(self):
        self.sample['originalTrackingLabel'] = '本地历史标签'
        self.assertEqual(self.load()['variants'][0]['label'], '本地历史标签')
        self.sample['originalLabel'] = '远端通用 YOLOv8s'
        self.add_variant('ebard')
        self.sample['trackingVariants'][0]['recommended'] = True
        payload = self.load('ebard')
        self.assertEqual(payload['variant'], 'ebard')
        self.assertEqual(payload['variants'][0]['label'], '远端通用 YOLOv8s')
        self.assertTrue(payload['variants'][1]['recommended'])

    def test_optional_local_default_falls_back_to_available_remote_recommended_variant(self):
        remote = self.write_variant('ebard')
        self.sample['trackingVariants'] = [
            {'id': 'team-stable', 'label': '本机分队', 'tracks': str(self.root / 'missing.json'), 'optional': True},
            {'id': 'ebard', 'label': '远端篮球模型', 'tracks': str(remote), 'recommended': True}]
        self.sample['defaultVariant'] = 'team-stable'
        clip = load_clip(RaisingParser(), self.sample)
        self.assertEqual(clip['defaultVariant'], 'ebard')
        for variant in ['original', 'ebard']:
            self.assertEqual(json.loads(clip['payloads'][variant])['defaultVariant'], 'ebard')

    def test_legacy_remote_ebard_raw_fingerprint_survives_metadata_changes_but_new_proposals_change_it(self):
        path = self.add_variant('ebard', pipeline_version='ebard-yolov8n-bytetrack-v1', detector_id='ebard_yolov8n')
        existing = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(self.load('ebard')['tracking_fingerprint'], existing)
        self.write_variant('ebard', pipeline_version='ebard-yolov8n-bytetrack-v1', detector_id='ebard_yolov8n',
                           processing_seconds=3.5)
        self.assertEqual(self.load('ebard')['tracking_fingerprint'], existing)
        self.write_variant('ebard', pipeline_version='ebard-yolov8n-bytetrack-v1', detector_id='ebard_yolov8n',
                           identitySuggestions={'version': 1, 'method': 'new_proposal', 'verified': False,
                               'entities': [{'id': 'P1', 'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]}]})
        self.assertNotEqual(self.load('ebard')['tracking_fingerprint'], existing)

    def test_new_variants_require_sidecars_legacy_original_does_not(self):
        self.tracks.with_suffix('.meta.json').unlink()
        self.assertEqual(self.load()['tracking_revision'], 'original')
        path = self.add_variant()
        path.with_suffix('.meta.json').unlink()
        with self.assertRaisesRegex(ValueError, 'optimized.*metadata'):
            self.load()

    def test_each_variant_metadata_must_match_video_hash_and_frame_count(self):
        for field, value in [('video_sha256', 'wrong-source'), ('frames', 99)]:
            with self.subTest(field=field):
                self.add_variant(**{field: value})
                with self.assertRaisesRegex(ValueError, 'optimized.*metadata'):
                    self.load()

    def test_legacy_alternative_metadata_is_validated_too(self):
        self.sample['alternativeTracks'] = str(self.write_variant('jersey', video_sha256='another-video'))
        with self.assertRaisesRegex(ValueError, 'jersey.*metadata'):
            self.load()

    def test_records_need_exact_tracked_and_pending_row_shapes(self):
        for variant in ['original', 'optimized', 'jersey']:
            for field, row in [('tracks', [1, 2, 20, 40, .9, 2]),
                               ('pending_detections', [1, 2, 20, 40, 9, .9, 2])]:
                with self.subTest(variant=variant, field=field):
                    data = copy.deepcopy(self.records)
                    data[0][field] = [row]
                    path = self.write_variant(variant, data)
                    self.sample.pop('alternativeTracks', None)
                    self.sample.pop('trackingVariants', None)
                    if variant == 'optimized':
                        self.sample['trackingVariants'] = [{'id': variant, 'label': variant, 'tracks': str(path)}]
                    elif variant == 'jersey':
                        self.sample['alternativeTracks'] = str(path)
                    with self.assertRaisesRegex(ValueError, field):
                        self.load()
                    self.write_variant('original')

    def test_duplicate_track_id_is_rejected_per_frame_but_allowed_across_frames(self):
        data = copy.deepcopy(self.records)
        data[1]['tracks'].append([21, 2, 35, 40, 1.0, .8, 2])
        self.write_variant('original', data)
        with self.assertRaisesRegex(ValueError, 'frame 1.*duplicate.*track'):
            self.load()

    def test_nonfinite_values_bad_ids_confidences_and_box_order_are_rejected(self):
        cases = [(0, float('nan')), (4, True), (4, 1.5), (4, 0), (5, 1.1), (6, .5), (2, 0)]
        for column, value in cases:
            with self.subTest(column=column, value=value):
                data = copy.deepcopy(self.records)
                data[0]['tracks'][0][column] = value
                self.write_variant('original', data)
                with self.assertRaises(ValueError):
                    self.load()

    def test_actual_variable_source_pts_cannot_be_replaced_by_nominal_fps(self):
        data = copy.deepcopy(self.records)
        for index, record in enumerate(data):
            record['time'] = index / 25
        self.add_variant()
        self.write_variant('optimized', data)
        with self.assertRaisesRegex(ValueError, 'optimized.*timestamp'):
            self.load()

    def test_missing_frame_and_nonsequential_frame_are_rejected_with_variant_context(self):
        for data in [self.records[:-1], [{**r, 'frame': i + 1} for i, r in enumerate(self.records)]]:
            with self.subTest(length=len(data)):
                self.add_variant()
                self.write_variant('optimized', data, frames=len(data))
                with self.assertRaisesRegex(ValueError, 'optimized.*frame'):
                    self.load()

    def test_duplicate_or_reserved_variant_ids_fail_before_overwriting_original(self):
        path = self.write_variant('optimized')
        for variants in [[{'id': 'original', 'label': 'wrong', 'tracks': str(path)}],
                         [{'id': 'optimized', 'label': 'A', 'tracks': str(path)},
                          {'id': 'optimized', 'label': 'B', 'tracks': str(path)}]]:
            with self.subTest(variants=variants):
                self.sample['trackingVariants'] = variants
                with self.assertRaisesRegex(ValueError, 'variant.*(unique|reserved|duplicate)'):
                    self.load()

    def test_new_variant_fingerprint_changes_with_metadata_or_suggestions_original_does_not(self):
        self.add_variant(tracker='BoT-SORT', parameters={'confidence': .1})
        first, original = self.load('optimized')['tracking_fingerprint'], self.load()['tracking_fingerprint']
        self.write_variant('optimized', tracker='BoT-SORT', parameters={'confidence': .2})
        self.assertNotEqual(first, self.load('optimized')['tracking_fingerprint'])
        second = self.load('optimized')['tracking_fingerprint']
        self.write_variant('optimized', tracker='BoT-SORT', parameters={'confidence': .2}, identitySuggestions={
            'version': 1, 'method': 'model', 'verified': False,
            'entities': [{'id': 'P1', 'bindings': [{'start': 0, 'end': 3, 'trackId': 1}]}]})
        self.assertNotEqual(second, self.load('optimized')['tracking_fingerprint'])
        self.assertEqual(original, self.load()['tracking_fingerprint'])

    def test_suggestion_person_ids_ranges_and_verification_flag_are_validated(self):
        for person, start, end, verified in [('P11', 0, 3, False), ('P1', -1, 3, False),
                                              ('P1', 0, 4, False), ('P1', 0, 3, True)]:
            with self.subTest(person=person, start=start, end=end, verified=verified):
                self.add_variant(identitySuggestions={'version': 1, 'method': 'model', 'verified': verified,
                    'entities': [{'id': person, 'bindings': [{'start': start, 'end': end, 'trackId': 1}]}]})
                with self.assertRaisesRegex(ValueError, 'identitySuggestions'):
                    self.load()

    def test_model_team_groups_reject_wrong_slot_or_oversized_and_remain_unverified(self):
        for group,identifier in [('C','P1'),('A','P6'),('B','P1')]:
            self.add_variant(identitySuggestions={'version':1,'method':'team','verified':False,
                'entities':[{'id':identifier,'teamGroup':group,'bindings':[{'start':0,'end':3,'trackId':1}]}]})
            with self.assertRaisesRegex(ValueError,'identitySuggestions'):self.load()
        valid={'version':1,'method':'team','verified':False,'teamGrouping':{'version':1,'layout':'reserved_5_plus_5_v1','verified':False},
            'entities':[{'id':'P1','teamGroup':'A','teamHint':'dark','bindings':[{'start':0,'end':3,'trackId':1}]}]}
        self.add_variant(identitySuggestions=valid);self.assertEqual(self.load('optimized')['identitySuggestions'],valid)
        valid['teamGrouping']['verified']=True;self.add_variant(identitySuggestions=valid)
        with self.assertRaisesRegex(ValueError,'identitySuggestions'):self.load()

    def test_baseline_adapter_cli_preserves_media_and_refuses_to_overwrite_candidates(self):
        probe = self.root / 'probe.json'
        probe.write_text(json.dumps({'frames': [{'frame_index': index,
            'global_source_video_timestamp_seconds': time,
            'detections': [{'xyxy': [1, 2, 20, 40], 'track_id': 1, 'confidence': .8, 'class_id': 2}]}
            for index, time in enumerate(self.times)]}), encoding='utf-8')
        output = self.root / 'adapted.json'
        command = [sys.executable, str(Path(__file__).with_name('adapt_player_review_tracks.py')),
                   '--video', str(self.video), '--probe', str(probe), '--output', str(output)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = json.loads(output.with_suffix('.meta.json').read_text())
        self.assertEqual(metadata['video_sha256'], self.digest)
        self.assertEqual(metadata['frames'], 4)
        self.assertFalse(metadata['identity_verified'])
        data = output.read_bytes()
        self.sample['tracks'] = str(output)
        self.assertEqual([record['time'] for record in self.load()['frames']], self.times)
        repeated = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(repeated.returncode, 0)
        self.assertEqual(output.read_bytes(), data)
        self.assertEqual(hashlib.sha256(self.video.read_bytes()).hexdigest(), self.digest)


if __name__ == '__main__':
    unittest.main()
