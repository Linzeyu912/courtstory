// Framework-free commentary API. Keep cue identity and server persistence outside the UI.
export function createCommentaryClient(context, request = (...args) => fetch(...args)) {
  const ctx = { sample: context.sample, variant: context.variant, qa: !!context.qa };
  const query = new URLSearchParams({ ...ctx, qa: ctx.qa ? '1' : '0' }).toString();
  async function json(url, payload) {
    const response = await request(url, payload === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ctx, ...payload }),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = value.error || value.message || `请求失败（${response.status}）`;
      const error = new Error({ 'commentary understanding credential is not configured': '视频理解服务未配置 OpenRouter 凭据，请在服务端配置后重试。',
        'speech credential is not configured': '配音服务未配置语音凭据，请在服务端配置后重试。' }[message] || message);
      error.status = response.status;
      throw error;
    }
    return value;
  }
  return {
    query,
    getState: () => json(`/api/commentary?${query}`),
    savePlan: (plan, options = {}) => json('/api/commentary/save', { ...options, plan }),
    saveCue: (cueId, patch, expectedCue, options = {}) => json(`/api/commentary/cues/${encodeURIComponent(cueId)}`, { ...options, patch, expectedCue }),
    startJob: payload => json('/api/commentary/jobs', payload),
    getJob: id => json(`/api/commentary/jobs/${encodeURIComponent(id)}?${query}`),
    cancelJob: id => json(`/api/commentary/jobs/${encodeURIComponent(id)}/cancel`, {}),
  };
}
