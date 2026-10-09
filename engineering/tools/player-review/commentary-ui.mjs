import { createCommentaryClient } from './commentary-client.mjs';

const ACTIVE = new Set(['queued', 'running']);
const clone = value => value == null ? value : structuredClone(value);


function setStatus(node, message, kind = '') {
  node.textContent = message || '';
  node.dataset.kind = kind;
}

function stageLabel(stage, status) {
  const labels = { understanding: '正在理解视频', polishing: '正在润色整段解说', speech: '正在合成配音', synthesizing: '正在合成配音', rendering: '正在生成字幕视频', queued: '任务排队中' };
  return `${labels[stage] || (status === 'queued' ? labels.queued : stage || '正在处理')}…`;
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
  const client = createCommentaryClient(ctx);
  const query = client.query;
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
  const polish = make('button', { text: '润色解说' }, actions);
  const undo = make('button', { text: '撤回本次润色', hidden: true }, actions);
  const save = make('button', { text: '保存解说稿' }, actions);
  const voiceStyle = make('select', { 'aria-label': '配音口吻' }, actions);
  make('option', { value: 'natural', text: '配音：自然有趣' }, voiceStyle);
  make('option', { value: 'classic', text: '配音：原专业口吻' }, voiceStyle);
  const render = make('button', { className: 'primary', text: '配音并生成字幕视频' }, actions);
  const status = make('p', { className: 'commentary-status', role: 'status', 'aria-live': 'polite' }, body);
  const progress = make('progress', { hidden: true }, body);
  const summaryLabel = make('label', { className: 'commentary-label', text: '解说梗概（可选）' }, body);
  const summaryInput = make('textarea', { rows: 2, placeholder: '可补充整体讲解重点' }, summaryLabel);
  const candidateBox = make('section', { className: 'commentary-cue', hidden: true }, body);
  make('h3', { text: '润色候选 · 原稿尚未改变' }, candidateBox);
  const candidateList = make('div', {}, candidateBox);
  const candidateNote = make('p', { className: 'commentary-muted' }, candidateBox);
  const candidateActions = make('div', { className: 'commentary-actions' }, candidateBox);
  const adopt = make('button', { text: '采用润色稿', className: 'primary' }, candidateActions);
  const discard = make('button', { text: '丢弃候选' }, candidateActions);
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
  let candidate = null, undoPlan = null, adoptedSnapshot = '';
  const cueEditors = [];
  const changed = () => !!plan && JSON.stringify(readPlan()) !== baseline;
  function readPlan() {
    if (!plan) return null;
    const next = clone(plan);
    next.summary = summaryInput.value;
    next.cues = (next.cues || []).map((cue, index) => {
      const fields = cueEditors[index];
      if (!fields) return cue;
      return { ...cue, ...(cue.language || fields.language.value !== 'zh-CN' ? { language: fields.language.value } : {}), text: fields.text.value, suggestedStartTime: fields.start.value.trim() ? numberOr(fields.start.value, cue.suggestedStartTime) : '',
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
    polish.disabled = locked || !hasPlan;
    voiceStyle.disabled = locked;
    adopt.disabled = locked || !candidate || JSON.stringify(readPlan()) !== JSON.stringify(candidate.originalPlan);
    undo.hidden = !undoPlan;
    undo.disabled = locked || !undoPlan || JSON.stringify(readPlan()) !== adoptedSnapshot;
    if (candidate) candidateNote.textContent = adopt.disabled && !locked
      ? '原稿在生成后已有变化，请重新润色；候选仍可对照阅读。'
      : '核对动作、结果和用梗场景后采用；采用后仍需保存。';
    render.disabled = locked || !hasPlan;
    save.disabled = busy || !hasPlan || !changed();
    const editingLocked = busy || (ACTIVE.has(job?.status) && job?.action !== 'polish');
    for (const field of [summaryInput, ...cueEditors.flatMap(cue => [cue.text, cue.start, cue.end, cue.delivery, cue.language])]) field.disabled = editingLocked;
    const savedCues = new Map((baseline ? JSON.parse(baseline).cues : []).map(c => [c.cueId, c]));
    for (const [index, fields] of cueEditors.entries()) {
      const current = readPlan().cues[index], saved = savedCues.get(current.cueId);
      const dirty = JSON.stringify(current) !== JSON.stringify(saved);
      fields.saveCue.disabled = editingLocked || !saved || !dirty;
      fields.resetCue.disabled = editingLocked || !saved || !dirty;
      fields.note.textContent = dirty ? '本句有未保存修改' : current.editedBy === 'human' ? '本句已人工保存' : '本句与已保存版本一致';
    }
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
      const languageLabel = make('label', { text: '语言标记' }, timing);
      const language = make('select', { 'aria-label': `第 ${index + 1} 句语言` }, languageLabel);
      for (const [value, label] of [['zh-CN', '中文'], ['mul', '中英混说'], ['en-US', '英文']]) make('option', { value, text: label }, language);
      language.value = cue.language || 'zh-CN';
      const cueActions = make('div', { className: 'commentary-actions' }, card);
      const saveCue = make('button', { text: '保存本句', 'aria-label': `保存第 ${index + 1} 句` }, cueActions);
      const resetCue = make('button', { text: '恢复本句', 'aria-label': `恢复第 ${index + 1} 句` }, cueActions);
      const note = make('p', { className: 'commentary-muted', role: 'status' }, card);
      saveCue.addEventListener('click', () => saveOneCue(cue.cueId));
      resetCue.addEventListener('click', () => resetOneCue(cue.cueId));
      cueEditors.push({ text, start, end, delivery, language, saveCue, resetCue, note });
      for (const field of [text, start, end, delivery, language]) field.addEventListener('input', onEdit);
      delivery.addEventListener('change', onEdit);
      language.addEventListener('change', onEdit);
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
  function showCandidate(value) {
    candidate = value;
    candidateList.replaceChildren();
    const originals = new Map((value.originalPlan?.cues || []).map(cue => [cue.cueId, cue.text]));
    for (const [index, cue] of (value.plan?.cues || []).entries()) {
      const row = make('article', {}, candidateList);
      make('strong', { text: `第 ${index + 1} 句` }, row);
      make('p', { text: `原稿：${originals.get(cue.cueId) || ''}`, className: 'commentary-muted' }, row);
      make('p', { text: `润色：${cue.text}` }, row);
    }
    candidateBox.hidden = false;
    setStatus(status, '润色候选已生成，请对照原稿查看。');
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
      const value = await client.getState();
      if (disposed || token !== serial) return;
      loaded = true; service = value.status || {};
      modelLine.textContent = `解说模型：${service.model || '服务端默认'} · 理解服务${service.understandingConfigured ? '已就绪' : '未配置'} · 配音服务${service.ttsConfigured ? '已就绪' : '未配置'}`;
      job = value.job || null;
      if (value.plan) { renderPlan(value.plan); recoverLocal(); }
      else updateButtons();
      if (ACTIVE.has(job?.status)) { setStatus(status, `已有任务${job.stage ? `：${job.stage}` : ''}，正在恢复状态。`); poll(); }
      else if (job?.action === 'render' && job.status === 'completed') showResult(job);
      else if (job?.action === 'polish' && job.status === 'completed') showCandidate(job);
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
    await client.savePlan(value);
    plan = value; baseline = JSON.stringify(value); persistLocal(); updateButtons();
    setStatus(status, '解说稿已保存。'); return true;
  }
  function resetOneCue(cueId) {
    const saved = JSON.parse(baseline), draft = readPlan();
    const cue = saved.cues.find(c => c.cueId === cueId);
    if (!cue) return;
    draft.cues = draft.cues.map(c => c.cueId === cueId ? clone(cue) : c);
    const previousBaseline = baseline;
    renderPlan(draft); baseline = previousBaseline; onEdit();
    setStatus(status, '本句已恢复为上次保存的内容，其他句子保留。');
  }
  async function saveOneCue(cueId) {
    if (busy) return;
    const draft = readPlan(), saved = JSON.parse(baseline);
    const cue = draft.cues.find(c => c.cueId === cueId);
    const expected = saved.cues.find(c => c.cueId === cueId);
    if (!cue || !expected) return;
    const patch = { text: cue.text, language: cue.language || 'zh-CN',
      suggestedStartTime: cue.suggestedStartTime, suggestedEndTime: cue.suggestedEndTime, delivery: cue.delivery };
    busy = true; updateButtons();
    const token = serial;
    try {
      const result = await client.saveCue(cueId, patch, expected);
      if (disposed || token !== serial) return;
      const originals = new Map(saved.cues.map(c => [c.cueId, c]));
      const local = new Map(draft.cues.map(c => [c.cueId, c]));
      const merged = { ...clone(result.plan), summary: draft.summary === saved.summary ? result.plan.summary : draft.summary };
      merged.cues = result.plan.cues.map(remote => remote.cueId === cueId
        || JSON.stringify(local.get(remote.cueId)) === JSON.stringify(originals.get(remote.cueId))
        ? remote : local.get(remote.cueId) || remote);
      renderPlan(merged); baseline = JSON.stringify(result.plan); onEdit();
      setStatus(status, '本句已人工保存，其他句子的未保存修改保留。需要重新生成配音才能更新成片。');
    } catch (error) {
      if (!disposed && token === serial) setStatus(status, `本句保存失败：${error.message}`, 'error');
    } finally {
      if (!disposed && token === serial) { busy = false; updateButtons(); }
    }
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
    setStatus(status, ['配音字幕视频已生成。', ...(value.timingWarnings || [])].join(' '));
  }
  function poll() {
    if (disposed || !job?.id || !ACTIVE.has(job.status)) return;
    const token = serial, id = job.id;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const value = await client.getJob(id);
        if (disposed || token !== serial) return;
        job = value; updateButtons();
        if (ACTIVE.has(job.status)) { setStatus(status, stageLabel(job.stage, job.status)); poll(); }
        else if (job.status === 'completed') {
          if (job.action === 'understand' && job.plan) { renderPlan(job.plan); clearResult(); persistLocal(); setStatus(status, '解说稿已生成，请逐句核对后保存。'); }
          else if (job.action === 'render') showResult(job);
          else if (job.action === 'polish') showCandidate(job);
        } else setStatus(status, job.error || (job.status === 'interrupted' ? '任务中断，可重新提交。' : '任务失败，可修改后重试。'), 'error');
      } catch (error) {
        if (disposed || token !== serial) return;
        setStatus(status, `读取任务状态失败：${error.message}，稍后重试。`, 'error'); poll();
      }
    }, 1500);
  }
  async function start(action) {
    if (busy || ACTIVE.has(job?.status)) return;
    busy = true; clearTimeout(timer); updateButtons();
    if (action !== 'polish') clearResult();
    pause(); candidate = null; candidateBox.hidden = true;
    setStatus(status, action === 'understand' ? '正在生成解说稿…' : action === 'polish' ? '正在润色整段解说…' : '正在提交配音与视频生成…');
    const token = ++serial;
    try {
      if (action === 'render' && changed()) await savePlan();
      const payload = { ...ctx, action, ...(action !== 'understand' ? { plan: readPlan() } : {}), voiceStyle: voiceStyle.value };
      job = await client.startJob(payload);
      if (disposed || token !== serial) return;
      if (ACTIVE.has(job.status)) { setStatus(status, stageLabel(job.stage, job.status)); poll(); }
      else if (job.status === 'completed' && action === 'understand' && job.plan) { renderPlan(job.plan); persistLocal(); setStatus(status, '解说稿已生成，请逐句核对后保存。'); }
      else if (job.status === 'completed' && action === 'render') showResult(job);
      else if (job.status === 'completed' && action === 'polish') showCandidate(job);
      else setStatus(status, job.error || '任务未能启动。', 'error');
    } catch (error) { if (!disposed && token === serial) setStatus(status, error.message, 'error'); }
    finally { if (!disposed && token === serial) { busy = false; updateButtons(); } }
  }
  understand.addEventListener('click', () => start('understand'));
  polish.addEventListener('click', () => start('polish'));
  adopt.addEventListener('click', () => {
    if (!candidate || adopt.disabled) return;
    undoPlan = readPlan();
    const savedBaseline = baseline;
    renderPlan(candidate.plan);
    baseline = savedBaseline;
    adoptedSnapshot = JSON.stringify(readPlan());
    candidate = null; candidateBox.hidden = true;
    onEdit();
    setStatus(status, '已采用润色稿，可继续编辑或保存。');
  });
  discard.addEventListener('click', () => { candidate = null; candidateBox.hidden = true; updateButtons(); });
  undo.addEventListener('click', () => {
    if (undo.disabled || !undoPlan) return;
    const savedBaseline = baseline;
    renderPlan(undoPlan); baseline = savedBaseline;
    undoPlan = null; adoptedSnapshot = ''; onEdit();
    setStatus(status, '已恢复润色前的稿件。');
  });
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
