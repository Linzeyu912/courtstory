"""Verify imports, immutable results, job errors and the loopback HTTP contract."""
import copy
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import av
import numpy as np

from local_video_library import LocalVideoLibrary, MAX_UPLOAD, file_hash
from process_local_video import prepare_video
from serve_player_review import validated_clip


class LocalLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.mp4'
        with av.open(str(self.source), 'w') as container:
            stream = container.add_stream('libx264', rate=10)
            stream.width, stream.height, stream.pix_fmt = 64, 48, 'yuv420p'
            for i in range(5):
                frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), i * 30, np.uint8), format='rgb24')
                for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(): container.mux(packet)
        self.published = {}
        self.library = self.make_library()
        self.addCleanup(self.library.close)

    def make_library(self, runner=None):
        return LocalVideoLibrary(self.root / 'inbox', self.root / 'cache', sys.executable, self.root,
            lambda sample, clip: self.published.update({sample['id']: clip}), validated_clip, runner or self.run_fixture)

    def run_fixture(self, ident, variant, source):
        folder = self.root / 'cache' / ident
        folder.mkdir(exist_ok=True)
        video = folder / 'video.mp4'
        if not video.exists(): shutil.copyfile(source, video)
        with av.open(str(video)) as container:
            records = [{'frame': i, 'time': float(frame.time), 'tracks': []} for i, frame in enumerate(container.decode(video=0))]
        tracks = folder / f'{variant}.json'
        tracks.write_text(json.dumps(records))
        tracks.with_suffix('.meta.json').write_text(json.dumps({'video_sha256': file_hash(video), 'frames': len(records)}))
        return {'id': ident, 'title': 'Local test', 'video': str(video), 'tracks': str(tracks),
            'defaultVariant': variant, 'trackingVariants': [{'id': variant, 'label': variant, 'tracks': str(tracks)}]}

    def upload(self, name='测试视频.mp4'):
        data = self.source.read_bytes()
        return self.library.import_stream(name, io.BytesIO(data), len(data))

    def shared_fixture(self):
        base = self.root / 'data/videos/uploads/test'; base.mkdir(parents=True)
        media = base / 'shared.mp4'; shutil.copyfile(self.source, media)
        asset = {'path': 'shared.mp4', 'bytes': media.stat().st_size, 'sha256': file_hash(media)}
        (base / 'manifest.json').write_text(json.dumps({'entries': [{'asset': asset}]}))
        catalog = self.root / 'data/videos/catalog.json'
        catalog.write_text(json.dumps({'datasets': [{'manifest': 'data/videos/uploads/test/manifest.json'}]}))
        self.library.shared_catalog = catalog
        return media, asset

    def test_shared_catalog_is_processable_without_copying_or_changing_source(self):
        media, asset = self.shared_fixture()
        entry = self.library.scan()['entries'][0]
        self.assertEqual(entry['origin'], 'shared'); self.assertTrue(entry['available'])
        self.assertEqual(self.library.paths[entry['id']], media.resolve())
        self.library.start(entry['id'], 'yolo'); self.wait(entry['id'])
        self.assertEqual(file_hash(media), asset['sha256'])
        self.assertEqual(list(self.library.folder.iterdir()), [])

    def test_lfs_pointer_is_visible_but_cannot_start_inference(self):
        media, asset = self.shared_fixture()
        media.write_text('version https://git-lfs.github.com/spec/v1\noid sha256:' + asset['sha256'] + '\nsize ' + str(asset['bytes']) + '\n')
        entry = self.library.scan()['entries'][0]
        self.assertFalse(entry['available']); self.assertEqual(entry['bytes'], asset['bytes'])
        with self.assertRaises(ValueError): self.library.start(entry['id'], 'yolo')

    def test_current_review_clip_can_be_processed_without_a_second_import(self):
        original = self.source.read_bytes()
        ident = self.library.register_review_source(self.source, '已裁切的工作台视频')
        self.assertEqual(self.library.scan()['entries'][0]['origin'], 'review')
        self.library.start(ident, detector='ebard', tracker='bytetrack')
        self.assertEqual(self.wait(ident)['status'], 'ready')
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(list(self.library.folder.iterdir()), [])

    def wait(self, ident):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with self.library.lock:
                job = copy.deepcopy(self.library.jobs[ident])
            if job['status'] not in {'queued', 'running'}: return job
            time.sleep(.02)
        self.fail('Job failed to finish')

    def test_import_folder_scan_and_content_dedup_keep_original_bytes(self):
        result = self.upload()
        self.assertFalse(result['duplicate'])
        other = self.upload('另一名称.mp4')
        self.assertEqual(other['id'], result['id'])
        self.assertTrue(other['duplicate'])
        self.assertEqual((self.root / 'inbox/测试视频.mp4').read_bytes(), self.source.read_bytes())
        nested = self.root / 'inbox/nested'
        nested.mkdir()
        shutil.copyfile(self.source, nested / 'duplicate.mp4')
        entry = self.library.scan()['entries'][0]
        self.assertEqual(entry['copies'], 2)
        self.assertEqual(entry['status'], 'pending')
        self.assertEqual(list((self.root / 'inbox').glob('*.part')), [])

    def test_detector_and_tracker_selection_queue_separate_immutable_results(self):
        ident = self.upload()['id']
        with self.assertRaises(ValueError):
            self.library.start(ident, 'team-stable', 'ebard', 'bytetrack')
        self.assertNotIn(ident, self.library.jobs)
        self.library.start(ident, detector='ebard', tracker='bytetrack')
        self.assertEqual(self.wait(ident)['status'], 'ready')
        prior = copy.deepcopy(self.library.saved[ident])
        prior_bytes = Path(prior['tracks']).read_bytes()
        self.library.start(ident, detector='yolo', tracker='botsort-reid')
        self.assertEqual(self.wait(ident)['status'], 'ready')
        variants = self.library.saved[ident]['trackingVariants']
        self.assertEqual({item['id'] for item in variants}, {'ebard-byte', 'yolo-team'})
        self.assertEqual(Path(prior['tracks']).read_bytes(), prior_bytes)
        self.assertEqual(next(item for item in variants if item['id']=='ebard-byte'), prior['trackingVariants'][0])

    def test_same_name_never_overwrites_different_file(self):
        existing = self.root / 'inbox/测试视频.mp4'
        existing.write_bytes(b'original contents')
        self.upload()
        self.assertEqual(existing.read_bytes(), b'original contents')
        self.assertEqual(len(list(existing.parent.glob('*.mp4'))), 2)

    def test_invalid_names_sizes_and_truncated_video_leave_no_files(self):
        for name in ['../bad.mp4', 'C:\\bad.mp4', '<x>.mp4', 'CON.mp4', 'bad.exe']:
            with self.subTest(name=name), self.assertRaises(ValueError): self.upload(name)
        for size, data in [(MAX_UPLOAD+1, b''), (0, b''), (10, b'abc'), (3, b'abc')]:
            with self.subTest(size=size), self.assertRaises(ValueError):
                self.library.import_stream('bad.mp4', io.BytesIO(data), size)
        self.assertEqual(list((self.root / 'inbox').iterdir()), [])

    def test_ready_variants_restore_and_keep_prior_fingerprints(self):
        ident = self.upload()['id']
        self.library.start(ident, 'yolo')
        self.assertEqual(self.wait(ident)['status'], 'ready')
        first = json.loads(self.published[ident]['payloads']['yolo'])['tracking_fingerprint']
        self.library.start(ident, 'reid')
        self.assertEqual(self.wait(ident)['status'], 'ready')
        self.assertEqual(json.loads(self.published[ident]['payloads']['yolo'])['tracking_fingerprint'], first)
        restored = self.make_library()
        self.addCleanup(restored.close)
        self.assertEqual(set(restored.scan()['entries'][0]['variants']), {'yolo', 'reid'})
        self.assertEqual(restored.start(ident, 'yolo')['status'], 'ready')

    def test_processing_failure_preserves_ready_results_and_can_retry(self):
        ident = self.upload()['id']
        self.library.start(ident, 'yolo');self.wait(ident)
        before = self.library.manifest.read_bytes()
        def fail(*args): raise ValueError('model unavailable')
        self.library.runner = fail
        self.library.start(ident, 'reid')
        self.assertEqual(self.wait(ident)['status'], 'error')
        self.assertEqual(self.library.manifest.read_bytes(), before)
        self.assertEqual(self.library.scan()['entries'][0]['variants'], ['yolo'])
        self.library.runner = self.run_fixture
        self.library.start(ident, 'reid')
        self.assertEqual(self.wait(ident)['status'], 'ready')

    def test_duplicate_start_does_not_launch_two_jobs(self):
        ident = self.upload()['id']
        entered, release = threading.Event(), threading.Event()
        calls = []
        def delayed(*args):
            calls.append(args);entered.set();release.wait(5)
            return self.run_fixture(*args)
        self.library.runner = delayed
        self.library.start(ident, 'yolo')
        self.assertTrue(entered.wait(3))
        try:
            self.assertEqual(self.library.start(ident, 'reid')['variant'], 'yolo')
            self.assertEqual(len(calls), 1)
        finally: release.set()
        self.assertEqual(self.wait(ident)['status'], 'ready')

    def test_unknown_ids_and_models_rejected_without_jobs(self):
        with self.assertRaises(ValueError): self.library.start('missing', 'yolo')
        ident = self.upload()['id']
        with self.assertRaises(ValueError): self.library.start(ident, '../../shell')
        self.assertFalse(self.library.jobs)

    def test_changed_folder_file_gets_new_identity(self):
        first = self.upload()['id']
        (self.root / 'inbox/测试视频.mp4').write_bytes(b'different content')
        second = self.library.scan()['entries'][0]['id']
        self.assertNotEqual(first, second)
        with self.assertRaises(ValueError): self.library.start(first, 'yolo')

    def test_compatible_video_keeps_original_bytes(self):
        target = self.root / 'prepared.mp4'
        prepare_video(self.source, target)
        self.assertEqual(target.read_bytes(), self.source.read_bytes())

    def test_other_extension_transcodes_to_decodable_mp4_and_preserves_source(self):
        source = self.root / 'source.mov'
        source.write_bytes(self.source.read_bytes())
        original = source.read_bytes()
        target = self.root / 'converted.mp4'
        prepare_video(source, target)
        with av.open(str(target)) as container:
            self.assertEqual(container.streams.video[0].codec_context.name, 'h264')
            self.assertEqual(len(list(container.decode(video=0))), 5)
        self.assertEqual(source.read_bytes(), original)

    def test_real_http_import_scan_origin_and_static_module(self):
        sample = self.run_fixture('fixture', 'yolo', self.source)
        library = self.root / 'samples.json'
        library.write_text(json.dumps({'defaultSample': 'fixture', 'samples': [sample]}))
        state = self.root / 'server.json'
        log = (self.root / 'server.log').open('wb')
        self.addCleanup(log.close)
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('serve_player_review.py')),
            '--library', str(library), '--port', '0', '--state-file', str(state),
            '--video-folder', str(self.root / 'http-inbox'), '--import-cache', str(self.root / 'http-cache'),
            '--trim-root', str(self.root / 'trims'), '--tactics-folder', str(self.root / 'tactics')], stdout=log, stderr=log)
        try:
            deadline = time.monotonic()+15
            while not state.exists() and process.poll() is None and time.monotonic()<deadline: time.sleep(.05)
            self.assertTrue(state.exists(), (self.root / 'server.log').read_text(errors='replace'))
            url = json.loads(state.read_text())['url']
            with urlopen(url+'video-library.mjs') as response: self.assertEqual(response.status, 200)
            data = self.source.read_bytes()
            headers = {'Content-Type': 'application/octet-stream', 'X-Video-Filename': 'from-http.mp4', 'Origin': url[:-1]}
            with urlopen(Request(url+'api/video-library/import', data, headers)) as response:
                result = json.load(response)
            with urlopen(url+'api/video-library') as response:
                self.assertEqual(json.load(response)['entries'][0]['id'], result['id'])
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url+'api/video-library/import', data, {**headers, 'Origin': 'https://example.org'}))
            self.assertEqual(caught.exception.code, 403)
            with urlopen(url+'api/library') as response:
                self.assertEqual(json.load(response)['samples'][0]['id'], 'fixture')
        finally:
            process.terminate();process.wait(timeout=10)


if __name__ == '__main__': unittest.main()
