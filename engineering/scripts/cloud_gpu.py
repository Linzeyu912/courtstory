"""Private S3 job transport between the workbench and one SageMaker GPU worker."""
import io
import json
import os
from pathlib import Path
import time
import uuid
import zipfile


class CloudGPU:
    def __init__(self):
        import boto3
        from botocore.config import Config
        self.bucket = os.environ['HKS_BUCKET']
        self.prefix = os.environ['HKS_GPU_PREFIX'].rstrip('/') + '/'
        self.s3 = boto3.client('s3', region_name='us-east-1', config=Config(
            connect_timeout=10, read_timeout=60, retries={'total_max_attempts': 3}))

    def read(self, key):
        try:
            with self.s3.get_object(Bucket=self.bucket, Key=self.prefix + key)['Body'] as stream:
                return json.load(stream)
        except self.s3.exceptions.ClientError as error:
            if error.response['Error']['Code'] in ('404', 'NoSuchKey'):
                return None
            raise

    def put(self, key, body):
        self.s3.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=body,
                           ServerSideEncryption='AES256')

    def status(self):
        from workbench_models import PRESETS
        try:
            state = self.read('heartbeat.json') or {}
            ready = bool(state.get('available')) and time.time() - state.get('updatedAt', 0) < 90
            reason = '' if ready else '云端 GPU 未就绪，请检查 SageMaker 实例与 worker 服务。'
        except Exception as error:
            state, ready, reason = {}, False, '无法连接云端 GPU：' + type(error).__name__
        detector = {'available': ready, 'reason': reason}
        return {**state, **detector, 'remote': True,
                'detectors': state['detectors'] if ready and 'detectors' in state else
                    {name: dict(detector) for name in ('ebard', 'yolo')},
                'variants': state['variants'] if ready and 'variants' in state else
                    {item['id']: dict(detector) for item in PRESETS}}

    def submit(self, operation, source, options, timeout):
        if not self.status()['available']:
            raise ValueError('云端 GPU 未就绪，请稍后重试。')
        token = uuid.uuid4().hex
        base = 'jobs/' + token + '/'
        if isinstance(source, Path):
            self.s3.upload_file(str(source), self.bucket, self.prefix + base + 'input',
                                ExtraArgs={'ServerSideEncryption': 'AES256'})
        else:
            self.put(base + 'input', source)
        # EC2 has object access only. Create the pending result before publishing
        # the request so polling never needs bucket-list permission for a missing key.
        self.put(base + 'result.json', b'null')
        self.put(base + 'request.json', json.dumps({
            'operation': operation, 'options': options, 'deadline': time.time() + timeout}).encode())
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = self.read(base + 'result.json')
            if result:
                if result.get('error'):
                    raise ValueError('云端 GPU 处理失败：' + result['error'])
                return base, result
            time.sleep(1 if operation == 'court' else 3)
        raise TimeoutError('云端 GPU 处理超时；请查看 worker 日志。')

    def track(self, source, destination, ident, variant):
        source = Path(source)
        base, result = self.submit('track', source,
            {'id': ident, 'variant': variant, 'sourceSuffix': source.suffix.lower()}, 1800)
        archive = destination / 'gpu-output.zip'
        self.s3.download_file(self.bucket, self.prefix + base + 'output.zip', str(archive))
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                if not (destination / item.filename).resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Invalid GPU output path')
            bundle.extractall(destination)
        archive.unlink()
        old_root = result['outputRoot'].rstrip('/') + '/'

        def remap(value):
            if isinstance(value, str) and value.startswith(old_root):
                return str(destination / value[len(old_root):])
            if isinstance(value, dict):
                return {k: remap(v) for k, v in value.items()}
            if isinstance(value, list):
                return [remap(v) for v in value]
            return value

        for path in destination.rglob('*.json'):
            value = remap(json.loads(path.read_text(encoding='utf-8')))
            path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        sample = json.loads((destination / 'sample.json').read_text(encoding='utf-8'))
        sample.update(title=source.stem, description='上传视频 · ' + source.name, importSourceName=source.name)
        (destination / 'sample.json').write_text(json.dumps(sample, ensure_ascii=False), encoding='utf-8')
        return sample

    def court(self, image, imgsz):
        import numpy as np
        stream = io.BytesIO()
        np.save(stream, image, allow_pickle=False)
        _, result = self.submit('court', stream.getvalue(), {'imgsz': imgsz}, 150)
        return np.asarray(result['points'], dtype=float)
