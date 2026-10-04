"""Read-only preflight of the configured GPU interpreter and allowlisted weights."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import threading
import time
from workbench_models import PRESETS

# Same pinned artifacts validated again by prepare_tracking_variants.inspect_runtime.
WEIGHTS = {
    'ebard': ('BODD_yolov8n_0001.pt', 'dfe3534d51bb21024d1a400c37f0c1fbf0c8b96ea9a56a5f3cb5454813bfd641'),
    'yolo': ('yolov8s.pt', '1f47a78bf100391c2a140b7ac73a1caae18c32779be7d310658112f7ac9aa78a'),
}


def probe_interpreter(python):
    if not Path(python).is_file():
        return {'available': False, 'reason': f'找不到推理 Python：{python}。请配置 --inference-python。'}
    # Import checks only. No YOLO construction, downloads, model inference or configuration writes.
    script = '''import importlib, importlib.metadata as m, json
try:
    for name in ('av', 'numpy', 'cv2', 'lap', 'torch', 'torchvision'):
        importlib.import_module(name)
    version = m.version('ultralytics')
    if version != '8.4.171': raise RuntimeError('需要 ultralytics 8.4.171，当前为 ' + version)
    import torch
    if not torch.cuda.is_available(): raise RuntimeError('当前推理环境没有可用的 CUDA GPU')
    result = dict(available=True, reason='', device=torch.cuda.get_device_name(0), torch=torch.__version__, ultralytics=version)
except Exception as error:
    result = dict(available=False, reason=type(error).__name__ + ': ' + str(error))
print(json.dumps(result, ensure_ascii=True))'''
    try:
        result = subprocess.run([str(python), '-B', '-c', script], capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=30,
                                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            return {'available': False, 'reason': '推理 Python 检查失败：' + (result.stderr.strip()[-600:] or f'退出码 {result.returncode}')}
        return json.loads(result.stdout.strip().splitlines()[-1])
    except Exception as error:
        return {'available': False, 'reason': f'推理环境检查失败：{error}'}


class RuntimeProbe:
    def __init__(self, python, models):
        self.python, self.models = Path(python), Path(models)
        self.lock = threading.RLock()
        self.checked_at, self.runtime, self.weights = 0, None, {}

    def __call__(self):
        with self.lock:
            # GPU/package startup is expensive; file signatures still refresh on every request.
            if self.runtime is None or time.monotonic() - self.checked_at > 60:
                self.runtime, self.checked_at = probe_interpreter(self.python), time.monotonic()
            detectors = {}
            for ident, (filename, expected) in WEIGHTS.items():
                path = self.models / filename
                reason = self.runtime.get('reason', '') if not self.runtime['available'] else ''
                if not reason:
                    if not path.is_file():
                        reason = f'缺少模型权重 {filename}；请检查 --models。'
                    else:
                        stat = path.stat()
                        signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
                        cached = self.weights.get(ident)
                        if cached is None or cached[0] != signature:
                            with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                            self.weights[ident] = (signature, digest)
                        if self.weights[ident][1] != expected:
                            reason = f'模型权重 {filename} 的 SHA-256 与已验证版本不一致。'
                detectors[ident] = {'available': not bool(reason), 'reason': reason, 'filename': filename}
            variants = {item['id']: copy.deepcopy(detectors[item['detector']]) for item in PRESETS}
            available = any(item['available'] for item in variants.values())
            return {**copy.deepcopy(self.runtime), 'available': available,
                    'reason': '' if available else detectors['ebard']['reason'], 'detectors': detectors, 'variants': variants}


def worker_failure(log, returncode):
    with Path(log).open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 8192))
        lines = stream.read().decode('utf-8', errors='replace').splitlines()
    significant = [line.strip() for line in lines if line.strip()]
    exceptions = [line for line in significant
                  if re.match(r'^[\w.]+(?:Error|Exception):', line)
                  and not line.startswith(('subprocess.CalledProcessError:', 'CalledProcessError:'))]
    if any('Weights only load failed' in line for line in significant):
        reason = '模型权重加载不兼容，受限加载未识别所需的模型类型'
    else:
        reason = (exceptions[-1] if exceptions else significant[-1])[:800] if significant else f'进程退出码 {returncode}'
    return f'识别失败：{reason}。可重试；详细日志：{log}'
