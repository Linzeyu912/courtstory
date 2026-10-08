const ACTIVE = new Set(['queued', 'running']);
const clone = value => value == null ? value : structuredClone(value);

function contextQuery({ sample, variant, qa }) {
  return new URLSearchParams({ sample, variant, qa: qa ? '1' : '0' }).toString();
}

function setStatus(node, message, kind = '') {
  node.textContent = message || '';
  node.dataset.kind = kind;
}

function stageLabel(stage, status) {
  const labels = { understanding: '正在理解视频', speech: '正在合成配音', synthesizing: '正在合成配音', rendering: '正在生成字幕视频', queued: '任务排队中' };
  return `${labels[stage] || (status === 'queued' ? labels.queued : stage || '正在处理')}…`;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || value.message || `请求失败（${response.status}）`);
  return value;
}

function make(tag, attrs = {}, parent) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'className') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  parent?.append(node);
  return node;
}

export function mountCommentaryUI(api) {
  const { root, clip, sample, variant, qa, title = sample, seek = () => {}, pause = () => {} } = api;
  const ctx = { sample, variant, qa: !!qa };
  const query = contextQuery(ctx);
  const sourceKey = [sample, variant, qa ? '1' : '0', clip?.video_sha256 || '', clip?.tracking_fingerprint || ''].join(':');
  const storageKey = `player-review-commentary:${encodeURIComponent(sourceKey)}`;
  root.replaceChildren();
  root.classList.add('commentary-ui');

  const details = make('details', { className: 'commentary-details' }, root);
  details.open = true;
  const summaryHeading = make('summary', { text: '解说与配音' }, details);
  const body = make('div', { className: 'commentary-body' }, details);
  const intro = make('p', { className: 'commentary-intro' }, body);
  intro.textContent = `${title} · 先生成解说稿，核对每句时间与讲法，再生成配音字幕视频。`;
  const modelLine = make('p', { className: 'commentary-muted', text: '读取解说服务状态…' }, body);
  const actions = make('div', { className: 'commentary-actions' }, body);
  const understand = make('button', { className: 'primary', text: '生成解说稿' }, actions);
  const save = make('button', { text: '保存解说稿' }, actions);
  const render = make('button', { className: 'primary', text: '配音并生成字幕视频' }, actions);
  const status = make('p', { className: 'commentary-status', role: 'status', 'aria-live': 'polite' }, body);
  const progress = make('progress', { hidden: true }, body);
  const summaryLabel = make('label', { className: 'commentary-label', text: '解说梗概（可选）' }, body);
  const summaryInput = make('textarea', { rows: 2, placeholder: '可补充整体讲解重点' }, summaryLabel);
  const columns = make('div', { className: 'commentary-columns' }, body);
  const cueList = make('div', { className: 'commentary-cues' }, columns);
  const mediaColumn = make('div', { className: 'commentary-media-column' }, columns);
  const sourceBox = make('section', { className: 'commentary-source' }, mediaColumn);
  make('h3', { text: '原视频 · 对照解说时机' }, sourceBox);
  const sourceVideo = make('video', { controls: true, playsInline: true, preload: 'metadata', src: `/video.mp4?sample=${encodeURIComponent(sample)}` }, sourceBox);
  sourceVideo.addEventListener('loadedmetadata', () => {
    const firstTime = clip?.frames?.[0]?.time;
    if (Number.isFinite(firstTime) && firstTime >= 0 && firstTime < sourceVideo.duration) sourceVideo.currentTime = firstTime;
  }, { once: true });
  const resultBox = make('div', { className: 'commentary-result', hidden: true }, mediaColumn);
  const resultNote = make('p', { className: 'commentary-result-note', text: '成片对应生成时保存的解说稿。' }, resultBox);
  const resultVideo = make('video', { controls: true, playsInline: true, preload: 'metadata' }, resultBox);
  const downloads = make('div', { className: 'commentary-actions' }, resultBox);
  const mp4Link = make('a', { className: 'primary commentary-download', text: '下载 MP4' }, downloads);
  const srtLink = make('a', { className: 'commentary-download', text: '下载 SRT' }, downloads);

  let plan = null, baseline = '', job = null, service = null, disposed = false, busy = false;
  let timer = null, serial = 0, loaded = false;
  const cueEditors = [];
  const changed = () => !!plan && JSON.stringify(readPlan()) !== baseline;
  function readPlan() {
    if (!plan) return null;
    const next = clone(plan);
    next.summary = summaryInput.value;
    next.cues = (next.cues || []).map((cue, index) => {
      const fields = cueEditors[index];
      if (!fields) return cue;
      return { ...cue, text: fields.text.value, suggestedStartTime: fields.start.value.trim() ? numberOr(fields.start.value, cue.suggestedStartTime) : '',
        suggestedEndTime: fields.end.value.trim() ? numberOr(fields.end.value, cue.suggestedEndTime) : '', delivery: fields.delivery.value };
    });
    return next;
  }
  function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function persistLocal() {
    if (!plan) return;
    try {
      const value = readPlan();
      if (JSON.stringify(value) === baseline) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify({ plan: value, baseline }));
    } catch { /* storage may be unavailable */ }
  }
  function updateButtons() {
    const hasPlan = !!plan;
    const locked = busy || ACTIVE.has(job?.status);
    understand.disabled = locked;
    render.disabled = locked || !hasPlan;
    save.disabled = busy || !hasPlan || !changed();
    for (const field of [summaryInput, ...cueEditors.flatMap(cue => [cue.text, cue.start, cue.end, cue.delivery])]) field.disabled = locked;
    save.textContent = changed() ? '保存解说稿 · 有未保存修改' : '保存解说稿';
  }
  function clearResult() {
    resultVideo.pause(); resultVideo.removeAttribute('src'); resultVideo.load(); resultBox.hidden = true;
    mp4Link.removeAttribute('href'); srtLink.removeAttribute('href');
  }
  function renderPlan(value) {
    plan = clone(value);
    cueEditors.length = 0;
    cueList.replaceChildren();
    summaryInput.value = plan?.summary || '';
    for (const [index, cue] of (plan?.cues || []).entries()) {
      const card = make('article', { className: 'commentary-cue' }, cueList);
      const heading = make('div', { className: 'commentary-cue-heading' }, card);
      make('strong', { text: `第 ${index + 1} 句` }, heading);
      if (Array.isArray(clip?.frames) && clip.frames.length) {
        const view = make('button', { type: 'button', text: '查看来源画面' }, heading);
        view.addEventListener('click', () => {
          const startTime = Number(start.value);
          if (!Number.isFinite(startTime)) { setStatus(status, `第 ${index + 1} 句开始时间无效。`, 'error'); return; }
          const offset = clip.frames[0]?.time || 0;
          const sourceTime = startTime + offset;
          const sourceFrame = clip.frames.reduce((best, frame, frameIndex) => Math.abs(frame.time - sourceTime) < Math.abs(clip.frames[best].time - sourceTime) ? frameIndex : best, 0);
          pause(); resultVideo.pause(); sourceVideo.pause();
          if (Number.isFinite(sourceVideo.duration)) sourceVideo.currentTime = Math.min(Math.max(0, sourceTime), Math.max(0, sourceVideo.duration - 0.05));
          seek(sourceFrame);
        });
      }
      const text = make('textarea', { rows: 3, 'aria-label': `第 ${index + 1} 句解说文字` }, card);
      text.value = cue.text || '';
      const timing = make('div', { className: 'commentary-timing' }, card);
      const startLabel = make('label', { text: '开始（秒）' }, timing);
      const start = make('input', { type: 'number', min: 0, step: 0.1 }, startLabel);
      start.value = cue.suggestedStartTime ?? cue.startTime ?? 0;
      const endLabel = make('label', { text: '结束（秒）' }, timing);
      const end = make('input', { type: 'number', min: 0, step: 0.1 }, endLabel);
      end.value = cue.suggestedEndTime ?? cue.endTime ?? 0;
      const deliveryLabel = make('label', { text: '讲法' }, timing);
      const delivery = make('select', {}, deliveryLabel);
      for (const [value, label] of [['during_play', '播放中讲解'], ['pause', '暂停讲解']]) make('option', { value, text: label }, delivery);
      delivery.value = cue.delivery === 'pause' || cue.delivery === 'paused' ? 'pause' : 'during_play';
      cueEditors.push({ text, start, end, delivery });
      for (const field of [text, start, end, delivery]) field.addEventListener('input', onEdit);
      delivery.addEventListener('change', onEdit);
    }
    baseline = JSON.stringify(plan);
    updateButtons();
  }
  function onEdit() {
    persistLocal();
    if (!resultBox.hidden) resultNote.textContent = '解说稿已有修改，当前视频仍对应生成时保存的版本。';
    setStatus(status, changed() ? '有未保存修改。保存后再生成可更新配音字幕视频。' : '解说稿与已保存版本一致。');
    updateButtons();
  }
  function recoverLocal() {
    try {
      const envelope = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (envelope?.plan && envelope.baseline === baseline && JSON.stringify(envelope.plan) !== baseline && Array.isArray(envelope.plan.cues) && envelope.plan.cues.length === (plan.cues || []).length) {
        renderPlan(envelope.plan);
        baseline = envelope.baseline;
        updateButtons();
        setStatus(status, '已恢复本机未保存草稿；保存后才会写入服务端。');
      }
    } catch { /* ignore invalid draft */ }
  }
  async function load() {
    const token = ++serial;
    try {
      const value = await jsonRequest(`/api/commentary?${query}`);
      if (disposed || token !== serial) return;
      loaded = true; service = value.status || {};
      modelLine.textContent = `解说模型：${service.model || '服务端默认'} · 理解服务${service.understandingConfigured ? '已就绪' : '未配置'} · 配音服务${service.ttsConfigured ? '已就绪' : '未配置'}`;
      job = value.job || null;
      if (value.plan) { renderPlan(value.plan); recoverLocal(); }
      else updateButtons();
      if (ACTIVE.has(job?.status)) { setStatus(status, `已有任务${job.stage ? `：${job.stage}` : ''}，正在恢复状态。`); poll(); }
      else if (job?.action === 'render' && job.status === 'completed') showResult(job);
      else if (job?.action === 'understand' && job.status === 'completed' && job.plan && !plan) renderPlan(job.plan);
      else if (job?.error) setStatus(status, job.error, 'error');
      updateButtons();
    } catch (error) {
      if (!disposed && token === serial) setStatus(status, `读取解说稿失败：${error.message}`, 'error');
    }
  }
  async function savePlan() {
    if (!plan) return false;
    const value = readPlan();
    for (const [index, cue] of value.cues.entries()) {
      const start = Number(cue.suggestedStartTime), end = Number(cue.suggestedEndTime);
      if (String(cue.suggestedStartTime).trim() === '' || String(cue.suggestedEndTime).trim() === '' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`第 ${index + 1} 句时间无效，请填写有效的开始与结束秒数。`);
      if (!String(cue.text || '').trim()) throw new Error(`第 ${index + 1} 句解说文字不能为空。`);
    }
    await jsonRequest('/api/commentary/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ctx, plan: value }) });
    plan = value; baseline = JSON.stringify(value); persistLocal(); updateButtons();
    setStatus(status, '解说稿已保存。'); return true;
  }
  function showResult(value) {
    const resultQuery = `${query}`;
    const videoUrl = `/api/commentary/jobs/${encodeURIComponent(value.id)}/video?${resultQuery}`;
    const subtitlesUrl = `/api/commentary/jobs/${encodeURIComponent(value.id)}/subtitles?${resultQuery}`;
    resultVideo.src = videoUrl; resultVideo.load();
    mp4Link.href = videoUrl; mp4Link.download = `${sample}-commentary.mp4`;
    srtLink.href = subtitlesUrl; srtLink.download = `${sample}-commentary.srt`;
    resultNote.textContent = changed() || (value.plan && JSON.stringify(value.plan) !== JSON.stringify(readPlan()))
      ? '解说稿已有修改，当前视频对应生成时保存的版本。' : '成片对应生成时保存的解说稿。';
    resultBox.hidden = false;
    setStatus(status, '配音字幕视频已生成。');
  }
  function poll() {
    if (disposed || !job?.id || !ACTIVE.has(job.status)) return;
    const token = serial, id = job.id;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const value = await jsonRequest(`/api/commentary/jobs/${encodeURIComponent(id)}?${query}`);
        if (disposed || token !== serial) return;
        job = value; updateButtons();
        if (ACTIVE.has(job.status)) { setStatus(status, stageLabel(job.stage, job.status)); poll(); }
        else if (job.status === 'completed') {
          if (job.action === 'understand' && job.plan) { renderPlan(job.plan); clearResult(); persistLocal(); setStatus(status, '解说稿已生成，请逐句核对后保存。'); }
          else if (job.action === 'render') showResult(job);
        } else setStatus(status, job.error || (job.status === 'interrupted' ? '任务中断，可重新提交。' : '任务失败，可修改后重试。'), 'error');
      } catch (error) {
        if (disposed || token !== serial) return;
        setStatus(status, `读取任务状态失败：${error.message}，稍后重试。`, 'error'); poll();
      }
    }, 1500);
  }
  async function start(action) {
    if (busy || ACTIVE.has(job?.status)) return;
    busy = true; clearTimeout(timer); updateButtons(); clearResult(); pause();
    setStatus(status, action === 'understand' ? '正在生成解说稿…' : '正在提交配音与视频生成…');
    const token = ++serial;
    try {
      if (action === 'render' && changed()) await savePlan();
      const payload = { ...ctx, action, ...(action === 'render' ? { plan: readPlan() } : {}) };
      job = await jsonRequest('/api/commentary/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (disposed || token !== serial) return;
      if (ACTIVE.has(job.status)) { setStatus(status, stageLabel(job.stage, job.status)); poll(); }
      else if (job.status === 'completed' && action === 'understand' && job.plan) { renderPlan(job.plan); persistLocal(); setStatus(status, '解说稿已生成，请逐句核对后保存。'); }
      else if (job.status === 'completed' && action === 'render') showResult(job);
      else setStatus(status, job.error || '任务未能启动。', 'error');
    } catch (error) { if (!disposed && token === serial) setStatus(status, error.message, 'error'); }
    finally { if (!disposed && token === serial) { busy = false; updateButtons(); } }
  }
  understand.addEventListener('click', () => start('understand'));
  render.addEventListener('click', () => start('render'));
  save.addEventListener('click', async () => {
    busy = true; updateButtons();
    try { await savePlan(); } catch (error) { setStatus(status, `保存失败：${error.message}`, 'error'); }
    finally { busy = false; updateButtons(); }
  });
  summaryInput.addEventListener('input', onEdit);
  resultVideo.addEventListener('play', pause);
  sourceVideo.addEventListener('play', () => { pause(); resultVideo.pause(); });
  resultVideo.addEventListener('play', () => sourceVideo.pause());
  function dispose() {
    if (disposed) return;
    disposed = true; serial++; clearTimeout(timer); resultVideo.pause(); sourceVideo.pause();
  }
  void load();
  return {
    dispose,
    async saveDraft() {
      if (!plan) return true;
      persistLocal();
      if (!changed()) return true;
      try { return await savePlan(); } catch (error) { setStatus(status, `保存失败：${error.message}`, 'error'); return false; }
    }
  };
}
