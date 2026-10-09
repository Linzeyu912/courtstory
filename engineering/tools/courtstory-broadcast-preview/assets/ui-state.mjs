// Presentation only. Existing media controls retain their behavior and event handlers.
const video = document.getElementById('video');
const stage = document.getElementById('stageViewport');
const status = document.getElementById('mediaStatus');
const title = document.getElementById('mediaStatusTitle');
const description = document.getElementById('mediaStatusDescription');
let pending;

function show(state) {
  clearTimeout(pending);
  stage.dataset.mediaState = state;
  stage.setAttribute('aria-busy', String(state === 'loading'));
  status.hidden = state === 'ready';
  status.className = `media-status media-status-${state}`;
  if (state === 'error') {
    title.textContent = '视频暂时无法载入';
    description.textContent = '请使用上方「打开视频」重新选择本地素材。';
  } else if (state === 'loading') {
    title.textContent = video.readyState ? '正在缓冲画面' : '正在载入视频';
    description.textContent = '画面准备好后会在这里显示。';
  }
}

function loading() {
  clearTimeout(pending);
  stage.setAttribute('aria-busy', 'true');
  // Keep immediate button feedback, but avoid flashing a skeleton for cached frames.
  pending = setTimeout(() => show(video.error ? 'error' : 'loading'), 160);
}

function ready() {
  if (video.error) show('error');
  else if (video.readyState >= 2) show('ready');
}

for (const event of ['loadstart', 'emptied', 'waiting', 'stalled']) video.addEventListener(event, loading);
for (const event of ['loadeddata', 'canplay', 'playing', 'seeked']) video.addEventListener(event, ready);
video.addEventListener('error', () => show('error'));
addEventListener('pagehide', () => clearTimeout(pending));
addEventListener('pageshow', () => video.readyState >= 2 || video.error ? ready() : loading());
if (video.error) show('error');
else if (video.readyState >= 2) show('ready');
else loading();
