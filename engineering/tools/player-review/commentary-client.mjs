// Framework-free commentary API. Keep cue identity and server persistence outside the UI.
import {requestJSON} from './api-request.mjs';
export function createCommentaryClient(context, request = (...args) => fetch(...args)) {
  const ctx = { sample: context.sample, variant: context.variant, qa: !!context.qa };
  const query = new URLSearchParams({ ...ctx, qa: ctx.qa ? '1' : '0' }).toString();
  async function json(url, payload) {
    const value = await requestJSON(url, payload === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ctx, ...payload }),
    }, {fetcher:request});
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
