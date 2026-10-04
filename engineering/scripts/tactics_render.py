"""Immutable tactical MP4 jobs. JS owns geometry/timing; Python owns media IO."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import threading
import uuid
from urllib.parse import urlencode

from local_video_library import atomic_json, file_hash
from tactical_workbench import ROOT

RENDERER_VERSION = 'authored-svg-1'


def discover_ffmpeg(explicit=None):
    value = explicit or os.environ.get('TACTICS_FFMPEG') or shutil.which('ffmpeg')
    if not value or not Path(value).is_file():
        raise ValueError('未找到 FFmpeg；设置 TACTICS_FFMPEG 或服务参数 --tactics-ffmpeg。')
    return str(Path(value).resolve())


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            raise ValueError('SVG 渲染进程提前结束，请查看任务错误。')
        chunks.extend(chunk)
    return chunks


class TacticsRenderer:
    def __init__(self, folder, tactics, ffmpeg=None, execute=None, timeout=1800):
        self.folder = Path(folder).resolve(); self.folder.mkdir(parents=True, exist_ok=True)
        self.tactics, self.ffmpeg, self.timeout = tactics, ffmpeg, timeout
        self.execute = execute or self._render
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='tactics-render')
        self.jobs = {}; self.closed = False

    @staticmethod
    def _context(clip, variant, qa, kind):
        if type(qa) is not bool or kind not in ('workspace', 'candidate') or not isinstance(variant, str):
            raise ValueError('成片草稿空间不正确。')
        return [clip['video_sha256'], clip['tracking_fingerprint'], clip['tracking_revision'], variant, qa, kind]

    def create(self, request, clip, video, variant, qa, kind='workspace'):
        context = self._context(clip, variant, qa, kind)
        document = request.get('document'); options = request.get('options', {'fps': 30})
        if not isinstance(options, dict) or set(options) - {'fps'} or type(options.get('fps', 30)) is not int or options.get('fps', 30) not in (24, 25, 30, 60):
            raise ValueError('成片帧率只支持 24、25、30 或 60；默认静音。')
        options = {'fps': options.get('fps', 30)}
        self.tactics.check_source(document, clip, kind)
        self.tactics.run('validate', document=document)
        digest = self.tactics.run('agent-digest', document=document)['digest']
        if request.get('documentDigest') != digest:
            raise ValueError('草稿摘要已变化，请重新生成成片。')
        if type(request.get('expectedVersion')) is not int or self.tactics.load(clip, variant, qa, kind)['version'] != request['expectedVersion']:
            raise ValueError('服务器已有新版本，请先同步草稿。')
        with self.lock:
            if self.closed: raise ValueError('成片服务已停止。')
            for job in self.jobs.values():
                if job['context'] == context and job['documentDigest'] == digest and job['options'] == options and job['status'] in ('queued', 'running', 'succeeded'):
                    return self._public(job)
            if sum(j['status'] in ('queued', 'running') for j in self.jobs.values()) >= 3:
                raise ValueError('已有 3 个成片任务，请等待完成或取消。')
            ident = str(uuid.uuid4())
            query = urlencode(dict(sample=request.get('sample', ''), variant=variant, qa='1' if qa else '0', kind=kind))
            job = dict(id=ident, status='queued', message='等待生成成片', context=context,
                       document=deepcopy(document), clip=deepcopy(clip), video=Path(video),
                       documentDigest=digest, expectedVersion=request['expectedVersion'], options=options,
                       rendererVersion=RENDERER_VERSION, cancel=threading.Event(), processes=[],
                       progress={'completed': 0, 'total': 0},
                       videoUrl=f'/api/tactics-render/jobs/{ident}/video?{query}')
            self.jobs[ident] = job
            self.pool.submit(self._run, job)
            return self._public(job)

    @staticmethod
    def _public(job):
        keys = ('id','status','message','documentDigest','expectedVersion','options','rendererVersion','progress',
                'totalFrames','fps','width','height','duration','sha256')
        result = deepcopy({k: job[k] for k in keys if k in job})
        if job['status'] == 'succeeded': result['videoUrl'] = job['videoUrl']
        return result

    def _lookup(self, ident, clip, variant, qa, kind):
        if not isinstance(ident, str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', ident):
            raise ValueError('成片任务编号不正确。')
        job = self.jobs.get(ident)
        if job is None:
            path = self.folder / ident / 'result.json'
            if path.is_file():
                job = json.loads(path.read_text(encoding='utf-8'))
        if job is None or job['context'] != self._context(clip, variant, qa, kind):
            raise ValueError('未找到当前视频与草稿空间的成片任务。')
        return job

    def get(self, ident, clip, variant, qa, kind='workspace'):
        with self.lock: return self._public(self._lookup(ident, clip, variant, qa, kind))

    def video(self, ident, clip, variant, qa, kind='workspace'):
        with self.lock:
            job = self._lookup(ident, clip, variant, qa, kind)
            path = self.folder / ident / 'finished.mp4'
            if job['status'] != 'succeeded' or not path.is_file() or file_hash(path) != job['sha256']:
                raise ValueError('成片尚未完成或文件已变化。')
            return path

    @staticmethod
    def _stop(job):
        for process in list(job.get('processes', [])):
            if process.poll() is None:
                try: process.kill()
                except OSError: pass

    def cancel(self, ident, clip, variant, qa, kind='workspace'):
        with self.lock:
            job = self._lookup(ident, clip, variant, qa, kind)
            if job['status'] in ('queued', 'running'):
                job['cancel'].set(); job.update(status='cancelled', message='已取消成片；草稿保持原样。')
                self._stop(job)
            return self._public(job)

    def _run(self, job):
        directory = self.folder / job['id']
        try:
            with self.lock:
                if job['cancel'].is_set(): return
                job.update(status='running', message='正在编排与渲染成片')
            directory.mkdir()
            atomic_json(directory / 'snapshot.json', {'document': job['document'], 'options': job['options']})
            self.execute(job, directory)
            with self.lock:
                if job['cancel'].is_set(): return
                if not (directory / 'finished.mp4').is_file(): raise ValueError('没有已验证的成片。')
                job.update(status='succeeded', message='成片已生成，预览和下载为同一份 MP4。')
                atomic_json(directory / 'result.json', {**self._public(job), 'context': job['context']})
        except Exception as error:
            with self.lock:
                if not job['cancel'].is_set(): job.update(status='failed', message='成片失败：' + str(error)[:2000])
        finally:
            self._stop(job)
            for process in list(job['processes']):
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: pass
            job['processes'].clear()
            partial = directory / 'rendering.mp4'
            if partial.is_file(): partial.unlink()

    def _render(self, job, directory):
        import av
        import numpy as np
        ffmpeg = discover_ffmpeg(self.ffmpeg)
        if file_hash(job['video']) != job['clip']['video_sha256']:
            raise ValueError('视频文件已变化，无法使用旧标记生成成片。')
        plan = self.tactics.run('production-compile', document=job['document'], options=job['options'])
        frames, width, height, fps = plan['frames'], plan['width'], plan['height'], plan['fps']
        if not frames or len(frames) > 18000 or width*height > 3840*2160 or width % 2 or height % 2:
            raise ValueError('成片需偶数尺寸，不超过 4K / 18000 帧。')
        indices = [f['sourceFrame'] for f in frames]
        if indices != sorted(indices) or min(indices) < 0 or max(indices) >= len(job['clip']['frames']):
            raise ValueError('成片源帧映射不正确。')
        job.update(totalFrames=len(frames), width=width, height=height, fps=fps, duration=len(frames)/fps,
                   progress={'completed': 0, 'total': len(frames)})
        atomic_json(directory/'plan.json', plan)
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        timed_out = threading.Event()
        def deadline(): timed_out.set(); self._stop(job)
        timer = threading.Timer(self.timeout, deadline); timer.daemon = True
        try:
            with (directory/'svg-error.txt').open('wb') as svg_error, (directory/'encode-error.txt').open('wb') as encode_error:
                raster = subprocess.Popen([self.tactics.node, str(ROOT/'engineering/tools/tactical-overlay/production-worker.mjs'), str(directory/'snapshot.json')], stdout=subprocess.PIPE, stderr=svg_error, cwd=ROOT, creationflags=flags)
                job['processes'].append(raster)
                encoder = subprocess.Popen([ffmpeg, '-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24',
                    '-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast',
                    '-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(directory/'rendering.mp4')], stdin=subprocess.PIPE, stderr=encode_error, creationflags=flags)
                job['processes'].append(encoder); timer.start()
                if job['cancel'].is_set(): self._stop(job); return
                with av.open(str(job['video'])) as container:
                    decoder = enumerate(container.decode(video=0)); current = -1; rgb = None
                    for output_index, state in enumerate(frames):
                        if job['cancel'].is_set(): return
                        if timed_out.is_set(): raise ValueError('成片超过本地渲染时限。')
                        while current < state['sourceFrame']:
                            current, source = next(decoder)
                            record = job['clip']['frames'][current]
                            if source.time is None or abs(float(source.time)-record['time']) > 1e-7 or (source.width,source.height) != (width,height):
                                raise ValueError('准确源帧时间或尺寸不一致。')
                            if current == state['sourceFrame']: rgb = source.to_ndarray(format='rgb24')
                        size = struct.unpack('>I', read_exact(raster.stdout, 4))[0]
                        if size != width*height*4: raise ValueError('叠加进程返回非法像素长度。')
                        overlay = np.frombuffer(read_exact(raster.stdout,size),dtype=np.uint8).reshape(height,width,4)
                        alpha = overlay[:,:,3:4].astype(np.uint16)
                        composite = ((rgb.astype(np.uint16)*(255-alpha)+overlay[:,:,:3].astype(np.uint16)*alpha+127)//255).astype(np.uint8)
                        encoder.stdin.write(composite.tobytes())
                        job['progress'] = {'completed': output_index+1, 'total':len(frames)}
                encoder.stdin.close()
                if raster.wait(timeout=30) or encoder.wait(timeout=120): raise ValueError('SVG 或视频编码失败。')
            job['message'] = '正在完整解码验证成片'
            with av.open(str(directory/'rendering.mp4')) as result:
                stream = result.streams.video[0]
                if (stream.width,stream.height) != (width,height): raise ValueError('输出尺寸验证失败。')
                count = 0
                for frame in result.decode(video=0):
                    if job['cancel'].is_set(): return
                    if timed_out.is_set(): raise ValueError('成片超过本地渲染时限。')
                    if frame.time is None or abs(float(frame.time)-count/fps) > 1e-5: raise ValueError('成片时间线验证失败。')
                    count += 1
                if count != len(frames): raise ValueError('成片帧数验证失败。')
            if timed_out.is_set(): raise ValueError('成片超过本地渲染时限。')
            if file_hash(job['video']) != job['clip']['video_sha256']: raise ValueError('渲染期间源片发生变化。')
            with self.lock:
                if job['cancel'].is_set(): return
                (directory/'rendering.mp4').replace(directory/'finished.mp4')
                job['sha256'] = file_hash(directory/'finished.mp4')
        except Exception as error:
            diagnostics = '\n'.join(p.read_text(encoding='utf-8',errors='replace')[-900:] for p in (directory/'svg-error.txt',directory/'encode-error.txt') if p.is_file())
            raise ValueError(str(error) + ('\n' + diagnostics if diagnostics else '')) from error
        finally:
            timer.cancel()

    def close(self):
        with self.lock:
            self.closed = True
            for job in self.jobs.values():
                if job['status'] in ('queued','running'): job['cancel'].set(); self._stop(job)
        self.pool.shutdown(wait=True, cancel_futures=True)
