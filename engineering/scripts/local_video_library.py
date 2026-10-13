"""Local inbox, streamed imports and serialized inference jobs for the workbench."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import uuid
from workbench_models import PRESETS, MODEL_CHOICES, resolve_selection
from workspace_collection import WorkspaceCollection
from workbench_runtime import RuntimeProbe, worker_failure

ROOT = Path(__file__).resolve().parents[2]
EXTENSIONS = {'.mp4', '.mov', '.mkv', '.webm', '.avi'}
MAX_UPLOAD = 2 * 1024 ** 3
MANUAL_PRESET={'id':'manual','label':'直接人工制作（不识别）','description':'读取视频真实帧时间，不运行模型；固定画面标注可直接保存和导出。'}


def merge_review_sources(inventory, clips):
    """Attach old result choices without turning a newer failed/running job into ready."""
    inventory = copy.deepcopy(inventory)
    for entry in inventory['entries']:
        source = next(((ident, clip) for ident, clip in clips.items() if clip['digest'] == entry['sha256']), None)
        if source and not entry['variants']:
            ident, clip = source
            entry.update(sampleId=ident, variants=list(clip['payloads']))
            if entry['status'] not in {'queued', 'running', 'error'}:
                entry.update(status='ready', message='已有检测结果，可直接打开')
    return inventory


def file_hash(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def check_video(path):
    import av
    try:
        with av.open(str(path)) as container:
            if not container.streams.video or next(container.decode(video=0), None) is None:
                raise ValueError('没有可解码的视频画面。')
    except Exception as error:
        raise ValueError('无法读取这个视频，请检查文件是否完整。') from error


class LocalVideoLibrary:
    def __init__(self, folder, cache, python, models, publish, validate, runner=None, shared_catalog=None,
                 collection=None, runtime_probe=None):
        self.folder, self.cache = Path(folder).resolve(), Path(cache).resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.python, self.models = Path(python).resolve(), Path(models).resolve()
        self.publish, self.validate = publish, validate
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='video-inference')
        self.runner = runner or self._run
        self.collection = collection
        self.runtime_probe = runtime_probe or RuntimeProbe(self.python, self.models)
        self.shared_catalog = Path(shared_catalog).resolve() if shared_catalog else None
        self.paths, self.hashes, self.jobs = {}, {}, {}
        self.jobs_manifest = self.cache / 'jobs.json'
        if self.jobs_manifest.exists():
            self.jobs = json.loads(self.jobs_manifest.read_text(encoding='utf-8'))
            for job in self.jobs.values():
                if job['status'] in {'queued', 'running'}:
                    job.update(status='error', message='上次识别因服务停止而中断，请重试；已有结果和标注均保留。')
            atomic_json(self.jobs_manifest, self.jobs)
        self.review_sources = {}
        self.manifest = self.cache / 'library.json'
        self.saved = json.loads(self.manifest.read_text(encoding='utf-8')) if self.manifest.exists() else {}
        self.restore_errors = {}
        for ident, sample in self.saved.items():
            try:
                # Never serve files outside the configured cache from a saved local manifest.
                paths = [sample['video'], sample['tracks'], *(v['tracks'] for v in sample.get('trackingVariants', []))]
                paths.extend(v['metadata'] for v in sample.get('trackingVariants', []) if 'metadata' in v)
                if any(not Path(p).resolve().is_relative_to(self.cache) for p in paths):
                    raise ValueError('本地结果路径不在缓存目录内。')
                self.publish(sample, self.validate(sample))
            except Exception as error:
                self.restore_errors[ident] = f'已有结果无法加载：{error}'

    def scan(self, include_runtime=True):
        with self.lock:
            entries, paths = {}, {}
            candidates = [(p, 'local', p.relative_to(self.folder).as_posix(), None) for p in sorted(self.folder.rglob('*'))]
            candidates.extend((path, 'review', title, None) for path, title in self.review_sources.items())
            if self.shared_catalog and self.shared_catalog.is_file():
                repository = self.shared_catalog.parents[2]
                for dataset in json.loads(self.shared_catalog.read_text(encoding='utf-8'))['datasets']:
                    manifest_path = (repository / dataset['manifest']).resolve()
                    if not manifest_path.is_relative_to(self.shared_catalog.parent):
                        continue
                    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                    for entry in manifest['entries']:
                        asset = entry['asset']
                        if not asset.get('path') or not asset.get('sha256'):
                            continue
                        path = (manifest_path.parent / asset['path']).resolve()
                        if path.is_relative_to(self.shared_catalog.parent):
                            candidates.append((path, 'shared', path.relative_to(repository).as_posix(), asset))
            for path, origin, relative, asset in candidates:
                if path.suffix.lower() not in EXTENSIONS or not path.is_file():
                    continue
                resolved = path.resolve()
                if origin == 'local' and not resolved.is_relative_to(self.folder):
                    continue
                try:
                    stat = path.stat()
                    signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
                    old = self.hashes.get(str(path))
                    digest = old[1] if old and old[0] == signature else file_hash(path)
                    self.hashes[str(path)] = (signature, digest)
                except OSError:
                    continue  # A file may still be moving into the inbox.
                ident = 'local-' + digest
                unavailable = bool(asset and (stat.st_size != asset['bytes'] or digest != asset['sha256']))
                if unavailable:
                    ident = 'local-' + asset['sha256']
                if ident in entries:
                    entries[ident]['copies'] += 1
                    continue
                if not unavailable:
                    paths[ident] = resolved
                sample = self.saved.get(ident)
                ready = sample is not None and ident not in self.restore_errors
                job = self.jobs.get(ident)
                if ident in self.restore_errors and (not job or job['status'] == 'ready'):
                    # A historical success cannot validate files that failed this startup's checks.
                    job = {**(job or {}), 'status': 'error', 'message': self.restore_errors[ident]}
                entries[ident] = {'id': ident, 'filename': path.name, 'relativePath': relative,
                    'origin': origin, 'available': not unavailable,
                    'bytes': asset['bytes'] if unavailable else stat.st_size, 'sha256': asset['sha256'] if unavailable else digest, 'copies': 1, 'sampleId': ident if ready else None,
                    'variants': [v['id'] for v in sample.get('trackingVariants', [])] if ready else [],
                    'status': job['status'] if job else 'ready' if ready else 'pending',
                    'message': '共享视频尚未完整下载，请先下载 Git LFS 成片' if unavailable else job['message'] if job else self.restore_errors.get(ident, '已处理，可打开' if ready else '选择方案后开始处理'),
                    'jobVariant': job.get('variant') if job else None}
            self.paths = paths
            inventory = {'folder': str(self.folder), 'entries': list(entries.values()),
                         'presets': copy.deepcopy(PRESETS)+[MANUAL_PRESET],
                         'modelChoices': copy.deepcopy(MODEL_CHOICES), 'maxUploadBytes': MAX_UPLOAD}
        # A slow local interpreter or remote GPU heartbeat must not lock the library.
        if include_runtime:
            runtime = copy.deepcopy(self.runtime_probe())
            runtime.setdefault('variants',{})['manual']={'available':True,'reason':''}
            inventory.update(runtimeAvailable=runtime['available'], runtime=runtime)
        return inventory

    def import_stream(self, filename, stream, size):
        if (not isinstance(filename, str) or not filename or len(filename) > 180
                or re.search(r'[<>:"/\\|?*\x00-\x1f]', filename) or filename.rstrip(' .') != filename
                or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', filename)):
            raise ValueError('文件名无效，请使用普通视频文件名。')
        if Path(filename).suffix.lower() not in EXTENSIONS:
            raise ValueError('支持 MP4、MOV、MKV、WebM 和 AVI 视频。')
        if type(size) is not int or not 0 < size <= MAX_UPLOAD:
            raise ValueError('单次导入上限为 2 GB；更大的视频请直接放入视频文件夹。')
        temporary = self.folder / f'.upload-{uuid.uuid4().hex}.part'
        try:
            with temporary.open('xb') as output:
                remaining = size
                while remaining:
                    block = stream.read(min(1024 * 1024, remaining))
                    if not block:
                        raise ValueError('上传中断，请重新导入。')
                    output.write(block)
                    remaining -= len(block)
            check_video(temporary)
            ident = 'local-' + file_hash(temporary)
            with self.lock:
                self.scan(include_runtime=False)
                duplicate = ident in self.paths
                if not duplicate:
                    destination = self.folder / filename
                    if destination.exists():
                        destination = self.folder / f'{Path(filename).stem}-{uuid.uuid4().hex[:8]}{Path(filename).suffix.lower()}'
                    # Exclusive creation protects user files even if another app creates this name meanwhile.
                    with destination.open('xb') as output, temporary.open('rb') as source:
                        import shutil
                        shutil.copyfileobj(source, output)
                    self.scan(include_runtime=False)
                if self.collection:
                    self.collection.activate(ident)
            return {'id': ident, 'duplicate': duplicate}
        finally:
            temporary.unlink(missing_ok=True)

    def import_and_start(self, filename, stream, size, variant='team-stable'):
        imported = self.import_stream(filename, stream, size)
        ident = imported['id']
        try:
            job = self.start(ident, variant)
        except ValueError as error:
            with self.lock:
                current = self.jobs.get(ident)
                if current and current['status'] in {'queued', 'running'}:
                    job = copy.deepcopy(current)
                else:
                    job = {'status': 'error', 'variant': variant, 'message': str(error), 'sampleId': ident}
                    self.jobs[ident] = job
                    atomic_json(self.jobs_manifest, self.jobs)
        return {**imported, 'job': copy.deepcopy(job)}

    def archive(self, ident):
        with self.lock:
            if not self.collection: raise ValueError('当前服务没有配置工作集合。')
            key = self.collection.key(ident)
            if any(self.collection.key(job_id) == key and job['status'] in {'queued', 'running'}
                   for job_id, job in self.jobs.items()):
                raise ValueError('这个视频正在处理，请等待任务结束后归档。')
            return self.collection.archive(ident)

    def restore(self, ident):
        with self.lock:
            if not self.collection: raise ValueError('当前服务没有配置工作集合。')
            return self.collection.restore(ident)

    def start(self, ident, variant=None, detector=None, tracker=None):
        if detector is not None or tracker is not None:
            variant = resolve_selection(detector, tracker, variant)
        if variant not in {p['id'] for p in PRESETS} | {'manual'}:
            raise ValueError('请选择有效的处理方案。')
        inventory = self.scan(include_runtime=variant != 'manual')
        with self.lock:
            if ident not in self.paths:
                raise ValueError('视频已移走或尚未扫描到，请刷新文件夹。')
            job = self.jobs.get(ident)
            if job and job['status'] in {'queued', 'running'}:
                return copy.deepcopy(job)
            sample = self.saved.get(ident)
            if ident not in self.restore_errors and sample and any(v['id'] == variant for v in sample.get('trackingVariants', [])):
                return {'status': 'ready', 'sampleId': ident, 'variant': variant, 'message': '这个方案已有结果'}
            availability = ({'available': True} if variant == 'manual' else
                            inventory['runtime'].get('variants', {}).get(variant, inventory['runtime']))
            if not availability['available']:
                raise ValueError(availability.get('reason') or '当前模型不可用，请检查推理环境与模型权重。')
            if self.collection: self.collection.activate(ident)
            self.jobs[ident] = {'status': 'queued', 'variant': variant, 'message': '排队中，等待本机处理', 'sampleId': ident}
            atomic_json(self.jobs_manifest, self.jobs)
            self.executor.submit(self._process, ident, variant, self.paths[ident])
            return copy.deepcopy(self.jobs[ident])

    def register_review_source(self, video, title):
        # Called only with a source already validated and served by the workbench.
        # The HTTP client cannot provide a filesystem path here.
        video = Path(video).resolve()
        stat = video.stat()
        digest = file_hash(video)
        ident = 'local-' + digest
        with self.lock:
            self.review_sources[video] = title
            self.hashes[str(video)] = ((stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns), digest)
            self.paths[ident] = video
        return ident

    def _process(self, ident, variant, source):
        try:
            with self.lock:
                self.jobs[ident].update(status='running', message='正在读取视频帧时间…' if variant=='manual' else '正在准备视频并运行检测与跟踪…')
                atomic_json(self.jobs_manifest, self.jobs)
            if file_hash(source) != ident[6:]:
                raise ValueError('视频在处理前发生变化，请刷新后重新选择。')
            result = self.runner(ident, variant, source)
            with self.lock:
                previous = self.saved.get(ident)
                if previous:
                    existing = {v['id']: v for v in previous.get('trackingVariants', [])}
                    # Preserve all existing variant fingerprints and drafts.
                    for item in result['trackingVariants']:
                        existing.setdefault(item['id'], item)
                    result = {**previous, 'trackingVariants': list(existing.values())}
                clip = self.validate(result)
                updated = {**self.saved, ident: result}
                atomic_json(self.manifest, updated)
                self.saved = updated
            # Publishing takes the server's mutation lock. Never hold the library
            # lock here: trimming registers its output in the opposite direction.
            self.publish(result, clip)
            with self.lock:
                self.restore_errors.pop(ident, None)
                self.jobs[ident].update(status='ready', message='处理完成，可以打开')
                atomic_json(self.jobs_manifest, self.jobs)
        except Exception as error:
            with self.lock:
                self.jobs[ident].update(status='error', message=str(error))
                atomic_json(self.jobs_manifest, self.jobs)

    def _run(self, ident, variant, source):
        destination = self.cache / ident
        destination.mkdir(exist_ok=True)
        run_dir = destination / uuid.uuid4().hex
        run_dir.mkdir()
        if variant=='manual':
            from process_local_video import prepare_manual_sample
            return prepare_manual_sample(source,destination/'video.mp4',run_dir,ident)
        if os.environ.get('HKS_GPU_PREFIX'):
            from cloud_gpu import CloudGPU
            return CloudGPU().track(source, run_dir, ident, variant)
        command = [str(self.python), str(Path(__file__).with_name('process_local_video.py')),
            '--source', str(source), '--source-sha256', ident[6:], '--video', str(destination / 'video.mp4'),
            '--output-dir', str(run_dir), '--variant', variant, '--models', str(self.models), '--id', ident]
        log = run_dir / 'processing.log'
        with log.open('wb') as output:
            completed = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if completed.returncode:
            raise ValueError(worker_failure(log, completed.returncode))
        return json.loads((run_dir / 'sample.json').read_text(encoding='utf-8'))

    def close(self):
        self.executor.shutdown(wait=False, cancel_futures=True)
