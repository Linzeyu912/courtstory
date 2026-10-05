"""Bounded Pi/Qwen jobs; the browser remains owner of the review draft."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid
from urllib.parse import urlsplit

from local_video_library import atomic_json
from review_session import validate_session

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / 'engineering/tools/player-review/agents/ground-trajectory-worker.mjs'
ACTIVE = {'queued', 'observing', 'refining', 'rendering'}


def _integer(value, name, low=0, high=2**53-1):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} 必须是范围内的整数。')
    return value


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def _session_digest(session):
    # Source geometry and identity; display names/derived results do not invalidate themselves.
    fields = ('id', 'role', 'bindings', 'modelBindings', 'identityKeyframes', 'identityReference',
        'identitySuggestionsDismissed', 'visibilityRanges', 'anchors', 'courtAnchors', 'positionCorrections')
    return _digest({'videoHash': session.get('videoHash'),
        'entities': [{k: e.get(k) for k in fields} for e in session['entities']],
        **{k: session.get(k) for k in ('courtCalibration', 'cuts', 'maxGapSeconds', 'groundComparison')}})


def _budget(name, default, low, high):
    return _integer(int(os.environ.get(name, default)), name, low, high)


class GroundTrajectoryAgent:
    def __init__(self, folder, tactics, timeout=300):
        self.folder = Path(folder).resolve(); self.folder.mkdir(parents=True, exist_ok=True)
        self.tactics = tactics; self.lock = threading.RLock(); self.closed = False; self.jobs = {}
        self.configuration_error = None
        def configured_budget(name, default, low, high):
            try: return _budget(name, default, low, high)
            except (ValueError, TypeError):
                self.configuration_error = f'{name} 配置应为 {low}–{high} 范围内的整数。'
                return default
        self.timeout = configured_budget('QWEN_GROUND_TIMEOUT', timeout, 10, 600)
        self.config = dict(model=os.environ.get('QWEN_MODEL', 'qwen3.8-max'),
            baseUrl=os.environ.get('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
            maxRequests=configured_budget('QWEN_GROUND_MAX_TURNS', 12, 2, 24),
            maxUniqueFrames=configured_budget('QWEN_GROUND_MAX_FRAMES', 64, 12, 128),
            maxImagesPerReply=8, timeoutSeconds=self.timeout)
        try:
            parsed = urlsplit(self.config['baseUrl'])
            valid_url = (parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username
                and parsed.hostname.endswith('.aliyuncs.com')
                and not parsed.password and not parsed.query and not parsed.fragment)
        except ValueError: valid_url = False
        if not valid_url:
            self.configuration_error = 'QWEN_BASE_URL 必须是不含凭据的阿里云官方 HTTPS API 地址。'
        self.public_base_url = self.config['baseUrl'] if valid_url else '[invalid configuration]'
        self.node_version = None
        if self.tactics.node:
            try:
                version = subprocess.check_output([self.tactics.node, '--version'], text=True, timeout=5,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).strip().lstrip('v')
                parts = tuple(int(n) for n in version.split('.')[:3])
                if parts >= (22, 19, 0): self.node_version = version
            except (OSError, ValueError, subprocess.SubprocessError): pass
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='ground-trajectory-agent')
        for path in self.folder.glob('*/job.json'):
            try:
                saved = json.loads(path.read_text(encoding='utf-8'))
                if saved.get('status') in ACTIVE:
                    saved.update(status='interrupted', message='服务重启，任务已中断；已生成候选仍保留。')
                    atomic_json(path, saved)
                self.jobs[saved['jobId']] = dict(saved, cancel=threading.Event(), process=None)
            except (OSError, ValueError, KeyError):
                continue

    def status(self):
        configured = bool(os.environ.get('QWEN_KEY'))
        dependencies = all((WORKER.parent/'node_modules'/name).is_dir() for name in
            ('@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'typebox'))
        decoding = all(importlib.util.find_spec(name) is not None for name in ('av', 'PIL'))
        available = configured and bool(self.node_version) and WORKER.is_file() and dependencies and decoding and not self.configuration_error
        message = (self.configuration_error or ('Qwen 地面轨迹 Agent 已配置。' if available else
            '请在服务端环境设置 QWEN_KEY。' if not configured else
            '请安装 PyAV 和 Pillow，视频视觉工具需要这两个依赖。' if not decoding else
            '请在 engineering/tools/player-review/agents 执行 npm ci，并使用 Node.js 22.19 或更新版本。'))
        return dict(available=available, configured=configured, model=self.config['model'],
                    baseUrl=self.public_base_url, runtime=bool(self.node_version), nodeVersion=self.node_version,
                    dependencies=dependencies, decoding=decoding, message=message)

    @staticmethod
    def _context(clip, variant, qa):
        if type(qa) is not bool or variant != clip['tracking_revision']:
            raise ValueError('地面轨迹任务来源空间无效。')
        return [clip['video_sha256'], clip['tracking_fingerprint'], clip['tracking_revision'], variant, qa]

    def _request(self, request, clip):
        if not isinstance(request, dict):
            raise ValueError('轨迹任务必须是对象。')
        session = request.get('session'); count = validate_session(session, clip)
        _integer(request.get('clientRevision'), '草稿修订')
        ids = request.get('entityIds')
        player_ids = {e['id'] for e in session['entities'] if e.get('role') == 'player'}
        if not isinstance(ids, list) or not 1 <= len(ids) <= 10 or len(set(ids)) != len(ids) or any(i not in player_ids for i in ids):
            raise ValueError('请选择已存在的球员槽位。')
        interval = request.get('range')
        if not isinstance(interval, dict) or set(interval) != {'startFrame', 'endFrameExclusive'}:
            raise ValueError('轨迹任务缺少半开帧范围。')
        start = _integer(interval['startFrame'], '起始帧', high=count-1)
        end = _integer(interval['endFrameExclusive'], '结束帧', low=1, high=count)
        if start >= end:
            raise ValueError('轨迹任务帧范围为空。')
        if not isinstance(request.get('goal', ''), str) or len(request.get('goal', '')) > 4000:
            raise ValueError('任务目标文本过长或格式不正确。')
        preparation = session.get('courtPreparation')
        if not isinstance(preparation, dict):
            raise ValueError('请先建立当前 2D 准备结果。')
        raw = preparation.get('rawByPlayer', {})
        for entity_id in ids:
            points = raw.get(entity_id, [])
            if not any(all(type(p.get(k)) in (int, float) and math.isfinite(p[k]) for k in ('x', 'y'))
                       for p in points[start:end]):
                raise ValueError(f'{entity_id} 在选定范围没有可用地面观测，请先关联身份并核对球场标定。')
        return session

    def create(self, request, clip, video, variant, qa):
        context = self._context(clip, variant, qa); session = self._request(request, clip)
        self.tactics.preparations.validate(session['courtPreparation'], session, clip,
                                          require_adopted=True, variant=variant, qa=qa)
        if not self.status()['available']:
            raise ValueError(self.status()['message'])
        with self.lock:
            if self.closed:
                raise ValueError('轨迹 Agent 服务已关闭。')
            for job in self.jobs.values():
                if job['context'] == context and job.get('request') == request and job['status'] in ACTIVE:
                    return self._public(job)
            ident = str(uuid.uuid4())
            prep_digest = self.tactics.run('preparation-digest', preparation=session['courtPreparation'])['digest']
            base = dict(clientRevision=request['clientRevision'], sessionDigest=_session_digest(session),
                preparationDigest=prep_digest, videoHash=context[0], trackingFingerprint=context[1],
                trackingRevision=context[2], variant=variant, qa=qa)
            job = dict(jobId=ident, status='queued', message='等待 Qwen 地面轨迹任务。',
                context=context, request=deepcopy(request), clip=deepcopy(clip), video=str(video), base=base,
                cancel=threading.Event(), process=None, frames={}, deliveredFrames=[], evidenceAssets=[], feedbackRevisions=[])
            self.jobs[ident] = job; self._persist(job); self.pool.submit(self._run, job)
            return self._public(job)

    def _persist(self, job):
        value = {k: deepcopy(v) for k, v in job.items() if k not in {'cancel', 'process', 'frames', 'imageByPlayer'}}
        atomic_json(self.folder / job['jobId'] / 'job.json', value)

    @staticmethod
    def _safe_message(value):
        text = str(value)
        secret = os.environ.get('QWEN_KEY')
        return text.replace(secret, '[redacted]') if secret else text

    @staticmethod
    def _public(job):
        return deepcopy({k: job[k] for k in ('jobId', 'status', 'message', 'base', 'candidate', 'usage',
            'progress', 'adopted', 'evidenceAssets', 'feedbackRevisions') if k in job})

    def _lookup(self, ident, clip, variant, qa):
        job = self.jobs.get(ident)
        if not job or job['context'] != self._context(clip, variant, qa):
            raise ValueError('未找到当前视频和草稿空间的轨迹任务。')
        return job

    def get(self, ident, clip, variant, qa):
        with self.lock:
            return self._public(self._lookup(ident, clip, variant, qa))

    def cancel(self, ident, clip, variant, qa):
        with self.lock:
            job = self._lookup(ident, clip, variant, qa)
            if job['status'] in ACTIVE:
                job['cancel'].set(); job.update(status='cancelled', message='任务已取消，当前草稿未改变。')
                if job['process'] and job['process'].poll() is None:
                    job['process'].terminate()
                self._persist(job)
            return self._public(job)

    def _candidate(self, job, candidate):
        if not isinstance(candidate, dict) or candidate.get('jobId') != job['jobId']:
            raise ValueError('候选任务编号不匹配。')
        if (candidate.get('entityIds') != job['request']['entityIds'] or candidate.get('range') != job['request']['range']
                or candidate.get('baseDigest') != job['base']['preparationDigest'] or candidate.get('model') != self.config['model']):
            raise ValueError('候选修改了任务来源或范围。')
        canonical = self.tactics.run('ground-trajectory-preview',
            preparation=job['request']['session']['courtPreparation'], input=candidate)['candidate']
        if canonical != candidate:
            raise ValueError('候选位置不符合共享拟合器或来源记录。')
        known = set(job.get('deliveredFrames', []))
        evidence = set(candidate.get('evidenceFrames', []))
        for value in candidate.get('anchors', []) + candidate.get('unknownRanges', []):
            evidence.update(value.get('evidenceFrames', []))
        if not evidence <= known:
            raise ValueError('候选引用了任务未读取的证据帧。')
        return deepcopy(candidate)

    def _decode(self, job, indices):
        interval = job['request']['range']
        if not isinstance(indices, list) or not 1 <= len(indices) <= 12:
            raise ValueError('每次视觉请求读取 1–12 帧。')
        for frame in indices:
            _integer(frame, '视觉帧', interval['startFrame'], interval['endFrameExclusive']-1)
        missing = sorted(set(indices)-job['frames'].keys())
        if len(set(indices) | job['frames'].keys()) > self.config['maxUniqueFrames']:
            raise ValueError('已达到独立源帧预算。')
        if missing:
            for record in self.tactics.frames(job['video'], job['clip'], missing):
                job['frames'][record['frame']] = record
        return [job['frames'][i] for i in sorted(set(indices))]

    def _rpc(self, job, method, params):
        if not isinstance(params, dict):
            raise ValueError('工具参数必须是对象。')
        preparation = job['request']['session']['courtPreparation']
        if method == 'inspect_frames':
            from ground_trajectory_images import inspect_images
            mode = params.get('mode', 'sheet')
            if mode not in ('full', 'player', 'feet', 'sheet'):
                raise ValueError('不支持的视觉模式。')
            ids = params.get('entityIds', job['request']['entityIds'])
            if not isinstance(ids, list) or not ids or any(i not in job['request']['entityIds'] for i in ids):
                raise ValueError('只能查看任务选定的球员。')
            frames = self._decode(job, params.get('frames'))
            visual = deepcopy(preparation)
            if job.get('imageByPlayer'):
                visual['rawByPlayer'] = job['imageByPlayer']
            images, assets = inspect_images(frames, visual, ids, mode, self.folder/job['jobId']/'assets')
        elif method == 'render_trajectory':
            from ground_trajectory_images import render_images
            current = params.get('candidate') is not None
            if current:
                candidate = self._candidate(job, params['candidate'])
            else:
                candidate = dict(revision=0, range=job['request']['range'], anchors=[],
                                 pointsByPlayer=preparation['preparedByPlayer'])
            selected = params.get('frames') or []
            if len(selected) > 7:
                raise ValueError('反投影每次最多 7 帧。')
            frames = self._decode(job, selected) if selected else []
            images, assets = render_images(preparation, candidate, frames,
                job['request']['entityIds'], self.folder/job['jobId']/'assets')
            if current:
                job['feedbackRevisions'].append(candidate['revision'])
        else:
            raise ValueError('工具未获授权。')
        if not images or len(images) > self.config['maxImagesPerReply']:
            raise ValueError('工具图片为空或超过单次 8 张预算，请减少帧数或球员数。')
        pictured = {a['frame'] for a in assets if 'frame' in a}
        pictured.update(tile['frame'] for a in assets for tile in a.get('tiles', []))
        metadata = [{k: v for k, v in f.items() if k != 'dataUrl'} for f in frames if f['frame'] in pictured]
        job['deliveredFrames'] = sorted(set(job.get('deliveredFrames', [])) | pictured)
        job['evidenceAssets'].extend(assets)
        self._persist(job)
        return dict(content=[{'type': 'text', 'text': json.dumps({'frames': metadata, 'assets': assets}, ensure_ascii=False)}]+images,
                    frames=metadata, assets=assets)

    def _run(self, job):
        directory = self.folder/job['jobId']; process = None
        try:
            with self.lock:
                if job['cancel'].is_set(): return
                job.update(status='observing', message='正在准备帧证据。'); self._persist(job)
            built = self.tactics.run('court-preparation-build', session=job['request']['session'], clip=job['clip'])
            job['imageByPlayer'] = built.get('imageByPlayer')
            env = os.environ.copy()
            # Secret remains only in the process environment, never in JSONL or journal.
            with (directory/'worker.stderr.log').open('w', encoding='utf-8') as stderr:
                process = subprocess.Popen([self.tactics.node, str(WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1, cwd=ROOT, env=env,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                def safe_stderr():
                    for line in process.stderr:
                        with (directory/'worker.stderr.log').open('a', encoding='utf-8') as output:
                            output.write(self._safe_message(line))
                threading.Thread(target=safe_stderr, daemon=True).start()
                with self.lock:
                    job['process'] = process
                incoming = queue.Queue()
                def reader():
                    try:
                        for line in process.stdout:
                            if len(line) > 32*1024*1024:
                                incoming.put({'type': 'error', 'message': 'worker 输出超过大小上限。'}); break
                            try: incoming.put(json.loads(line))
                            except ValueError: incoming.put({'type': 'error', 'message': 'worker 返回了无效 JSONL。'})
                    finally: incoming.put(None)
                threading.Thread(target=reader, daemon=True).start()
                def send(value):
                    process.stdin.write(json.dumps(value, ensure_ascii=False, allow_nan=False)+'\n'); process.stdin.flush()
                send(dict(type='start', jobId=job['jobId'], session=job['request']['session'], clip=job['clip'],
                    preparation=job['request']['session']['courtPreparation'], entityIds=job['request']['entityIds'],
                    range=job['request']['range'], goal=job['request'].get('goal', ''), config=self.config))
                deadline = time.monotonic()+self.timeout; completed = False
                while time.monotonic() < deadline and not job['cancel'].is_set():
                    try: message = incoming.get(timeout=.3)
                    except queue.Empty: continue
                    if message is None: break
                    if not isinstance(message, dict): raise ValueError('worker 协议消息无效。')
                    kind = message.get('type')
                    if kind == 'rpc':
                        try:
                            result = self._rpc(job, message.get('method'), message.get('params', {}))
                            send(dict(type='rpc_result', id=message.get('id'), result=result))
                        except (ValueError, TypeError, KeyError, OSError) as error:
                            send(dict(type='rpc_result', id=message.get('id'), error=str(error)))
                    elif kind == 'progress':
                        with self.lock:
                            if message.get('status') in ACTIVE: job['status'] = message['status']
                            job['message'] = self._safe_message(message.get('message', '正在处理轨迹。'))[:1000]
                            if isinstance(message.get('usage'), dict): job['usage'] = message['usage']
                            if isinstance(message.get('progress'), dict): job['progress'] = message['progress']
                            if isinstance(message.get('event'), dict):
                                job.setdefault('audit', []).append(message['event'])
                            self._persist(job)
                    elif kind in ('candidate', 'result'):
                        candidate = self._candidate(job, message.get('candidate')) if message.get('candidate') else None
                        with self.lock:
                            if candidate:
                                job['candidate'] = candidate
                                self.tactics.preparations.register_candidate(candidate, job['context'], adopted=False)
                            if isinstance(message.get('usage'), dict): job['usage'] = message['usage']
                            if kind == 'result':
                                for name in ('summary', 'evidence', 'audit', 'budgetReason'):
                                    if name in message: job[name] = message[name]
                            self._persist(job)
                        if kind == 'result':
                            completed = True; break
                    elif kind == 'error':
                        raise ValueError(self._safe_message(message.get('message', 'Qwen worker 执行失败。'))[:2000])
                    else: raise ValueError('worker 返回了未知协议消息。')
                with self.lock:
                    if job['cancel'].is_set(): return
                    candidate = job.get('candidate')
                    if candidate and candidate['revision'] in job['feedbackRevisions']:
                        is_complete = completed and candidate.get('completion') == 'complete'
                        job.update(status='ready' if is_complete else 'partial',
                            message='候选已完成，等待预览采用。' if is_complete else '任务未完全结束，已保留可预览的部分候选。')
                    else:
                        job.update(status='failed', message='任务未产生经过绘制反馈的候选；请检查配置或重试。')
                    self._persist(job)
        except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as error:
            with self.lock:
                if not job['cancel'].is_set():
                    valid = job.get('candidate') and job['candidate']['revision'] in job.get('feedbackRevisions', [])
                    job.update(status='partial' if valid else 'failed', message=self._safe_message(error)[:2000]); self._persist(job)
        finally:
            if process and process.poll() is None:
                process.terminate()
                try: process.wait(timeout=3)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=3)
            log = directory/'worker.stderr.log'
            if log.is_file():
                log.write_text(self._safe_message(log.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
            with self.lock: job['process'] = None

    def adopt(self, ident, request, clip, variant, qa):
        with self.lock:
            job = self._lookup(ident, clip, variant, qa)
            if job['status'] not in ('ready', 'partial', 'interrupted') or not job.get('candidate'):
                raise ValueError('此任务尚无可采用候选。')
            session = request.get('session'); validate_session(session, clip)
            candidate = job['candidate']
            if request.get('candidateRevision') != candidate['revision']:
                raise ValueError('候选版本已变化，请重新预览。')
            digest = self.tactics.run('preparation-digest', preparation=session.get('courtPreparation'))['digest']
            if (request.get('clientRevision') != job['base']['clientRevision']
                    or _session_digest(session) != job['base']['sessionDigest'] or digest != job['base']['preparationDigest']):
                raise ValueError('草稿或 2D 准备已变化，此迟返候选不能覆盖当前版本。')
            if candidate['revision'] not in job.get('feedbackRevisions', []):
                raise ValueError('当前候选还没有绘制反馈。')
            self.tactics.preparations.validate(session['courtPreparation'], session, clip,
                                              require_adopted=True, variant=variant, qa=qa)
            preparation = self.tactics.run('ground-trajectory-adopt', preparation=session['courtPreparation'], candidate=candidate)['preparation']
            self.tactics.preparations.register_candidate(candidate, job['context'], adopted=True)
            job['adopted'] = dict(revision=candidate['revision']); self._persist(job)
            return dict(jobId=ident, base=deepcopy(job['base']), candidate=deepcopy(candidate), preparation=preparation)

    def close(self):
        with self.lock:
            self.closed = True
            for job in self.jobs.values():
                if job['status'] in ACTIVE:
                    job['cancel'].set(); job.update(status='interrupted', message='服务关闭，任务已中断。')
                    if job.get('process') and job['process'].poll() is None: job['process'].terminate()
                    self._persist(job)
        self.pool.shutdown(wait=True, cancel_futures=True)
