"""CloudFront gateway for the unchanged loopback workbench."""
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import threading
import time
from urllib.parse import urlsplit

import boto3
from state_archive import state_files

ROOT = Path('/opt/hks/current')
CONFIG = Path('/etc/hks/gateway.json')
STATE = {'syncedFiles': 0, 'lastSync': None, 'error': None}
LOCK = threading.Lock()


def configuration():
    return json.loads(CONFIG.read_text())


def trusted_origin(headers, expected):
    return bool(expected) and headers.get('Host') == urlsplit(expected).netloc and headers.get('Origin', expected) == expected


def sync_loop():
    s3 = boto3.client('s3', region_name='us-east-1')
    known = {}
    while True:
        try:
            config = configuration()
            count = 0
            source_root = ROOT.resolve()
            for path in state_files(source_root):
                stat = path.stat()
                stamp = (stat.st_size, stat.st_mtime_ns)
                if known.get(str(path)) == stamp or time.time() - stat.st_mtime < 2:
                    continue
                with path.open('rb') as stream:
                    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
                if (path.stat().st_size, path.stat().st_mtime_ns) != stamp:
                    continue
                key = config['prefix'] + '/workspace/' + path.relative_to(source_root).as_posix()
                s3.upload_file(str(path), config['bucket'], key,
                    ExtraArgs={'Metadata': {'sha256': sha}, 'ServerSideEncryption': 'AES256'})
                head = s3.head_object(Bucket=config['bucket'], Key=key)
                if head['ContentLength'] != stamp[0] or head.get('Metadata', {}).get('sha256') != sha:
                    raise ValueError('S3 backup verification failed')
                known[str(path)] = stamp
                count += 1
            with LOCK:
                STATE.update(syncedFiles=len(known), lastSync=time.time(), error=None)
        except Exception as error:
            with LOCK:
                STATE['error'] = type(error).__name__
        time.sleep(10)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body=b'', content_type='text/html; charset=utf-8', headers=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_HEAD(self):
        self.handle_request()

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        try:
            config = configuration()
            route = urlsplit(self.path).path
            if route == '/health' and self.command in ('GET', 'HEAD'):
                try:
                    with socket.create_connection(('127.0.0.1', 8876), timeout=2):
                        pass
                except OSError:
                    return self.reply(503, '{"gateway":"ready","workbench":"starting"}', 'application/json')
                return self.reply(200, '{"gateway":"ready","workbench":"ready"}', 'application/json')
            if not trusted_origin(self.headers, config.get('origin')):
                return self.reply(403, '请求来源不正确。')
            if route == '/login':
                return self.reply(303, headers={'Location': '/'})
            if route == '/api/cloud-state' and self.command in ('GET', 'HEAD'):
                with LOCK:
                    status = dict(STATE)
                status.update(mode='ec2-direct-code', agentcoreConfigured=bool(config.get('runtimeArn')),
                              backupMode='asynchronous-10-second-scan', release=config['release'])
                return self.reply(200, json.dumps(status), 'application/json')
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 220 * 1024 * 1024 or self.headers.get('Transfer-Encoding'):
                return self.reply(413, '本轮测试单个请求上限为 220 MiB。')
            connection = http.client.HTTPConnection('127.0.0.1', 8876, timeout=180)
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in ('host', 'origin', 'cookie', 'authorization', 'connection', 'transfer-encoding')}
            headers.update(Host='127.0.0.1:8876', Origin='http://127.0.0.1:8876', Connection='close')
            connection.putrequest(self.command, self.path, skip_host=True, skip_accept_encoding=True)
            for key, value in headers.items():
                connection.putheader(key, value)
            connection.endheaders()
            remaining = length
            while remaining:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    raise ValueError('Incomplete body')
                connection.send(chunk)
                remaining -= len(chunk)
            response = connection.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('server', 'date', 'connection', 'transfer-encoding', 'cache-control'):
                    self.send_header(key, value)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if self.command != 'HEAD':
                while chunk := response.read(65536):
                    self.wfile.write(chunk)
            connection.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ConnectionRefusedError:
            self.reply(503, json.dumps({'error':'工作台正在启动，请稍后刷新；已有草稿保留。'}, ensure_ascii=False), 'application/json; charset=utf-8')
        except Exception as error:
            self.reply(502, '云端工作台尚未就绪：' + type(error).__name__)


def main():
    threading.Thread(target=sync_loop, daemon=True).start()
    # ES module loading and job polling create bursts of parallel connections.
    class Server(ThreadingHTTPServer):
        request_queue_size = 128
    Server(('0.0.0.0', 8080), Handler).serve_forever()


if __name__ == '__main__':
    main()
