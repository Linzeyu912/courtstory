"""Run allowlisted tracking/court jobs with the existing persistent GPU runtime."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'engineering/scripts'))
from cloud_gpu import CloudGPU
from workbench_runtime import RuntimeProbe
from workbench_models import PRESETS


def main():
    cloud = CloudGPU()
    # The worker executes locally; do not dispatch recursively.
    os.environ.pop('HKS_GPU_PREFIX', None)
    runtime = RuntimeProbe(sys.executable, ROOT / 'tmp/models')
    jobs = ROOT / 'artifacts/gpu-jobs'
    jobs.mkdir(parents=True, exist_ok=True)

    def heartbeat():
        while True:
            try:
                cloud.put('heartbeat.json', json.dumps({**runtime(), 'updatedAt': time.time()}).encode())
            except Exception as error:
                print('Heartbeat:', type(error).__name__, flush=True)
            time.sleep(15)
    threading.Thread(target=heartbeat, daemon=True).start()
    completed = set()
    while True:
        try:
            pages = cloud.s3.get_paginator('list_objects_v2').paginate(
                Bucket=cloud.bucket, Prefix=cloud.prefix + 'jobs/')
            for page in pages:
                for item in page.get('Contents', []):
                    key = item['Key'][len(cloud.prefix):]
                    if key in completed or not re.fullmatch(r'jobs/[a-f0-9]{32}/request\.json', key):
                        continue
                    base = key.rsplit('/', 1)[0] + '/'
                    if cloud.read(base + 'result.json'):
                        completed.add(key)
                        continue
                    request = cloud.read(key)
                    folder = jobs / base.split('/')[1]
                    folder.mkdir(exist_ok=True)
                    try:
                        if request['deadline'] < time.time():
                            raise TimeoutError('Job expired before execution')
                        options = request['options']
                        suffix = options.get('sourceSuffix', '.mp4')
                        if suffix not in ('.mp4', '.mov', '.mkv', '.webm', '.avi'):
                            raise ValueError('Unsupported source video format')
                        source = folder / ('input' + suffix)
                        cloud.s3.download_file(cloud.bucket, cloud.prefix + base + 'input', str(source))
                        if request['operation'] == 'court':
                            import numpy as np
                            from court_calibration import CourtKeypointModel
                            image = np.load(source, allow_pickle=False)
                            points = CourtKeypointModel(ROOT / 'tmp/court-models-v2/best.pt', options['imgsz'])(image)
                            result = {'points': points.tolist(), 'device': 'cuda:0'}
                        elif request['operation'] == 'track':
                            if (not re.fullmatch(r'local-[a-f0-9]{64}', options['id']) or
                                    options['variant'] not in {p['id'] for p in PRESETS}):
                                raise ValueError('Invalid tracking selection')
                            output = folder / 'output'
                            output.mkdir(exist_ok=True)
                            command = [sys.executable, str(ROOT / 'engineering/scripts/process_local_video.py'),
                                '--source', str(source), '--source-sha256', options['id'][6:],
                                '--video', str(output / 'video.mp4'), '--output-dir', str(output),
                                '--variant', options['variant'], '--models', str(ROOT / 'tmp/models'),
                                '--id', options['id']]
                            with (folder / 'processing.log').open('wb') as log:
                                subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                    check=True, timeout=max(1, min(1800, request['deadline'] - time.time())))
                            archive = folder / 'output.zip'
                            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
                                for path in output.rglob('*'):
                                    if path.is_file():
                                        bundle.write(path, path.relative_to(output).as_posix())
                            cloud.s3.upload_file(str(archive), cloud.bucket, cloud.prefix + base + 'output.zip',
                                ExtraArgs={'ServerSideEncryption': 'AES256'})
                            result = {'outputRoot': str(output), 'device': 'cuda:0'}
                        else:
                            raise ValueError('Unknown GPU operation')
                    except Exception as error:
                        result = {'error': type(error).__name__ + ': ' + str(error)[:500]}
                        if (folder / 'processing.log').exists():
                            cloud.s3.upload_file(str(folder / 'processing.log'), cloud.bucket,
                                cloud.prefix + base + 'processing.log', ExtraArgs={'ServerSideEncryption': 'AES256'})
                    cloud.put(base + 'result.json', json.dumps(result).encode())
                    completed.add(key)
        except Exception as error:
            print('Worker:', type(error).__name__, flush=True)
        time.sleep(1)


if __name__ == '__main__':
    main()
