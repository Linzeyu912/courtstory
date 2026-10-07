"""Direct Python ZIP runtime: read evidence, invoke the allowed model, store a candidate."""
import base64
import json
import os
import re
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BUCKET = os.environ['HKS_BUCKET']
PREFIX = os.environ['HKS_PREFIX'].rstrip('/') + '/agent-jobs/'


@lru_cache(maxsize=1)
def get_clients():
    """Initialize reusable SDK clients when work arrives, after HTTP startup."""
    started = time.monotonic()
    print('CLIENT_INIT start', flush=True)
    import boto3
    from botocore.config import Config

    s3 = boto3.client('s3', region_name='us-east-1')
    model = boto3.client('bedrock-runtime', region_name='us-east-1', config=Config(
        connect_timeout=10, read_timeout=240, retries={'total_max_attempts': 2, 'mode': 'standard'}))
    print(f'CLIENT_INIT ready elapsed_seconds={time.monotonic() - started:.3f}', flush=True)
    return s3, model


def analyze(request):
    key = request.get('inputKey', '')
    if not re.fullmatch(re.escape(PREFIX) + r'[a-f0-9]{32}/input\.json', key):
        raise ValueError('Invalid input key')
    s3, model = get_clients()
    response = s3.get_object(Bucket=BUCKET, Key=key)
    with response['Body'] as stream:
        payload = json.loads(stream.read(48 * 1024 * 1024 + 1))
    images = payload['images']
    if not isinstance(images, list) or not 1 <= len(images) <= 24:
        raise ValueError('Expected 1-24 evidence images')
    content = [{'text': payload['prompt'] + '\n只输出符合以下 schema 的 JSON 对象，不添加 Markdown：\n'
                + json.dumps(payload['schema'], ensure_ascii=False)}]
    for encoded in images:
        image = base64.b64decode(encoded, validate=True)
        if len(image) > 3_500_000:
            raise ValueError('Evidence image too large')
        content.append({'image': {'format': 'jpeg', 'source': {'bytes': image}}})
    response = model.converse(modelId='qwen.qwen3-vl-235b-a22b',
        messages=[{'role': 'user', 'content': content}],
        inferenceConfig={'maxTokens': 8192, 'temperature': 0.2})
    answer = '\n'.join(c.get('text', '') for c in response['output']['message']['content']).strip()
    if answer.startswith('```'):
        answer = re.sub(r'^```(?:json)?\s*|\s*```$', '', answer)
    candidate = json.loads(answer)
    if not isinstance(candidate, dict):
        raise ValueError('Model did not return a JSON object')
    result_key = key.rsplit('/', 1)[0] + '/result.json'
    s3.put_object(Bucket=BUCKET, Key=result_key,
        Body=json.dumps(candidate, ensure_ascii=False).encode('utf-8'),
        ContentType='application/json', ServerSideEncryption='AES256')
    return {'resultKey': result_key, 'usage': response.get('usage'), 'model': 'qwen.qwen3-vl-235b-a22b'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Evidence, prompts and credentials do not belong in access logs.

    def reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == '/ping' else 404, {'status': 'Healthy'})

    def do_POST(self):
        if self.path != '/invocations':
            return self.reply(404, {'error': 'Unknown route'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096:
                raise ValueError('Invalid request size')
            self.reply(200, analyze(json.loads(self.rfile.read(size))))
        except Exception as error:
            self.reply(200, {'error': type(error).__name__ + ': ' + str(error)[:500]})


def main():
    with ThreadingHTTPServer(('0.0.0.0', 8080), Handler) as server:
        print('HTTP_READY', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
