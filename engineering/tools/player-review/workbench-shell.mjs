// Layout and navigation only. Video time, selections and review data stay in app.mjs.
import {entityLabel} from './trajectory.mjs';
export function mountWorkbenchShell(api) {
  const $ = id => document.getElementById(id);
  const body = document.body;
  const content = $('workbenchContent');
  const drawer = $('dataDrawer');
  const handle = $('drawerResize');
  const videoCard = document.querySelector('.video-card');
  const titles = {video:'视频处理', data:'数据核对与处理', tactics:'战术分析与讲解', production:'剪辑与成片'};
  let area = 'video', drawerState = 'closed', returnArea = 'video', halfRatio = .45;
  let videoStep = null;
  let drag = null, layoutFrame = 0, entitySignature = '';

  function renderLayout() {
    body.dataset.area = area;
    body.dataset.drawer = drawerState;
    content.style.setProperty('--drawer-height', `${halfRatio * 100}%`);
    $('areaTitle').textContent = titles[area];
    document.querySelectorAll('[data-area-target]').forEach(button => {
      if (button.dataset.areaTarget === area) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const future = area === 'tactics' || area === 'production';
    $('futurePanel').hidden = !future;
    if (future) {
      $('futureTitle').textContent = titles[area];
      $('futureDescription').textContent = area === 'tactics'
        ? '在完成位置与轨迹核对后，分析场上关系，整理战术判断和讲解。'
        : '组织视频片段、讲解、画面叠加与字幕，预览并导出成片。';
    }
    const open = drawerState !== 'closed';
    $('drawerBody').hidden = !open;
    $('drawerToggle').setAttribute('aria-expanded', String(open));
    $('drawerToggle').setAttribute('aria-label', open ? '收起数据核对' : '打开数据核对');
    $('drawerClose').hidden = !open;
    $('drawerHalf').setAttribute('aria-pressed', String(drawerState === 'half'));
    $('drawerFull').setAttribute('aria-pressed', String(drawerState === 'full'));
    handle.setAttribute('aria-valuenow', String(drawerState === 'closed' ? 0 : drawerState === 'full' ? 100 : Math.round(halfRatio * 100)));
    handle.setAttribute('aria-valuetext', drawerState === 'closed' ? '已收起' : drawerState === 'full' ? '完整数据工作区' : '视频与数据同时可见');
    scheduleLayout();
  }

  function setDrawer(next, restoreFocus = false) {
    if (next === 'full') {
      if (area !== 'data') returnArea = area;
      area = 'data';
    } else if (next === 'half') {
      area = 'video';
      returnArea = 'video';
    } else if (area === 'data') area = returnArea;
    drawerState = next;
    if (next === 'closed' && (restoreFocus || $('drawerBody').contains(document.activeElement))) $('drawerToggle').focus();
    renderLayout();
  }

  function showArea(next) {
    $('sourceDetails').open = false;
    if (next === 'data') setDrawer('full');
    else {
      area = next;
      returnArea = next;
      drawerState = 'closed';
      renderLayout();
    }
  }

  function enterVideo(step) {
    const changedStep = step !== videoStep;
    const drawerHadFocus = $('drawerBody').contains(document.activeElement);
    videoStep = step;
    area = 'video';
    returnArea = 'video';
    // A preview belongs to the current step; tab navigation starts a fresh layout.
    if (changedStep) drawerState = step === 'calibration' ? 'half' : 'closed';
    else if (drawerState === 'full') drawerState = 'half';
    $('sourceDetails').open = false;
    body.dataset.tools = 'expanded';
    $('toolsToggle').setAttribute('aria-expanded', 'true');
    $('toolsToggle').textContent = '收起工具';
    $('toolsToggle').title = '收起操作工具';
    renderLayout();
    if (drawerState === 'closed' && drawerHadFocus) $(`tab-${step}`)?.focus({preventScroll:true});
  }

  document.querySelectorAll('[data-area-target]').forEach(button => {
    button.addEventListener('click', () => showArea(button.dataset.areaTarget));
  });
  $('backToVideo').onclick = () => showArea('video');
  $('drawerToggle').onclick = () => setDrawer(drawerState === 'closed' ? 'half' : 'closed');
  $('drawerHalf').onclick = () => setDrawer('half');
  $('drawerFull').onclick = () => setDrawer('full');
  $('drawerClose').onclick = () => setDrawer('closed', true);
  $('toolsToggle').onclick = () => {
    const expanded = body.dataset.tools !== 'expanded';
    body.dataset.tools = expanded ? 'expanded' : 'collapsed';
    $('toolsToggle').setAttribute('aria-expanded', String(expanded));
    $('toolsToggle').textContent = expanded ? '收起工具' : '展开工具';
    $('toolsToggle').title = expanded ? '收起操作工具' : '展开操作工具';
    scheduleLayout();
  };
  $('reviewEntity').onchange = event => api.select(event.target.value);
  const objectSelection = new MutationObserver(() => {
    if (!$('sceneObjectEditor').hidden) $('sceneObjectPanel').open = true;
  });
  objectSelection.observe($('sceneObjectEditor'), {attributes:true, attributeFilter:['hidden']});

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {id:event.pointerId, y:event.clientY, height:drawer.getBoundingClientRect().height, moved:false, state:drawerState, area, returnArea, ratio:halfRatio};
    handle.setPointerCapture(event.pointerId);
    handle.focus();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) < 4 && !drag.moved) return;
    drag.moved = true;
    const ratio = (drag.height + delta) / content.clientHeight;
    area = 'video';
    drawerState = 'half';
    halfRatio = Math.max(.12, Math.min(.97, ratio));
    body.classList.add('drawer-dragging');
    renderLayout();
  });
  function endDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.id) return;
    const previous = drag;
    drag = null;
    body.classList.remove('drawer-dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (cancelled) {
      area = previous.area;
      returnArea = previous.returnArea;
      drawerState = previous.state;
      halfRatio = previous.ratio;
      renderLayout();
    } else if (!previous.moved) setDrawer(previous.state === 'closed' ? 'half' : 'closed');
    else {
      const next = halfRatio < .22 ? 'closed' : halfRatio > .8 ? 'full' : 'half';
      halfRatio = next === 'half' ? Math.max(.3, Math.min(.68, halfRatio)) : previous.ratio;
      setDrawer(next);
    }
  }
  handle.addEventListener('pointerup', event => endDrag(event));
  handle.addEventListener('pointercancel', event => endDrag(event, true));
  handle.addEventListener('keydown', event => {
    if (!['ArrowUp','ArrowDown','Home','End','Enter',' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') setDrawer('closed');
    else if (event.key === 'End') setDrawer('full');
    else if (event.key === 'ArrowUp') setDrawer(drawerState === 'closed' ? 'half' : 'full');
    else if (event.key === 'ArrowDown') setDrawer(drawerState === 'full' ? 'half' : 'closed');
    else setDrawer(drawerState === 'closed' ? 'half' : 'closed');
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if ($('sourceDetails').open) {
      $('sourceDetails').open = false;
      $('sourceDetails').querySelector('summary').focus();
    } else if (drawerState !== 'closed') setDrawer('closed', true);
  });
  document.addEventListener('pointerdown', event => {
    if (!$('sourceDetails').contains(event.target)) $('sourceDetails').open = false;
  });

  // The overlay and video share the exact same rectangle, including in half view.
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
    const available = Math.max(0, videoCard.clientHeight - paddingY - otherHeight);
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
    $('drawerContext').textContent = `${entityLabel(s.active)} · 第 ${s.frame + 1} 帧 · 2D 球场与轨迹`;
    $('pointStatus').title = $('pointStatus').textContent;
  }
  renderLayout();
  refresh();
  return {enterVideo, refresh, openData:() => setDrawer('half'), scheduleLayout};
}
