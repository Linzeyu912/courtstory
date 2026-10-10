// Layout and navigation only. Video time, selections and review data stay in app.mjs.
import {entityLabel} from './trajectory.mjs';
export function mountIdentityShortcuts({openIdentity,document:doc=globalThis.document,schedule=globalThis.requestAnimationFrame}) {
  function open(kind) {
    openIdentity();
    if(doc.body.dataset.step!=='identity')return;
    const profile=doc.getElementById('playerProfilePanel');
    if(kind==='profile')profile.open=true;
    schedule(()=>{
      const target=kind==='profile'?profile:doc.querySelector('.identity-agent-panel');
      if(!target)return;
      for(let parent=target.closest?.('details');parent;parent=parent.parentElement?.closest?.('details'))parent.open=true;
      target.scrollIntoView({block:'start'});
      const focus=kind==='profile'?doc.getElementById('profileSummary'):target.querySelector('[aria-label="身份参考人物"]');
      focus?.focus({preventScroll:true});
    });
  }
  const profile=doc.getElementById('openIdentityProfile'),continuation=doc.getElementById('openIdentityContinuation');
  if(profile)profile.onclick=()=>open('profile');
  if(continuation)continuation.onclick=()=>open('continuation');
}
export function mountWorkbenchShell(api) {
  const $ = id => document.getElementById(id);
  const body = document.body;
  const content = $('workbenchContent');
  const videoCard = document.querySelector('.video-card');
  const timeline = document.querySelector('.shared-timeline');
  const timelineHome = timeline?.parentElement;
  const titles = {video:'① 球员标定', tactics:'② 战术制作', production:'③ 成片'};
  let area = 'video', layoutFrame = 0, entitySignature = '';

  function renderLayout() {
    body.dataset.area = area;
    body.dataset.drawer = 'closed';
    // Keep playback next to the video while the long tool panel uses page scroll.
    const timelineTarget = area === 'video' ? videoCard : timelineHome;
    if (timeline && timelineTarget && timeline.parentElement !== timelineTarget) timelineTarget.append(timeline);
    $('areaTitle').textContent = titles[area];
    document.querySelectorAll('[data-area-target]').forEach(button => {
      if (button.dataset.areaTarget === area) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const future = area === 'production';
    $('futurePanel').hidden = !future;
    $('tacticsPanel').hidden = area !== 'tactics';
    if (future) {
      $('deliveryVideo').href = `/video.mp4?sample=${encodeURIComponent(api.sample)}`;
      $('deliveryVideo').download = `${api.sample}.mp4`;
      $('deliveryContext').textContent = `来源素材：${api.clip.frames.length} 帧 · ${api.clip.width} × ${api.clip.height} · ${api.variant}。冻结讲解会增加成片时长。`;
    }
    if (future) {
      $('futureTitle').textContent = titles[area];
      $('futureDescription').textContent = '可生成包含解说、配音、字幕与战术图形的联合视频，也可单独导出静音战术画面。';
    }
    scheduleLayout();
    document.dispatchEvent(new CustomEvent('workbench-area',{detail:{area}}));
  }

  function showArea(next) {
    $('sourceDetails').open = false;
    // Old saved actions can still request data; continue in the current editor.
    area = next === 'data' ? 'tactics' : next;
    if(area==='video')setTools(true);
    renderLayout();
  }

  function enterVideo() {
    area = 'video';
    $('sourceDetails').open = false;
    setTools(true);
    renderLayout();
  }

  document.querySelectorAll('[data-area-target]').forEach(button => {
    button.addEventListener('click', () => showArea(button.dataset.areaTarget));
  });
  $('backToVideo').onclick = () => showArea('video');
  $('deliveryTactics').onclick = () => {
    showArea('tactics');
    document.dispatchEvent(new CustomEvent('workbench-drawing'));
  };
  $('deliveryCommentary').onclick = () => {
    showArea('tactics');
    document.dispatchEvent(new CustomEvent('workbench-commentary'));
  };
  function setTools(expanded) {
    body.dataset.tools = expanded ? 'expanded' : 'collapsed';
    $('toolsToggle').setAttribute('aria-expanded', String(expanded));
    $('toolsToggle').textContent = expanded ? '收起工具' : '展开工具';
    $('toolsToggle').title = expanded ? '收起操作工具' : '展开操作工具';
    scheduleLayout();
  }
  $('toolsToggle').onclick = () => setTools(body.dataset.tools !== 'expanded');
  mountIdentityShortcuts({openIdentity:api.openIdentity});
  $('infoToggle').onclick = () => {
    const visible=getComputedStyle($('videoInfo')).display!=='none';
    body.dataset.info=visible?'closed':'open';
    $('infoToggle').setAttribute('aria-expanded',String(!visible));
    scheduleLayout();
  };
  $('reviewEntity').onchange = event => api.select(event.target.value);
  const objectSelection = new MutationObserver(() => {
    if (!$('sceneObjectEditor').hidden) $('sceneObjectPanel').open = true;
  });
  objectSelection.observe($('sceneObjectEditor'), {attributes:true, attributeFilter:['hidden']});

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if ($('sourceDetails').open) {
      $('sourceDetails').open = false;
      $('sourceDetails').querySelector('summary').focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!$('sourceDetails').contains(event.target)) $('sourceDetails').open = false;
  });

  // The overlay and video share the exact same rectangle.
  function fitVideo() {
    if (!videoCard.clientWidth || !videoCard.clientHeight) return;
    const stage = $('stage'), style = getComputedStyle(videoCard);
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const siblings = [...videoCard.children].filter(child => child !== stage && getComputedStyle(child).display !== 'none');
    const otherHeight = siblings.reduce((total, child) => {
      const css = getComputedStyle(child);
      return total + child.getBoundingClientRect().height + parseFloat(css.marginTop) + parseFloat(css.marginBottom);
    }, 0);
    const available = style.getPropertyValue('--video-fit').trim() === 'width'
      ? Math.max(0, (videoCard.clientWidth - paddingX) / (api.clip.width / api.clip.height))
      : Math.max(0, videoCard.clientHeight - paddingY - otherHeight);
    const ratio = api.clip.width / api.clip.height;
    const width = Math.max(0, Math.min(videoCard.clientWidth - paddingX, available * ratio));
    const w = `${Math.floor(width * 10) / 10}px`, h = `${Math.floor(width / ratio * 10) / 10}px`;
    if (stage.style.width !== w) stage.style.width = w;
    if (stage.style.height !== h) stage.style.height = h;
  }
  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if($('videoInfo'))$('infoToggle').setAttribute('aria-expanded',String(getComputedStyle($('videoInfo')).display!=='none'));
      fitVideo();
      api.redraw();
    });
  }
  const resize = new ResizeObserver(scheduleLayout);
  [content, videoCard, $('court'), document.querySelector('.shared-timeline'), ...videoCard.children].forEach(element => {
    if (element.id !== 'stage') resize.observe(element);
  });
  $('dataDetails').addEventListener('toggle', scheduleLayout);

  function refresh() {
    const s = api.getState();
    const signature = s.session.entities.map(entity => `${entity.id}:${entity.name}:${entity.role}`).join('|');
    if (entitySignature !== signature) {
      entitySignature = signature;
      $('reviewEntity').replaceChildren(...s.session.entities.map(entity => {
        const option = document.createElement('option');
        option.value = entity.id;
        option.textContent = entity.name===entityLabel(entity.id)?entity.name:`${entityLabel(entity.id)} · ${entity.name}`;
        return option;
      }));
    }
    $('reviewEntity').value = s.active;
    $('drawerContext').textContent = `${entityLabel(s.active)} · 第 ${s.frame + 1} 帧 · 与原视频同步`;
    $('pointStatus').title = $('pointStatus').textContent;
  }
  renderLayout();
  refresh();
  return {enterVideo, refresh, showArea, openData:() => {}, scheduleLayout};
}
