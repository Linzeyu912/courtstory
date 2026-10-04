"""Exercise media byte ranges over real HTTP connections."""
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest

from serve_comparison_report import ReportHandler


class QuietHandler(ReportHandler):
    def log_message(self, *args):
        pass


class ComparisonReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = TemporaryDirectory()
        cls.payload = bytes(range(256)) * 16
        root = Path(cls.directory.name)
        (root / 'video.mp4').write_bytes(cls.payload)
        (root / 'index.html').write_text('report', encoding='utf-8')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.directory.cleanup()

    def request(self, method='GET', path='/video.mp4', range_header=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method, path, headers={'Range': range_header} if range_header else {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_full_video_and_index(self):
        status, headers, body = self.request()
        self.assertEqual((status, body), (200, self.payload))
        self.assertEqual(headers['Content-Type'], 'video/mp4')
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.request(path='/')[2], b'report')

    def test_prefix_seek_suffix_and_clipped_ranges(self):
        for requested, first, last in [('bytes=0-1023', 0, 1023), ('bytes=2048-', 2048, 4095),
                                       ('bytes=-100', 3996, 4095), ('bytes=4000-9999', 4000, 4095)]:
            with self.subTest(requested=requested):
                status, headers, body = self.request(range_header=requested)
                self.assertEqual(status, 206)
                self.assertEqual(headers['Content-Range'], f'bytes {first}-{last}/4096')
                self.assertEqual(int(headers['Content-Length']), last-first+1)
                self.assertEqual(body, self.payload[first:last+1])

    def test_invalid_ranges_have_no_video_body(self):
        for requested in ['bytes=4096-', 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4']:
            with self.subTest(requested=requested):
                status, headers, body = self.request(range_header=requested)
                self.assertEqual((status, body), (416, b''))
                self.assertEqual(headers['Content-Range'], 'bytes */4096')

    def test_head_and_missing_file(self):
        status, headers, body = self.request(method='HEAD')
        self.assertEqual((status, body), (200, b''))
        self.assertEqual(int(headers['Content-Length']), len(self.payload))
        self.assertEqual(self.request(path='/missing.mp4')[0], 404)


if __name__ == '__main__':
    unittest.main()
