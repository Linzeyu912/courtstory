"""One-time GPU verification and encrypted OpenRouter smoke test on the notebook.

Only the encrypted key crosses S3. The private RSA key and decrypted API key
remain in this process. No API key is put in a notebook, shell log or template.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'vendor'))
import rsa


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--prefix', required=True)
    parser.add_argument('--notebook', required=True)
    args = parser.parse_args()
    aws = shutil.which('aws') or '/home/ec2-user/anaconda3/bin/aws'
    base = f's3://{args.bucket}/{args.prefix}'
    started = time.time()

    def put(name, value):
        subprocess.run([aws, 's3', 'cp', '-', base + name, '--region', 'us-east-1',
                        '--sse', 'AES256', '--content-type', 'application/json', '--only-show-errors'],
                       input=json.dumps(value).encode(), check=True, timeout=60)

    def status(stage, **extra):
        put('status.json', {'stage': stage, 'elapsed_seconds': round(time.time()-started, 2), **extra})

    def run(command, timeout=1200):
        print('Running:', ' '.join(map(str, command)), flush=True)
        subprocess.run(list(map(str, command)), cwd=ROOT, check=True, timeout=timeout)

    def http_json(url, payload=None, key=None):
        headers = {'Content-Type': 'application/json'}
        if key:
            headers['Authorization'] = 'Bearer ' + key
        request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.load(response)

    def openrouter_test():
        result = {'origin': 'SageMaker Notebook', 'region': 'us-east-1', 'model_requested': 'openai/gpt-6-astra'}
        try:
            code, models = http_json('https://openrouter.ai/api/v1/models')
            model = next(item for item in models['data'] if item['id'] == result['model_requested'])
            public, private = rsa.newkeys(2048)
            put('handshake.json', {'public_key': public.save_pkcs1().decode(), 'catalog_http_status': code,
                                  'model': {k: model[k] for k in ('id', 'architecture', 'pricing')}})
            encrypted = None
            for _ in range(240):
                request = subprocess.run([aws, 's3', 'cp', base+'encrypted-key.json', '-', '--region', 'us-east-1',
                                          '--only-show-errors'], capture_output=True, timeout=30)
                if request.returncode == 0:
                    encrypted = json.loads(request.stdout)['ciphertext']
                    break
                time.sleep(5)
            if encrypted is None:
                raise TimeoutError('No encrypted test credential received within 20 minutes.')
            key = rsa.decrypt(base64.b64decode(encrypted), private).decode()
            private = None
            marker = 'TEAM25_ASTRA_OK'
            payload = {'model': result['model_requested'], 'max_tokens': 512,
                       'reasoning': {'effort': 'low'},
                       'messages': [{'role': 'user', 'content': 'Reply with exactly this text and nothing else: '+marker}]}
            tick = time.perf_counter()
            http_status, response = http_json('https://openrouter.ai/api/v1/chat/completions', payload, key)
            key = None
            choice = response['choices'][0]
            text = choice['message'].get('content', '')
            result.update(http_status=http_status, elapsed_seconds=round(time.perf_counter()-tick, 3),
                          model_returned=response.get('model'), provider=response.get('provider'),
                          response_text=text, finish_reason=choice.get('finish_reason'), usage=response.get('usage'),
                          passed=http_status == 200 and text.strip() == marker and response.get('model') == result['model_requested'])
        except urllib.error.HTTPError as error:
            result.update(passed=False, http_status=error.code, error_type='HTTPError')
        except Exception as error:
            result.update(passed=False, error_type=type(error).__name__)
        finally:
            put('openrouter-result.json', result)

    router = threading.Thread(target=openrouter_test)
    try:
        info = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
                              check=True, capture_output=True, text=True, timeout=30).stdout.strip()
        status('gpu_detected', nvidia_smi=info)
        router.start()
        bundle = ROOT / 'vision-bundle.zip'
        run([aws, 's3', 'cp', base+'vision-bundle.zip', bundle, '--region', 'us-east-1', '--only-show-errors'], timeout=180)
        expected = json.loads((ROOT/'manifest.json').read_text())['bundle_sha256']
        if hashlib.sha256(bundle.read_bytes()).hexdigest() != expected:
            raise ValueError('The uploaded source bundle failed its checksum.')
        workspace = ROOT/'workspace'
        workspace.mkdir(exist_ok=True)
        with zipfile.ZipFile(bundle) as archive:
            for item in archive.infolist():
                if not (workspace/item.filename).resolve().is_relative_to(workspace.resolve()):
                    raise ValueError('Unsafe bundle path.')
            archive.extractall(workspace)
        status('installing_python', nvidia_smi=info)
        conda = Path('/home/ec2-user/anaconda3/bin/conda')
        env = ROOT/'runtime'
        run([conda, 'create', '--override-channels', '-c', 'conda-forge', '-p', env, 'python=3.12', 'pip', '-y'])
        python = env/'bin/python'
        status('installing_pytorch', nvidia_smi=info)
        run([python, '-m', 'pip', 'install', '--no-cache-dir', 'torch==2.11.0', 'torchvision==0.26.0',
             '--index-url', 'https://download.pytorch.org/whl/cu128'])
        status('installing_vision_dependencies', nvidia_smi=info)
        run([python, '-m', 'pip', 'install', '--no-cache-dir', 'ultralytics==8.4.171', 'numpy==2.4.3',
             'scipy==1.17.1', 'av==17.0.0', 'pillow==12.1.1', 'opencv-python==5.0.0.93', 'lap>=0.5.12'])
        status('running_vision_smoke', nvidia_smi=info)
        run([python, ROOT/'vision_smoke.py', '--workspace', workspace], timeout=600)
        result = json.loads((workspace/'gpu-smoke-result.json').read_text())
        put('gpu-result.json', result)
        status('gpu_validation_complete', passed=result['passed'], nvidia_smi=info)
    except Exception as error:
        status('failed', error_type=type(error).__name__, message=str(error)[:600])
    finally:
        if router.ident is not None:
            router.join(timeout=1300)
        try:
            subprocess.run([aws, 's3', 'cp', ROOT/'bootstrap.log', base+'bootstrap.log', '--region', 'us-east-1',
                            '--sse', 'AES256', '--only-show-errors'], timeout=60)
        finally:
            print('Initial verification finished; stopping the notebook and preserving its volume.', flush=True)
            subprocess.run([aws, 'sagemaker', 'stop-notebook-instance', '--notebook-instance-name', args.notebook,
                            '--region', 'us-east-1'], check=True, timeout=60)


if __name__ == '__main__':
    main()
