const UNCERTAIN = '后台剪辑可能仍在继续，可稍后到视频库查看；请勿立即重复提交。';

class TrimRequestError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

async function requestJSON(url, init, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TrimRequestError('剪辑请求等待超时。', true));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let response;
      try {
        response = await fetchImpl(url, {...init, signal: controller.signal});
      } catch {
        throw new TrimRequestError('无法连接剪辑服务。', true);
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new TrimRequestError('剪辑服务返回了无法读取的结果。', response.ok || response.status >= 500);
      }
      if (!response.ok) {
        throw new TrimRequestError(data?.error || `剪辑请求失败（${response.status}）。`,
          response.status >= 500 || response.status === 408 || response.status === 429);
      }
      return data;
    })()]);
  } finally {
    clearTimeout(timer);
  }
}

/** Submit once, then poll the job. A timeout never resubmits the trim. */
export async function runTrim(request, {
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  requestTimeoutMs = 15_000,
  timeoutMs = 15 * 60_000,
  pollIntervalMs = 1_000,
  maxPollFailures = 3,
} = {}) {
  if (!(requestTimeoutMs > 0 && timeoutMs > 0 && pollIntervalMs >= 0 && maxPollFailures >= 0)) {
    throw new Error('剪辑等待参数不正确。');
  }
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error(`等待剪辑完成超时。${UNCERTAIN}`);
    return value;
  };
  onProgress('正在提交剪辑任务…');
  let job;
  try {
    job = await requestJSON('/api/trim', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...request, async: true}),
    }, fetchImpl, Math.min(requestTimeoutMs, remaining()));
  } catch (error) {
    throw new Error(`${error.message}${error.retryable ? UNCERTAIN : ''}`);
  }
  if (!job?.id || !['queued', 'running', 'ready', 'error'].includes(job.status)) {
    throw new Error(`剪辑任务返回格式不正确。${UNCERTAIN}`);
  }
  const ident = job.id;
  let failures = 0;
  while (true) {
    if (job.status === 'ready') {
      if (!job.result?.sample) throw new Error('剪辑结果缺少视频入口，请到视频库查看。');
      onProgress(job.message || '剪辑已完成，正在打开。');
      return job.result;
    }
    if (job.status === 'error') throw new Error(job.error || job.message || '剪辑生成失败，原视频仍可使用。');
    onProgress(job.message || '正在生成剪辑和对应候选…');
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining())));
    try {
      const next = await requestJSON(`/api/trim-jobs/${encodeURIComponent(ident)}`, {method: 'GET'},
        fetchImpl, Math.min(requestTimeoutMs, remaining()));
      if (!next || next.id !== ident || !['queued', 'running', 'ready', 'error'].includes(next.status)) {
        throw new TrimRequestError('剪辑任务状态返回格式不正确。');
      }
      job = next;
      failures = 0;
    } catch (error) {
      if (!error.retryable || ++failures > maxPollFailures) {
        throw new Error(`${error.message}${error.message.includes(UNCERTAIN) ? '' : UNCERTAIN}`);
      }
      onProgress(`连接暂时中断，正在重新读取剪辑状态（${failures}/${maxPollFailures}）…`);
    }
  }
}
