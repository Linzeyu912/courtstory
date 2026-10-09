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
      const error = new Error(value.error || value.message || `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return value;
  }
  return {
    query,
    getState: () => json(`/api/commentary?${query}`),
    savePlan: plan => json('/api/commentary/save', { plan }),
    saveCue: (cueId, patch, expectedCue) => json(`/api/commentary/cues/${encodeURIComponent(cueId)}`, { patch, expectedCue }),
    startJob: payload => json('/api/commentary/jobs', payload),
    getJob: id => json(`/api/commentary/jobs/${encodeURIComponent(id)}?${query}`),
  };
}
