import { courtMarkings } from './court-geometry.mjs';
import { frameAtTime, imagePoint, pathSegments } from './trajectory-replay-model.mjs';

const $ = id => document.getElementById(id);
const video = $('video'), colors = { raw: '#63b9ed', qwen: '#c5ee8e' };
const length = 28.6512, width = 15.24;
let data = null, index = 0, fullCourt = false, loadId = 0, courtTransform = null;

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
  for (const key of ['raw', 'qwen']) {
    if (!enabled(key)) continue;
    for (const segment of pathSegments(data.frames, key, end, since)) line(ctx, segment.map(point), colors[key], key === 'qwen' ? 2.6 : 1.7, key === 'raw' ? [4, 3] : []);
    const current = data.frames[index][key];
    if (current) dot(ctx, point(current), colors[key], key === 'qwen' ? 5.5 : 4);
  }
  ctx.restore();
}

function drawVideo() {
  const { ctx, w, h } = surface($('videoOverlay'));
  const row = data.frames[index], sx = w / data.width, sy = h / data.height;
  const point = p => p ? [p[0] * sx, p[1] * sy] : null;
  if (row.bbox) {
    const [x1, y1, x2, y2] = row.bbox, x = x1 * sx, y = y1 * sy, bw = (x2 - x1) * sx, bh = (y2 - y1) * sy;
    const corner = Math.min(12, bw / 3);
    for (const [x, y, dx, dy] of [[x1 * sx, y1 * sy, 1, 1], [x2 * sx, y1 * sy, -1, 1], [x1 * sx, y2 * sy, 1, -1], [x2 * sx, y2 * sy, -1, -1]])
      line(ctx, [[x, y + dy * corner], [x, y], [x + dx * corner, y]], '#f5f2dc', 1.5);
    ctx.fillStyle = '#10191ccc'; ctx.fillRect(x, Math.max(0, y - 21), Math.max(53, bw), 17);
    text(ctx, `${data.entityId} · 目标`, x + 5, Math.max(12, y - 9), '#f5f2dc', 10);
  }
  for (const key of ['raw', 'qwen']) {
    if (!enabled(key)) continue;
    // Reproject every historical ground point through this frame's camera mapping.
    if ($('showVideoTrail').checked && row.toImage)
      for (const segment of pathSegments(data.frames, key, index, row.time - 1.5))
        line(ctx, segment.map(p => point(imagePoint(row.toImage, p))), colors[key] + 'c9', key === 'raw' ? 1.4 : 2, key === 'raw' ? [4, 3] : []);
    dot(ctx, point(imagePoint(row.toImage, row[key])), colors[key], key === 'raw' ? 3.7 : 4.6);
  }
  drawZoom(row);
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
  for (const key of ['raw', 'qwen']) {
    if (!enabled(key)) continue;
    const p = imagePoint(row.toImage, row[key]);
    if (p) dot(ctx, [(p[0] - x) * w / cropWidth, (p[1] - y) * h / cropHeight], colors[key], 4);
  }
}

function drawCoverage() {
  for (const key of ['raw', 'qwen']) {
    const { ctx, w, h } = surface($(key + 'Coverage'));
    const duration = data.endTime - data.startTime;
    data.frames.forEach((row, i) => {
      const start = (row.time - data.startTime) / duration * w;
      const end = ((data.frames[i + 1]?.time ?? data.endTime) - data.startTime) / duration * w;
      ctx.fillStyle = row[key] ? colors[key] + '85' : '#c68d58'; ctx.fillRect(start, 0, Math.max(1, end - start), h);
    });
    const x = (data.frames[index].time - data.startTime) / duration * w;
    ctx.fillStyle = '#fafce9'; ctx.fillRect(x - 1, 0, 2, h);
  }
}

function render(time = video.currentTime) {
  if (!data) return;
  index = frameAtTime(data.frames, time);
  const row = data.frames[index];
  $('scrubber').value = index;
  $('scrubber').setAttribute('aria-valuetext', `${row.time.toFixed(3)} 秒，源帧 ${row.frame}`);
  $('videoTime').textContent = `${row.time.toFixed(3)} s`;
  $('elapsed').textContent = (row.time - data.startTime).toFixed(2);
  $('frameNumber').textContent = `帧 ${row.frame}`;
  $('rawPosition').textContent = row.raw ? `${row.raw[0].toFixed(2)}, ${row.raw[1].toFixed(2)} m` : '无可用映射';
  $('qwenPosition').textContent = row.qwen ? `${row.qwen[0].toFixed(2)}, ${row.qwen[1].toFixed(2)} m` : '未知 · 保留缺口';
  $('unknownBadge').hidden = !!row.qwen || !enabled('qwen');
  $('frameStatus').textContent = !row.toImage ? '本帧缺少球场标定' : row.unknown ? 'Qwen 将本帧标为未知' : !row.bbox ? '本帧缺少球员检测' : '对比脚部与地面估计';
  $('frameStatus').title = row.unknown || '';
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
$('play').addEventListener('click', togglePlay);
$('previous').addEventListener('click', () => seek(index - 1));
$('next').addEventListener('click', () => seek(index + 1));
$('restart').addEventListener('click', () => seek(0));
$('scrubber').addEventListener('input', event => seek(Number(event.target.value)));
$('speed').addEventListener('change', () => { video.playbackRate = Number($('speed').value); });
for (const id of ['showRaw', 'showQwen', 'showVideoTrail', 'trailLength']) $(id).addEventListener('change', () => render());
for (const id of ['halfCourt', 'fullCourt']) $(id).addEventListener('click', () => {
  fullCourt = id === 'fullCourt'; $('fullCourt').setAttribute('aria-pressed', fullCourt); $('halfCourt').setAttribute('aria-pressed', !fullCourt); render();
});
for (const key of ['raw', 'qwen']) $(key + 'Coverage').addEventListener('click', event => {
  if (!data) return;
  const box = event.target.getBoundingClientRect();
  seek(frameAtTime(data.frames, data.startTime + (event.clientX - box.left) / box.width * (data.endTime - data.startTime)));
});
$('court').addEventListener('click', event => {
  if (!data || !courtTransform) return;
  const box = event.target.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
  let distance = 18, nearest = null;
  const end = $('trailLength').value === 'full' ? data.frames.length - 1 : index;
  data.frames.slice(0, end + 1).forEach((row, i) => {
    for (const key of ['qwen', 'raw']) {
      if (!enabled(key) || !row[key] || ($('trailLength').value === '1.5' && row.time < data.frames[index].time - 1.5)) continue;
      const p = courtTransform(row[key]), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < distance) { distance = d; nearest = i; }
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
    for (const button of $('samples').children) button.setAttribute('aria-pressed', button.dataset.sample === sample.id);
    $('viewer').hidden = false;
    $('player').textContent = data.player;
    $('sampleNote').textContent = data.note;
    $('courtSide').textContent = data.side === 'left' ? '左侧半场 / 俯视' : '右侧半场 / 俯视';
    $('scrubber').max = data.frames.length - 1;
    $('startTime').textContent = `${data.startTime.toFixed(3)} s`;
    $('endTime').textContent = `${data.endTime.toFixed(3)} s`;
    $('duration').textContent = `/ ${(data.endTime - data.startTime).toFixed(2)} s`;
    for (const key of ['raw', 'qwen']) $(key + 'Count').textContent = `${data.counts[key]}/${data.counts.total}`;
    $('checkpoints').replaceChildren(...data.checkpoints.map(checkpoint => {
      const button = document.createElement('button'); button.textContent = checkpoint.label;
      button.title = `跳转到源帧 ${checkpoint.frame}`;
      button.addEventListener('click', () => seek(data.frames.findIndex(row => row.frame === checkpoint.frame)));
      return button;
    }));
    $('videoLoading').hidden = false; $('play').disabled = true;
    video.src = '/video.mp4?sample=' + encodeURIComponent(data.id);
    video.playbackRate = Number($('speed').value);
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
