"""Small shared, read-only cache for source video frames used by ground jobs."""
from collections import OrderedDict
import threading


class GroundTrajectoryFrameCache:
    """Deduplicate concurrent frame decodes while keeping decoding outside the lock."""

    def __init__(self, max_entries=256):
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._frames = OrderedDict()
        self._inflight = {}

    @staticmethod
    def _key(video_sha256, frame):
        return video_sha256, frame

    def get(self, video_sha256, indices, loader):
        """Return frame records, invoking loader once for newly claimed indices.

        loader(indices) must return records carrying their integer ``frame`` key.
        The loader runs outside the cache lock, so unrelated frames decode in parallel.
        """
        requested = sorted(set(indices))
        if not requested:
            return []
        owned = []
        waits = {}
        with self._lock:
            for index in requested:
                key = self._key(video_sha256, index)
                if key in self._frames:
                    self._frames.move_to_end(key)
                elif key in self._inflight:
                    waits[index] = self._inflight[key]
                else:
                    event = threading.Event()
                    self._inflight[key] = event
                    owned.append(index)

        if owned:
            try:
                records = {record['frame']: record for record in loader(owned)}
                if set(records) != set(owned):
                    raise ValueError('帧缓存加载器未返回全部请求帧。')
                with self._lock:
                    for index, record in records.items():
                        key = self._key(video_sha256, index)
                        self._frames[key] = dict(record)
                        self._frames.move_to_end(key)
                        self._inflight.pop(key).set()
                    while len(self._frames) > self.max_entries:
                        self._frames.popitem(last=False)
            except BaseException as error:
                with self._lock:
                    for index in owned:
                        event = self._inflight.pop(self._key(video_sha256, index), None)
                        if event:
                            event.error = error
                            event.set()
                raise

        for event in waits.values():
            event.wait()
            if hasattr(event, 'error'):
                raise event.error

        with self._lock:
            result = []
            for index in requested:
                key = self._key(video_sha256, index)
                record = self._frames.get(key)
                if record is None:
                    # A just-loaded item may have been evicted only if the configured
                    # cache is smaller than this request. Keep an ephemeral copy via
                    # the in-flight result in the normal case; callers should size >=12.
                    raise ValueError('源帧缓存容量不足。')
                self._frames.move_to_end(key)
                result.append(dict(record))
            return result


_SHARED_CACHE = GroundTrajectoryFrameCache()


def shared_ground_trajectory_frame_cache():
    return _SHARED_CACHE
