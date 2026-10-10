import {mountCommentarySingleView} from './tactics-single-view.mjs';
import { createCommentaryClient } from './commentary-client.mjs';

const ACTIVE = new Set(['queued', 'running']);
const clone = value => value == null ? value : structuredClone(value);
const supportsJoint = plan => !!(plan?.planId && Number.isInteger(plan.revision) && plan.digest &&
  plan.producerConfigSnapshot?.model && plan.nodes?.length && plan.cues?.every(cue =>
    plan.nodes.filter(node => node.cueIds?.includes(cue.cueId)).length === 1));
const EDITABLE_CUE_FIELDS = ['text', 'language', 'suggestedStartTime', 'suggestedEndTime', 'delivery'];
function editableContent(value) {
  return JSON.stringify({ summary: value?.summary, cues: value?.cues?.map(cue => ({ cueId: cue.cueId,
    ...Object.fromEntries(EDITABLE_CUE_FIELDS.map(key => [key, key === 'language' ? cue[key] || 'zh-CN' : cue[key]])) })) });
}
function restoreContent(current, previous) {
  const restored = clone(current), originals = new Map(previous.cues.map(cue => [cue.cueId, cue]));
  restored.summary = previous.summary;
  for (const cue of restored.cues) {
    const original = originals.get(cue.cueId);
    if (!original) continue;
    for (const key of EDITABLE_CUE_FIELDS) {
      if (key in original) cue[key] = clone(original[key]);
      else delete cue[key];
    }
  }
  return restored;
}

function setStatus(node, message, kind = '') {
  node.textContent = message || '';
  node.dataset.kind = kind;
  if(node.deliveryStatus){node.deliveryStatus.textContent=message||'';node.deliveryStatus.dataset.kind=kind;}
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
  const deliveryHost=document.getElementById?.('deliveryCommentaryResult');
  let deliveryStart,deliveryStatus,deliveryVideo,deliveryDownload,deliverySubtitles;
  if(deliveryHost){
    deliveryHost.replaceChildren();
    deliveryStart=make('button',{className:'primary',text:'生成配音与战术联合成片'},deliveryHost);
    deliveryStart.addEventListener('click',()=>start('render'));
    deliveryStatus=make('p',{'role':'status','aria-live':'polite'},deliveryHost);
    deliveryVideo=make('video',{controls:true,playsInline:true,preload:'metadata',hidden:true,'aria-label':'解说联合成片预览'},deliveryHost);
    const links=make('div',{className:'tactics-buttons'},deliveryHost);
    deliveryDownload=make('a',{text:'下载联合视频 MP4',hidden:true},links);
    deliverySubtitles=make('a',{text:'下载字幕 SRT',hidden:true},links);
  }
  const sourceKey = [sample, variant, qa ? '1' : '0', clip?.video_sha256 || '', clip?.tracking_fingerprint || ''].join(':');
  const storageKey = `player-review-commentary:${encodeURIComponent(sourceKey)}`;
  root.replaceChildren();
  root.classList.add('commentary-ui');

  const details = make('details', { className: 'commentary-details' }, root);
  details.open = true;
  const summaryHeading = make('summary', { text: '解说与配音' }, details);
  const body = make('div', { className: 'commentary-body' }, details);
  const intro = make('p', { className: 'commentary-intro' }, body);
  intro.textContent = `${title} · 先生成解说和关键节点，再由独立绘图 Agent 制作图形，最后生成配音、字幕和姓名同步的联合视频。`;
  const modelLine = make('p', { className: 'commentary-muted', text: '读取解说服务状态…' }, body);
  const actions = make('div', { className: 'commentary-actions' }, body);
  const understand = make('button', { className: 'primary', text: '生成解说稿' }, actions);
  const polish = make('button', { text: '润色解说' }, actions);
  const undo = make('button', { text: '撤回本次润色', hidden: true }, actions);
  const save = make('button', { text: '保存解说稿' }, actions);
  const voiceStyle = make('select', { 'aria-label': '配音口吻' }, actions);
  make('option', { value: 'natural', text: '配音：自然有趣' }, voiceStyle);
  make('option', { value: 'classic', text: '配音：原专业口吻' }, voiceStyle);
  const render = make('button', { className: 'primary', text: '配音并生成联合视频' }, actions);
  const upgrade = make('button', { text: '重新分析并补齐关键节点', hidden: true }, actions);
  const cancel = make('button', { text: '取消当前解说任务', hidden: true }, actions);
  const workflow = make('div', { className: 'commentary-workflow-note' }, body);
  const workflowNote = make('span', {}, workflow);
  const continueDrawing = api.onOpenDrawing ? make('button', { text: '继续：战术绘图' }, workflow) : null;
  continueDrawing?.addEventListener('click', () => api.onOpenDrawing());
  const status = make('p', { className: 'commentary-status', role: 'status', 'aria-live': 'polite' }, body);
  const progress = make('progress', { hidden: true }, body);
  const summaryLabel = make('label', { className: 'commentary-label', text: '解说梗概（可选）' }, body);
  const summaryInput = make('textarea', { rows: 2, placeholder: '可补充整体讲解重点' }, summaryLabel);
  const candidateBox = make('section', { className: 'commentary-cue', hidden: true }, body);
  make('h3', { text: '润色候选 · 原稿尚未改变' }, candidateBox);
  const candidateList = make('div', { className: 'commentary-candidate-list' }, candidateBox);
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

  const singleView=mountCommentarySingleView({root,body,columns,mediaColumn,sourceBox,sourceVideo,resultBox,resultVideo,actions,modelLine,intro,workflow,status,progress,summaryLabel,candidateBox,cueList,clip,pause,seek});
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
    status.deliveryStatus=deliveryStatus;
    const hasPlan = !!plan;
    const locked = busy || ACTIVE.has(job?.status);
    workflowNote.textContent = !hasPlan ? '先生成并核对解说，保存后即可按关键节点绘图。'
      : !supportsJoint(plan) ? '这是旧版解说。可继续编辑与配音；补齐关键节点后可按解说绘图。'
      : changed() ? '解说有未保存修改。保存后再继续绘图，已有图形需按新稿核对。'
      : '解说已保存。下一步核对战术图形，再生成配音、字幕与画面同步的联合视频。';
    if (continueDrawing) continueDrawing.disabled = locked || !supportsJoint(plan) || changed();
    understand.disabled = locked;
    polish.disabled = locked || !hasPlan;
    voiceStyle.disabled = locked;
    adopt.disabled = locked || !candidate || JSON.stringify(readPlan()) !== JSON.stringify(candidate.originalPlan);
    undo.hidden = !undoPlan;
    undo.disabled = locked || !undoPlan || editableContent(readPlan()) !== adoptedSnapshot;
    if (candidate) candidateNote.textContent = adopt.disabled && !locked
      ? '原稿在生成后已有变化，请重新润色；候选仍可对照阅读。'
      : '核对动作、结果和用梗场景后采用；采用后仍需保存。';
    render.disabled = locked || !hasPlan;
    if(deliveryStart)deliveryStart.disabled=locked||!hasPlan;
    render.textContent = hasPlan && !supportsJoint(plan) ? '配音并生成字幕视频' : '配音并生成联合视频';
    save.disabled = busy || !hasPlan || !changed();
    const editingLocked = busy || (ACTIVE.has(job?.status) && job?.action !== 'polish');
    for (const field of [summaryInput, ...cueEditors.flatMap(cue => [cue.text, cue.start, cue.end, cue.delivery, cue.language])]) field.disabled = editingLocked;
    const savedCues = new Map((baseline ? JSON.parse(baseline)?.cues || [] : []).map(c => [c.cueId, c]));
    for (const [index, fields] of cueEditors.entries()) {
      const current = readPlan().cues[index], saved = savedCues.get(current.cueId);
      const dirty = JSON.stringify(current) !== JSON.stringify(saved);
      fields.saveCue.disabled = editingLocked || !saved || !dirty;
      fields.resetCue.disabled = editingLocked || !saved || !dirty;
      fields.note.textContent = dirty ? '本句有未保存修改' : current.editedBy === 'human' ? '本句已人工保存' : '本句与已保存版本一致';
    }
    save.textContent = changed() ? '保存解说稿 · 有未保存修改' : '保存解说稿';
    upgrade.hidden = !hasPlan || supportsJoint(plan);
    upgrade.disabled = locked;
    cancel.hidden = !ACTIVE.has(job?.status);
  }
  function clearResult() {
    resultVideo.pause(); resultVideo.removeAttribute('src'); resultVideo.load(); resultBox.hidden = true;
    mp4Link.removeAttribute('href'); srtLink.removeAttribute('href');
  }
  function renderPlan(value, savedPlan = value) {
    plan = clone(value);
    cueEditors.length = 0;
    cueList.replaceChildren();
    summaryInput.value = plan?.summary || '';
    if (!plan?.cues?.length) make('p', { className: 'studio-empty-note', text: '还没有解说稿。生成后可以逐句核对文字、起止时间和讲述方式，再制作配音字幕视频。' }, cueList);
    for (const [index, cue] of (plan?.cues || []).entries()) {
      const card = make('article', { className: 'commentary-cue' }, cueList);
      const heading = make('div', { className: 'commentary-cue-heading' }, card);
      make('strong', { text: `第 ${index + 1} 句` }, heading);
      for (const node of plan.nodes?.filter(node => node.cueIds?.includes(cue.cueId)) || []) {
        const anchor = make('button', { type: 'button', text: `关键节点 · 帧 ${node.anchorAssetFrame + 1}` }, heading);
        anchor.addEventListener('click', () => { singleView?.selectSource(); pause(); sourceVideo.pause(); resultVideo.pause(); const time=clip?.frames?.[node.anchorAssetFrame]?.time;if(Number.isFinite(time))sourceVideo.currentTime=time;seek(node.anchorAssetFrame); });
      }
      if (Array.isArray(clip?.frames) && clip.frames.length) {
        const view = make('button', { type: 'button', text: '查看来源画面' }, heading);
        view.addEventListener('click', () => {
          singleView?.selectSource();
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
    baseline = JSON.stringify(savedPlan);
    api.onPlanChange?.(clone(plan), changed());
    updateButtons();
  }
  function onEdit() {
    persistLocal();
    if (!resultBox.hidden) resultNote.textContent = '解说稿已有修改，当前视频仍对应生成时保存的版本。';
    setStatus(status, changed() ? '有未保存修改。保存后再生成可更新配音字幕视频。' : '解说稿与已保存版本一致。');
    updateButtons();
    api.onPlanChange?.(readPlan(), changed());
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
        renderPlan(envelope.plan, JSON.parse(envelope.baseline));
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
      if (['natural', 'classic'].includes(job?.voiceStyle)) voiceStyle.value = job.voiceStyle;
      if (value.plan) { renderPlan(value.plan); recoverLocal(); }
      else renderPlan(null);
      if(value.result)showResult(value.result);
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
      if (String(cue.suggestedStartTime).trim() === '' || String(cue.suggestedEndTime).trim() === '' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || (end === start && cue.delivery !== 'pause')) throw new Error(`第 ${index + 1} 句时间无效，请填写有效的开始与结束秒数。`);
      if (!String(cue.text || '').trim()) throw new Error(`第 ${index + 1} 句解说文字不能为空。`);
    }
    const saved = await client.savePlan(value, { expectedRevision: plan.revision ?? 0, review: api.commentaryReview?.() ?? api.snapshot?.() });
    renderPlan(saved.plan || saved); persistLocal(); updateButtons();
    setStatus(status, '解说稿已保存。'); return true;
  }
  function resetOneCue(cueId) {
    const saved = JSON.parse(baseline), draft = readPlan();
    const cue = saved.cues.find(c => c.cueId === cueId);
    if (!cue) return;
    draft.cues = draft.cues.map(c => c.cueId === cueId ? clone(cue) : c);
    renderPlan(draft, saved); onEdit();
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
      const result = await client.saveCue(cueId, patch, expected, { planId: saved.planId, expectedRevision: saved.revision ?? 0, review: api.commentaryReview?.() ?? api.snapshot?.() });
      if (disposed || token !== serial) return;
      const originals = new Map(saved.cues.map(c => [c.cueId, c]));
      const local = new Map(draft.cues.map(c => [c.cueId, c]));
      const merged = { ...clone(result.plan), summary: draft.summary === saved.summary ? result.plan.summary : draft.summary };
      merged.cues = result.plan.cues.map(remote => remote.cueId === cueId
        || JSON.stringify(local.get(remote.cueId)) === JSON.stringify(originals.get(remote.cueId))
        ? remote : local.get(remote.cueId) || remote);
      renderPlan(merged, result.plan); onEdit();
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
    if(deliveryVideo){
      deliveryVideo.src=videoUrl;deliveryVideo.hidden=false;deliveryVideo.load();
      deliveryDownload.href=videoUrl;deliveryDownload.download=`${sample}-commentary.mp4`;deliveryDownload.hidden=false;
      deliverySubtitles.href=subtitlesUrl;deliverySubtitles.download=`${sample}-commentary.srt`;deliverySubtitles.hidden=false;
    }
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
  async function start(action, { wait = false } = {}) {
    if (busy || ACTIVE.has(job?.status)) return;
    busy = true; clearTimeout(timer); updateButtons();
    if (action !== 'polish') clearResult();
    pause(); candidate = null; candidateBox.hidden = true;
    if (action === 'understand') { undoPlan = null; adoptedSnapshot = ''; }
    setStatus(status, action === 'understand' ? '正在生成解说稿…' : action === 'polish' ? '正在润色整段解说…' : '正在提交配音与视频生成…');
    const token = ++serial;
    try {
      if (action === 'render' && changed()) await savePlan();
      await api.beforeCommentary?.(action);
      const joint = action === 'render' && supportsJoint(plan);
      const renderSnapshot = joint ? await api.jointRenderSnapshot?.() : null;
      const payload = { ...ctx, action, review: api.commentaryReview?.() ?? api.snapshot?.(), expectedRevision: plan?.revision ?? 0, voiceStyle: voiceStyle.value,
        ...(action !== 'understand' ? { plan: readPlan() } : {}),
        ...(joint ? { commentaryPlanRef: { planId: plan.planId, revision: plan.revision, digest: plan.digest }, ...renderSnapshot } : {}) };
      job = await client.startJob(payload);
      if (disposed || token !== serial) return;
      updateButtons();
      if (wait) {
        const deadline = Date.now() + 20 * 60 * 1000;
        while (ACTIVE.has(job.status)) {
          if (disposed || token !== serial) throw new Error('解说等待已取消。');
          if (Date.now() > deadline) throw new Error('解说仍在运行，可刷新状态后继续绘图。');
          setStatus(status, stageLabel(job.stage, job.status));
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (disposed || token !== serial) throw new Error('解说等待已取消。');
          job = await client.getJob(job.id);
        }
      }
      if (ACTIVE.has(job.status)) { setStatus(status, stageLabel(job.stage, job.status)); poll(); }
      else if (job.status === 'completed' && action === 'understand' && job.plan) { renderPlan(job.plan); persistLocal(); setStatus(status, '解说稿已生成，请逐句核对后保存。'); }
      else if (job.status === 'completed' && action === 'render') showResult(job);
      else if (job.status === 'completed' && action === 'polish') showCandidate(job);
      else { const message = job.error || '任务未能启动。'; setStatus(status, message, 'error'); if (wait) throw new Error(message); }
      return clone(plan);
    } catch (error) { if (!disposed && token === serial) setStatus(status, error.message, 'error'); if (wait) throw error; }
    finally { if (!disposed && token === serial) { busy = false; updateButtons(); } }
  }
  understand.addEventListener('click', () => start('understand'));
  polish.addEventListener('click', () => start('polish'));
  adopt.addEventListener('click', () => {
    if (!candidate || adopt.disabled) return;
    undoPlan = readPlan();
    const adopted = readPlan(), texts = new Map(candidate.plan.cues.map(cue => [cue.cueId, cue.text]));
    // A polish candidate contributes prose only; the saved plan owns nodes, names and revision.
    adopted.cues = adopted.cues.map(cue => ({ ...cue, text: texts.get(cue.cueId) ?? cue.text }));
    renderPlan(adopted, JSON.parse(baseline));
    adoptedSnapshot = editableContent(readPlan());
    candidate = null; candidateBox.hidden = true;
    onEdit();
    setStatus(status, '已采用润色稿，可继续编辑或保存。');
  });
  discard.addEventListener('click', () => { candidate = null; candidateBox.hidden = true; updateButtons(); });
  undo.addEventListener('click', () => {
    if (undo.disabled || !undoPlan) return;
    // Keep the newest server revision even when reverting prose after it was saved.
    renderPlan(restoreContent(readPlan(), undoPlan), JSON.parse(baseline));
    undoPlan = null; adoptedSnapshot = ''; onEdit();
    setStatus(status, '已恢复润色前的稿件。');
  });
  upgrade.addEventListener('click', () => start('understand'));
  cancel.addEventListener('click', async () => {
    if (!job?.id || !ACTIVE.has(job.status)) return;
    cancel.disabled = true;
    try {
      const cancelled = await client.cancelJob(job.id);
      serial++; clearTimeout(timer); job = cancelled; busy = false;
      setStatus(status, '任务已取消，已保存解说与人工草稿保留。'); updateButtons();
    } catch (error) { setStatus(status, `取消失败：${error.message}`, 'error'); }
    finally { cancel.disabled = false; }
  });
  render.addEventListener('click', () => start('render'));
  save.addEventListener('click', async () => {
    busy = true; updateButtons();
    try { await savePlan(); } catch (error) { setStatus(status, `保存失败：${error.message}`, 'error'); }
    finally { busy = false; updateButtons(); }
  });
  summaryInput.addEventListener('input', onEdit);
  voiceStyle.addEventListener('change', () => {
    if (!resultBox.hidden) resultNote.textContent = '配音口吻已有修改，当前视频使用生成时的口吻。请重新生成视频。';
  });
  resultVideo.addEventListener('play', pause);
  sourceVideo.addEventListener('play', () => { pause(); resultVideo.pause(); });
  resultVideo.addEventListener('play', () => sourceVideo.pause());
  function dispose() {
    if (disposed) return;
    disposed = true; serial++; clearTimeout(timer); resultVideo.pause(); sourceVideo.pause();
  }
  const loadedPlan = load();
  return {
    dispose,
    pause() { resultVideo.pause(); sourceVideo.pause(); deliveryVideo?.pause(); },
    markResultStale() { if (!resultBox.hidden) resultNote.textContent = '图形或姓名展示已有修改，当前视频对应之前保存的版本。请重新生成联合视频。'; },
    getPlan: () => clone(plan),
    renderVideo: () => start('render'),
    async ensurePlan() {
      await loadedPlan;
      if (busy || ACTIVE.has(job?.status)) throw new Error('解说任务正在运行，请在解说完成后继续绘图。');
      if (!plan) await start('understand', { wait: true });
      if (!supportsJoint(plan)) throw new Error('这份旧解说没有完整的关键节点依据，请点击「重新分析并补齐关键节点」。');
      if (changed()) await savePlan();
      return clone(plan);
    },
    async saveDraft() {
      if (!plan) return true;
      persistLocal();
      if (!changed()) return true;
      try { return await savePlan(); } catch (error) { setStatus(status, `保存失败：${error.message}`, 'error'); return false; }
    }
  };
}
