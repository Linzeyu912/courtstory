import { courtMarkings } from './court-geometry.mjs';
import { availableCounts, frameAtTime, hasDenoiseComparison, imagePoint, pathSegments, pointSource, replayPlayers, playerFrames, selectReplayPlayers } from './trajectory-replay-model.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), colors = { raw: '#63b9ed', qwen: '#c5ee8e' };
const length = 28.6512, width = 15.24;
let data = null, index = 0, fullCourt = false, loadId = 0, courtTransform = null;
let selectedId = null, views = new Map();
const players = () => replayPlayers(data);
const visiblePlayers = () => selectReplayPlayers(players(), $('playerFilter').value);
const rowsFor = id => views.get(id) ?? data.frames;
const currentRow = () => rowsFor(selectedId)[index];
const playerColor = (player, key) => data.players?.length
  ? player.team === 'white' ? '#ff9d5a' : '#65b7ff' : colors[key];
const labelFor = player => player.name || player.id;

function error(message) { $('error').hidden = !message; $('error').textContent = message; }
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('尚未生成实测回放数据，请先运行实测包里的 export_replay.py。');
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value;
}
function surface(canvas) {
  const { width: w, height: h } = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function line(ctx, points, color, thickness = 2, dash = []) {
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.setLineDash(dash);
  let pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    if (pen) ctx.lineTo(...p); else { ctx.moveTo(...p); pen = true; }
  }
  ctx.stroke(); ctx.setLineDash([]);
}
function dot(ctx, p, color, size = 5) {
  if (!p) return;
  ctx.beginPath(); ctx.arc(...p, size + 5, 0, Math.PI * 2); ctx.fillStyle = color + '28'; ctx.fill();
  ctx.beginPath(); ctx.arc(...p, size, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#122421'; ctx.lineWidth = 1.5; ctx.stroke();
}
function text(ctx, label, x, y, color = '#a4b9af', size = 10) {
  ctx.fillStyle = color; ctx.font = `${size}px "Bahnschrift", "Microsoft YaHei", sans-serif`; ctx.fillText(label, x, y);
}
function enabled(key) { return $(key === 'raw' ? 'showRaw' : 'showQwen').checked; }
const sourceEnabled = key => key === 'refined' ? $('showRefined').checked : enabled(key);
const sourceStyle = key => key === 'raw' ? { alpha: '65', width: 1.5, dash: [4, 3], dot: 3.7 }
  : key === 'refined' ? { alpha: 'a0', width: 1.8, dash: [2, 3], dot: 4 }
    : { alpha: 'e8', width: 2.6, dash: [], dot: 5.2 };

function drawCourt() {
  const { ctx, w, h } = surface($('court'));
  // A hidden panel or a temporarily collapsed sidebar has no drawable court.
  if (w <= 60 || h <= 60) { courtTransform = null; return; }
  $('courtSide').textContent = fullCourt ? '全场 / 俯视' : data.side === 'left' ? '左侧半场 / 俯视' : '右侧半场 / 俯视';
  const minX = fullCourt || data.side === 'left' ? 0 : length / 2;
  const spanX = fullCourt ? length : length / 2;
  const scale = Math.min((w - 60) / spanX, (h - 60) / width);
  const ox = (w - spanX * scale) / 2, oy = (h - width * scale) / 2;
  const point = ([x, y]) => [ox + (x - minX) * scale, oy + y * scale];
  courtTransform = point;
  ctx.fillStyle = '#1b2b2b'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#223836'; ctx.fillRect(ox, oy, spanX * scale, width * scale);
  for (let x = 0; x < length; x += 1.2) {
    if (x < minX || x >= minX + spanX) continue;
    ctx.fillStyle = Math.round(x / 1.2) % 2 ? '#ffffff03' : '#00000003';
    ctx.fillRect(point([x, 0])[0], oy, Math.min(1.2, minX + spanX - x) * scale, width * scale);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(ox - 1, oy - 1, spanX * scale + 2, width * scale + 2); ctx.clip();
  for (const side of ['left', 'right']) {
    const x = side === 'left' ? 0 : length - 5.7912;
    ctx.fillStyle = '#2b4540'; ctx.fillRect(...point([x, 5.1816]), 5.7912 * scale, 4.8768 * scale);
  }
  for (const marking of courtMarkings()) line(ctx, marking.points.map(point), '#738d7f', 1);
  for (const [cx, cy, r] of [[length / 2, width / 2, 1.8288], [5.7912, width / 2, 1.8288], [length - 5.7912, width / 2, 1.8288]]) {
    ctx.beginPath(); ctx.arc(...point([cx, cy]), r * scale, 0, Math.PI * 2); ctx.strokeStyle = '#738d7f'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const x of [1.6002, length - 1.6002]) {
    ctx.beginPath(); ctx.arc(...point([x, width / 2]), .2286 * scale, 0, Math.PI * 2); ctx.strokeStyle = '#c1cbb0'; ctx.stroke();
  }
  ctx.restore();
  text(ctx, '0 m', ox, oy + width * scale + 17, '#7f9a91', 9);
  text(ctx, `${fullCourt ? '28.65' : '14.33'} m`, ox + spanX * scale - 40, oy + width * scale + 17, '#7f9a91', 9);
  // Leave a small margin for genuinely off-court estimates rather than clamping their coordinates.
  ctx.save(); ctx.beginPath(); ctx.rect(0, 24, w, h - 24); ctx.clip();
  const choice = $('trailLength').value;
  const end = choice === 'full' ? data.frames.length - 1 : index;
  const since = choice === '1.5' ? data.frames[index].time - 1.5 : -Infinity;
  for (const player of visiblePlayers()) for (const key of ['raw', 'refined', 'qwen']) {
    if (!sourceEnabled(key)) continue;
    const rows = rowsFor(player.id), color = playerColor(player, key);
    const style = sourceStyle(key);
    for (const segment of pathSegments(rows, key, end, since)) line(ctx, segment.map(point), color + (data.players ? style.alpha : ''), style.width, style.dash);
    const current = rows[index][key];
    if (current) {
      const p = point(current); dot(ctx, p, color, style.dot);
      if (data.players?.length && key === (rows[index].qwen ? 'qwen' : rows[index].refined ? 'refined' : 'raw')) text(ctx, labelFor(player), p[0] + 8, p[1] - 6, color, 10);
    }
  }
  ctx.restore();
}

function drawVideo() {
  const { ctx, w, h } = surface($('videoOverlay'));
  const sx = w / data.width, sy = h / data.height;
  const point = p => p ? [p[0] * sx, p[1] * sy] : null;
  for (const player of visiblePlayers()) {
  const rows = rowsFor(player.id), row = rows[index], color = playerColor(player, 'qwen');
  if (row.bbox) {
    const [x1, y1, x2, y2] = row.bbox, x = x1 * sx, y = y1 * sy, bw = (x2 - x1) * sx, bh = (y2 - y1) * sy;
    const corner = Math.min(12, bw / 3);
    for (const [x, y, dx, dy] of [[x1 * sx, y1 * sy, 1, 1], [x2 * sx, y1 * sy, -1, 1], [x1 * sx, y2 * sy, 1, -1], [x2 * sx, y2 * sy, -1, -1]])
      line(ctx, [[x, y + dy * corner], [x, y], [x + dx * corner, y]], data.players ? color : '#f5f2dc', player.id === selectedId ? 2.5 : 1.5);
    ctx.fillStyle = '#10191ccc'; ctx.fillRect(x, Math.max(0, y - 21), Math.max(53, bw), 17);
    text(ctx, data.players ? labelFor(player) : `${data.entityId} · 目标`, x + 5, Math.max(12, y - 9), data.players ? color : '#f5f2dc', 10);
  }
  for (const key of ['raw', 'refined', 'qwen']) {
    if (!sourceEnabled(key)) continue;
    const style = sourceStyle(key);
    // Reproject every historical ground point through this frame's camera mapping.
    if ($('showVideoTrail').checked && row.toImage)
      for (const segment of pathSegments(rows, key, index, row.time - 1.5))
        line(ctx, segment.map(p => point(imagePoint(row.toImage, p))), playerColor(player, key) + style.alpha, style.width, style.dash);
    dot(ctx, point(imagePoint(row.toImage, row[key])), playerColor(player, key), style.dot);
  }
  }
  drawZoom(currentRow());
}

function drawZoom(row) {
  const { ctx, w, h } = surface($('footZoom'));
  if (!w || !h) return;
  ctx.fillStyle = '#11191c'; ctx.fillRect(0, 0, w, h);
  if (!row.bbox || video.readyState < 2) { text(ctx, '此帧没有球员检测框', 12, h / 2); return; }
  const center = [(row.bbox[0] + row.bbox[2]) / 2, row.bbox[3] - 18];
  const cropWidth = Math.max(230, row.bbox[2] - row.bbox[0] + 110), cropHeight = cropWidth * h / w;
  const x = Math.max(0, Math.min(data.width - cropWidth, center[0] - cropWidth / 2));
  const y = Math.max(0, Math.min(data.height - cropHeight, center[1] - cropHeight / 2));
  ctx.drawImage(video, x, y, cropWidth, cropHeight, 0, 0, w, h);
  for (const key of ['raw', 'refined', 'qwen']) {
    if (!sourceEnabled(key)) continue;
    const p = imagePoint(row.toImage, row[key]);
    if (p) dot(ctx, [(p[0] - x) * w / cropWidth, (p[1] - y) * h / cropHeight], playerColor(players().find(p => p.id === selectedId), key), sourceStyle(key).dot);
  }
}

function drawCoverage() {
  for (const key of ['raw', 'refined', 'qwen']) {
    const { ctx, w, h } = surface($(key + 'Coverage'));
    const duration = data.endTime - data.startTime;
    data.frames.forEach((row, i) => {
      const start = (row.time - data.startTime) / duration * w;
      const end = ((data.frames[i + 1]?.time ?? data.endTime) - data.startTime) / duration * w;
      const subset = visiblePlayers();
      const barWidth = Math.max(1, end - start);
      if (!data.players?.length) {
        ctx.fillStyle = rowsFor(subset[0].id)[i][key] ? colors[key] + '85' : '#c68d58';
        ctx.fillRect(start, 0, barWidth, h);
      } else if ($('playerFilter').value === 'all') {
        for (const [team, y] of [['white', 0], ['dark_blue', h / 2]]) {
          const members = subset.filter(player => player.team === team);
          const count = members.filter(player => rowsFor(player.id)[i][key]).length;
          const color = team === 'white' ? '#ff9d5a' : '#65b7ff';
          ctx.fillStyle = count ? color + Math.round(50 + 170 * count / Math.max(1, members.length)).toString(16).padStart(2, '0') : '#c68d58';
          ctx.fillRect(start, y, barWidth, h / 2);
        }
      } else {
        const active = subset.filter(player => rowsFor(player.id)[i][key]).length;
        ctx.fillStyle = active ? playerColor(subset[0], key) + 'aa' : '#c68d58';
        ctx.fillRect(start, 0, barWidth, h);
      }
    });
    const x = (data.frames[index].time - data.startTime) / duration * w;
    ctx.fillStyle = '#fafce9'; ctx.fillRect(x - 1, 0, 2, h);
  }
}

function render(time = video.currentTime) {
  if (!data) return;
  index = frameAtTime(data.frames, time);
  const row = currentRow();
  const selectedPlayer = players().find(p => p.id === selectedId);
  if (data.players?.length) $('player').textContent = `脚部跟随：${labelFor(selectedPlayer)}`;
  $('scrubber').value = index;
  $('scrubber').setAttribute('aria-valuetext', `${row.time.toFixed(3)} 秒，源帧 ${row.frame}`);
  $('videoTime').textContent = `${row.time.toFixed(3)} s`;
  $('elapsed').textContent = (row.time - data.startTime).toFixed(2);
  $('frameNumber').textContent = `帧 ${row.frame}`;
  $('rawPosition').textContent = row.raw ? `${row.raw[0].toFixed(2)}, ${row.raw[1].toFixed(2)} m` : '无可用映射';
  $('refinedPosition').textContent = row.refined ? `${row.refined[0].toFixed(2)}, ${row.refined[1].toFixed(2)} m` : '无去噪前候选';
  $('qwenPosition').textContent = row.qwen ? `${row.qwen[0].toFixed(2)}, ${row.qwen[1].toFixed(2)} m` : '未知 · 保留缺口';
  $('unknownBadge').hidden = !!row.qwen || !enabled('qwen');
  const status = pointSource(row);
  const displacement = Number.isFinite(row.denoiseDisplacement) ? ` · 去噪位移 ${row.denoiseDisplacement.toFixed(2)} m` : '';
  $('frameStatus').textContent = !row.toImage ? '本帧缺少球场标定' : row.unknown ? 'Qwen 将本帧标为未知' : !row.bbox ? '本帧缺少球员检测' : `${status}${displacement}`;
  if(row.qualityFlags?.includes('binding_transition'))$('frameStatus').textContent+=' · 跟踪绑定切换，轨迹断开待核查';
  $('frameStatus').title = [row.qwenState && `模型来源：${row.qwenState}`, row.jobStatus && `任务：${row.jobStatus}`, row.unknown || ''].filter(Boolean).join('\n');
  drawCourt(); drawVideo(); drawCoverage();
}

function seek(frameIndex) {
  if (!data || video.readyState < 1) return;
  video.pause();
  const row = data.frames[Math.max(0, Math.min(data.frames.length - 1, frameIndex))];
  video.currentTime = row.time + 0.00001;
}
function updatePlay() { $('play').textContent = video.paused ? '▶ 播放' : 'Ⅱ 暂停'; }
async function togglePlay() {
  if (!data) return;
  if (!video.paused) { video.pause(); return; }
  if (video.currentTime >= data.frames.at(-1).time || video.currentTime < data.startTime) video.currentTime = data.startTime + 0.00001;
  try { await video.play(); } catch { error('视频暂时无法播放，请点击播放重试。'); }
}
function clock(time) {
  if (!data) return;
  if (time >= data.endTime - 0.000001) {
    if ($('loop').checked && !video.paused) video.currentTime = data.startTime + 0.00001;
    else { video.pause(); video.currentTime = data.frames.at(-1).time + 0.00001; }
    return;
  }
  render(time);
}
if ('requestVideoFrameCallback' in video) {
  const tick = (_now, metadata) => { clock(metadata.mediaTime); video.requestVideoFrameCallback(tick); };
  video.requestVideoFrameCallback(tick);
} else {
  const tick = () => { if (!video.paused) clock(video.currentTime); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}
video.addEventListener('loadedmetadata', () => { if (data) video.currentTime = data.startTime + 0.00001; });
video.addEventListener('loadeddata', () => { $('videoLoading').hidden = true; $('play').disabled = false; });
video.addEventListener('seeked', () => render());
video.addEventListener('pause', updatePlay); video.addEventListener('play', updatePlay);
video.addEventListener('error', () => error('原视频读取失败，请确认两段官方训练视频已下载到本机。'));
video.addEventListener('click', togglePlay);
$('videoOverlay').addEventListener('click', event => {
  if (!data?.players?.length) return togglePlay();
  const box = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - box.left) * data.width / box.width, y = (event.clientY - box.top) * data.height / box.height;
  const hit = visiblePlayers().find(p => { const b = rowsFor(p.id)[index].bbox; return b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; });
  if (hit) { selectedId = hit.id; render(); } else togglePlay();
});
$('play').addEventListener('click', togglePlay);
$('previous').addEventListener('click', () => seek(index - 1));
$('next').addEventListener('click', () => seek(index + 1));
$('restart').addEventListener('click', () => seek(0));
$('scrubber').addEventListener('input', event => seek(Number(event.target.value)));
$('speed').addEventListener('change', () => { video.defaultPlaybackRate = video.playbackRate = Number($('speed').value); });
for (const id of ['showRaw', 'showRefined', 'showQwen', 'showVideoTrail', 'trailLength']) $(id).addEventListener('change', () => render());
$('playerFilter').addEventListener('change', () => {
  if ($('playerFilter').value !== 'all') selectedId = $('playerFilter').value;
  $('scopeTag').textContent = $('playerFilter').value === 'all' ? `${players().length} 人叠加` : '单人';
  render();
 });
for (const id of ['halfCourt', 'fullCourt']) $(id).addEventListener('click', () => {
  fullCourt = id === 'fullCourt'; $('fullCourt').setAttribute('aria-pressed', fullCourt); $('halfCourt').setAttribute('aria-pressed', !fullCourt); render();
});
for (const key of ['raw', 'refined', 'qwen']) $(key + 'Coverage').addEventListener('click', event => {
  if (!data) return;
  const box = event.target.getBoundingClientRect();
  seek(frameAtTime(data.frames, data.startTime + (event.clientX - box.left) / box.width * (data.endTime - data.startTime)));
});
$('court').addEventListener('click', event => {
  if (!data || !courtTransform) return;
  const box = event.target.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
  let distance = 18, nearest = null;
  const end = $('trailLength').value === 'full' ? data.frames.length - 1 : index;
  for (const player of visiblePlayers()) rowsFor(player.id).slice(0, end + 1).forEach((row, i) => {
    for (const key of ['qwen', 'refined', 'raw']) {
      if (!sourceEnabled(key) || !row[key] || ($('trailLength').value === '1.5' && row.time < data.frames[index].time - 1.5)) continue;
      const p = courtTransform(row[key]), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < distance) { distance = d; nearest = i; selectedId = player.id; }
    }
  });
  if (nearest !== null) seek(nearest);
});
document.addEventListener('keydown', event => {
  if (!data || event.target.closest('input,select,button,a')) return;
  if (['Space', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'Space') togglePlay();
  else if (event.code === 'ArrowLeft') seek(index - 1);
  else if (event.code === 'ArrowRight') seek(index + 1);
});
new ResizeObserver(() => { if (data) render(); }).observe($('viewer'));

async function selectSample(sample) {
  const generation = ++loadId;
  video.pause(); data = null; $('viewer').hidden = true; error('');
  try {
    const next = await json('/api/trajectory-replay?sample=' + encodeURIComponent(sample.id));
    if (generation !== loadId) return;
    data = next; index = 0;
    selectedId = players()[0].id;
    views = new Map(players().map(p => [p.id, playerFrames(data, p.id)]));
    const hasMultiple = data.players?.length > 1;
    $('playerFilter').hidden = !hasMultiple;
    $('playerFilter').replaceChildren(new Option('所有球员', 'all'), ...players().map(p => new Option(labelFor(p), p.id)));
    $('playerFilter').value = hasMultiple ? 'all' : (players()[0]?.id ?? '');
    $('showRefinedLabel').hidden = !hasDenoiseComparison(data);
    $('refinedCoverageRow').hidden = !hasDenoiseComparison(data);
    $('refinedPositionCell').hidden = !hasDenoiseComparison(data);
    $('showRefined').checked = false;
    $('showRaw').checked = !hasDenoiseComparison(data);
    $('showQwen').checked = true;
    for (const button of $('samples').children) button.setAttribute('aria-pressed', button.dataset.sample === sample.id);
    $('viewer').hidden = false;
    $('player').textContent = data.player;
    $('videoOverlay').style.pointerEvents = data.players?.length ? 'auto' : 'none';
    $('trailLength').value = data.players?.length ? '1.5' : 'all';
    $('scopeTag').textContent = data.players?.length ? `${data.players.length} 人叠加` : '单人 · 约 5 秒';
    $('colorNote').textContent = data.players?.length ? '橙色代表白队，蓝色代表深蓝队；虚线为原始投影，细点线为去噪前候选，实线为最终结果。点击球员或轨迹可切换脚部跟随。' : '蓝点是原始投影，绿点是 Qwen 地面估计。两者使用当前镜头回投。';
    $('sampleNote').textContent = data.note;
    $('courtSide').textContent = data.side === 'left' ? '左侧半场 / 俯视' : '右侧半场 / 俯视';
    $('scrubber').max = data.frames.length - 1;
    $('startTime').textContent = `${data.startTime.toFixed(3)} s`;
    $('endTime').textContent = `${data.endTime.toFixed(3)} s`;
    $('duration').textContent = `/ ${(data.endTime - data.startTime).toFixed(2)} s`;
    for (const key of ['raw', 'refined', 'qwen']) {
      const { count, total } = availableCounts(data, key);
      $(key + 'Count').textContent = `${count}/${total}`;
    }
    $('checkpoints').replaceChildren(...data.checkpoints.map(checkpoint => {
      const button = document.createElement('button'); button.textContent = checkpoint.label;
      button.title = `跳转到源帧 ${checkpoint.frame}`;
      button.addEventListener('click', () => seek(data.frames.findIndex(row => row.frame === checkpoint.frame)));
      return button;
    }));
    $('videoLoading').hidden = false; $('play').disabled = true;
    video.defaultPlaybackRate = video.playbackRate = Number($('speed').value);
    video.src = '/video.mp4?sample=' + encodeURIComponent(data.id);
    history.replaceState(null, '', '/trajectory-replay?sample=' + encodeURIComponent(data.id));
    render(data.startTime);
  } catch (failure) { if (generation === loadId) error(failure.message); }
}

try {
  const { samples } = await json('/api/trajectory-replay');
  if (!samples.length) throw new Error('暂无实测回放。请先运行实测包里的 export_replay.py，再刷新页面。');
  for (const [i, sample] of samples.entries()) {
    const button = document.createElement('button'); button.className = 'sample'; button.dataset.sample = sample.id;
    const number = document.createElement('b'); number.textContent = String(i + 1).padStart(2, '0');
    const info = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = sample.title; detail.textContent = `${sample.startTime.toFixed(2)}–${sample.endTime.toFixed(2)} s · ${sample.player}`;
    info.append(title, detail);
    const status = document.createElement('span'); status.className = 'sample-status'; status.textContent = sample.status === 'partial' ? '存在缺口' : '待核对';
    button.append(number, info, status); button.addEventListener('click', () => selectSample(sample)); $('samples').append(button);
  }
  const requested = new URLSearchParams(location.search).get('sample');
  await selectSample(samples.find(s => s.id === requested) || samples[0]);
} catch (failure) { error(failure.message); }
