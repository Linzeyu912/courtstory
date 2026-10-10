import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock
import zipfile

from cloud_gpu import CloudGPU


class CloudGPUTests(unittest.TestCase):
    def test_stopped_worker_disables_model_selection(self):
        gpu = CloudGPU.__new__(CloudGPU)
        gpu.read = Mock(return_value={'available': True, 'updatedAt': time.time() - 120})
        result = gpu.status()
        self.assertFalse(result['available'])
        self.assertTrue(all(not item['available'] for item in result['variants'].values()))

    def test_downloaded_tracking_paths_are_local_and_readable(self):
        gpu = CloudGPU.__new__(CloudGPU)
        gpu.bucket, gpu.prefix = 'private-bucket', 'gpu/'
        gpu.submit = Mock(return_value=('jobs/test/', {'outputRoot': '/gpu/output'}))
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('sample.json', json.dumps({'video': '/gpu/output/video.mp4',
                'tracks': '/gpu/output/tracks.json', 'trackingVariants': [{'tracks': '/gpu/output/tracks.json'}]}))
            archive.writestr('tracks.json', '[]')
            archive.writestr('video.mp4', b'fixture')
        gpu.s3 = Mock()
        gpu.s3.download_file.side_effect = lambda bucket, key, path: Path(path).write_bytes(data.getvalue())
        with tempfile.TemporaryDirectory() as directory:
            result = gpu.track(Path('source.mp4'), Path(directory), 'id', 'variant')
            self.assertEqual(Path(result['video']).read_bytes(), b'fixture')
            self.assertEqual(result['tracks'], result['trackingVariants'][0]['tracks'])
            self.assertTrue(Path(result['tracks']).is_relative_to(directory))

    def test_download_cannot_escape_job_directory(self):
        gpu = CloudGPU.__new__(CloudGPU)
        gpu.bucket, gpu.prefix = 'private-bucket', 'gpu/'
        gpu.submit = Mock(return_value=('jobs/test/', {'outputRoot': '/gpu/output'}))
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('../outside.txt', 'invalid')
        gpu.s3 = Mock()
        gpu.s3.download_file.side_effect = lambda bucket, key, path: Path(path).write_bytes(data.getvalue())
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'Invalid GPU output path'):
                gpu.track(Path('source.mp4'), Path(directory), 'id', 'variant')


if __name__ == '__main__':
    unittest.main()
