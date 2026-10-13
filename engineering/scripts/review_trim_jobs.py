"""Bounded, local background jobs for video trimming; no storage/provider dependency."""
from collections import OrderedDict
from copy import deepcopy
import queue
import threading
import uuid


class ReviewTrimJobs:
    """Run one trim at a time, keeping only a bounded recent result history."""

    def __init__(self, operation, *, max_queued=8, max_completed=64):
        if max_queued < 1 or max_completed < 1:
            raise ValueError('剪辑队列和结果保留数量必须大于零。')
        self.operation = operation
        self.max_completed = max_completed
        self._queue = queue.Queue(maxsize=max_queued)
        self._lock = threading.Lock()
        self._jobs = {}
        self._completed = OrderedDict()
        self._closed = False
        self._worker = threading.Thread(target=self._run, name='review-trim', daemon=True)
        self._worker.start()

    def submit(self, request):
        frozen = deepcopy(request)
        with self._lock:
            if self._closed:
                raise ValueError('剪辑服务已停止，请重新连接后再试。')
            ident = str(uuid.uuid4())
            job = {'id': ident, 'status': 'queued', 'message': '剪辑已排队，请稍候。'}
            self._jobs[ident] = job
            try:
                self._queue.put_nowait((ident, frozen))
            except queue.Full:
                del self._jobs[ident]
                raise ValueError('剪辑队列已满，请等待当前任务完成后再试。') from None
            return deepcopy(job)

    def get(self, ident):
        with self._lock:
            return deepcopy(self._jobs.get(ident))

    def _finish(self, ident, **fields):
        # Called with the state lock held, never around encoding or library access.
        self._jobs[ident].update(fields)
        self._completed[ident] = None
        while len(self._completed) > self.max_completed:
            oldest, _ = self._completed.popitem(last=False)
            del self._jobs[oldest]

    def _progress(self, ident, message):
        with self._lock:
            job = self._jobs.get(ident)
            if job and job['status'] == 'running':
                job['message'] = str(message)[:300]

    def _run(self):
        while True:
            item = self._queue.get()
            try:
                if item is None:
                    return
                ident, request = item
                with self._lock:
                    if self._closed:
                        self._finish(ident, status='error', error='服务停止，排队中的剪辑已取消。',
                                     message='服务停止，排队中的剪辑已取消。')
                        continue
                    self._jobs[ident].update(status='running', message='正在准备剪辑。')
                try:
                    result = self.operation(request, lambda message: self._progress(ident, message))
                    frozen_result = deepcopy(result)
                except Exception as error:
                    message = str(error)[:600] or '剪辑失败，原视频仍可使用。'
                    with self._lock:
                        self._finish(ident, status='error', error=message, message=message)
                else:
                    with self._lock:
                        self._finish(ident, status='ready', result=frozen_result,
                                     message='剪辑和对应候选已生成，正在打开。')
            finally:
                self._queue.task_done()

    def close(self):
        """Reject new work and cancel queued work; an active trim may finish safely."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            while True:
                try:
                    ident, _ = self._queue.get_nowait()
                except queue.Empty:
                    break
                self._finish(ident, status='error', error='服务停止，排队中的剪辑已取消。',
                             message='服务停止，排队中的剪辑已取消。')
                self._queue.task_done()
            self._queue.put_nowait(None)
