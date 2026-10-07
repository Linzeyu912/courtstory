"""Authenticated CloudFront gateway for the unchanged loopback workbench."""
import hashlib
import hmac
import http.client
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import parse_qs, urlsplit

import boto3
from state_archive import state_files

ROOT = Path('/opt/hks/current')
CONFIG = Path('/etc/hks/gateway.json')
STATE = {'syncedFiles': 0, 'lastSync': None, 'error': None}
SESSION = secrets.token_urlsafe(48)
LOGIN_ATTEMPTS = []
LOCK = threading.Lock()


def configuration():
    return json.loads(CONFIG.read_text())


def trusted_origin(headers, expected):
    return bool(expected) and headers.get('Host') == urlsplit(expected).netloc and headers.get('Origin', expected) == expected


def authenticated(headers):
    cookies = SimpleCookie()
    try:
        cookies.load(headers.get('Cookie', ''))
        return 'hks_session' in cookies and hmac.compare_digest(cookies['hks_session'].value, SESSION)
    except Exception:
        return False


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


LOGIN = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>工作台 · 云端测试</title><style>body{font:17px system-ui;background:#111827;color:#edf2f7;display:grid;place-items:center;min-height:95vh}main{max-width:420px;padding:36px;border:1px solid #374151;border-radius:18px}input,button{box-sizing:border-box;width:100%;padding:13px;margin-top:16px;border-radius:8px;font:inherit}button{background:#b5ef6a;border:0}p{color:#a7b2c4;line-height:1.7}</style><main><h1>篮球战术工作台</h1><p>云端交互测试入口。输入本次测试访问码，进入现有工作台。</p><form method="post" action="/login"><input name="code" type="password" required autocomplete="current-password" placeholder="测试访问码"><button>进入工作台</button></form></main></html>'''


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
                return self.reply(200, '{"gateway":"ready"}', 'application/json')
            if not trusted_origin(self.headers, config.get('origin')):
                return self.reply(403, '请求来源不正确。')
            if route == '/login':
                if self.command in ('GET', 'HEAD'):
                    return self.reply(200, LOGIN)
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 2048:
                    return self.reply(400, '访问码无效。')
                with LOCK:
                    LOGIN_ATTEMPTS[:] = [v for v in LOGIN_ATTEMPTS if time.time() - v < 60]
                    if len(LOGIN_ATTEMPTS) >= 10:
                        return self.reply(429, '请稍后重试。')
                    LOGIN_ATTEMPTS.append(time.time())
                code = parse_qs(self.rfile.read(size).decode()).get('code', [''])[0]
                if not hmac.compare_digest(hashlib.sha256(code.encode()).hexdigest(), config['codeHash']):
                    return self.reply(401, LOGIN)
                return self.reply(303, headers={'Location': '/', 'Set-Cookie':
                    'hks_session=' + SESSION + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=14400'})
            if not authenticated(self.headers):
                return self.reply(303 if self.command in ('GET', 'HEAD') else 401,
                                  headers={'Location': '/login'})
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
        except Exception as error:
            self.reply(502, '云端工作台尚未就绪：' + type(error).__name__)


def main():
    threading.Thread(target=sync_loop, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()


if __name__ == '__main__':
    main()
