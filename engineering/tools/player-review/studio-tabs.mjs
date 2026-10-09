// Follow the real selected state; hovering never changes workflow or selection.
export function mountNavigationUnderline(container) {
  const view = container?.ownerDocument?.defaultView;
  if (!view?.ResizeObserver || !view?.MutationObserver || container.dataset.inkNav) return;
  container.dataset.inkNav = 'true';
  container.classList.add('ink-nav');
  let frame = 0, disposed = false, selectedButton = null, lastX = '', lastWidth = '';
  function measure() {
    frame = 0;
    if (disposed) return;
    const active = container.querySelector('button[aria-current="page"], button[aria-selected="true"]');
    if (!active || !container.clientWidth || !active.getClientRects().length) {
      container.dataset.inkReady = 'false';
      container.dataset.inkAnimate = 'false';
      selectedButton = null;
      return;
    }
    const parent = container.getBoundingClientRect(), selected = active.getBoundingClientRect();
    // Ignore repeated renders and subpixel noise. Layout changes snap into place;
    // only an actual selection change should animate the persistent marker.
    const x = `${Math.round((selected.left - parent.left + container.scrollLeft - container.clientLeft) * 100) / 100}px`;
    const width = `${Math.round(selected.width * 100) / 100}px`;
    if (active === selectedButton && x === lastX && width === lastWidth) return;
    container.dataset.inkAnimate = String(selectedButton !== null && active !== selectedButton);
    if (x !== lastX) container.style.setProperty('--ink-x', x);
    if (width !== lastWidth) container.style.setProperty('--ink-width', width);
    selectedButton = active;
    lastX = x;
    lastWidth = width;
    container.dataset.inkReady = 'true';
  }
  function schedule() {
    if (!disposed && !frame) frame = view.requestAnimationFrame(measure);
  }
  const resize = new view.ResizeObserver(schedule);
  resize.observe(container);
  container.querySelectorAll('button').forEach(button => resize.observe(button));
  const state = new view.MutationObserver(schedule);
  state.observe(container, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'hidden']});
  container.addEventListener('scroll', schedule, {passive: true});
  container.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
  container.ownerDocument.fonts?.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    view.cancelAnimationFrame(frame);
    resize.disconnect();
    state.disconnect();
    container.removeEventListener('scroll', schedule);
    container.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
    container.classList.remove('ink-nav');
    delete container.dataset.inkNav;
    delete container.dataset.inkReady;
    delete container.dataset.inkAnimate;
  };
}

// Switch presentation panels without remounting editors or discarding drafts.
export function mountStudioTabs(entries, {onChange = () => {}} = {}) {
  const tabs = entries.map(entry => entry.tab);
  const panelFor = tab => entries.find(entry => entry.tab === tab).panel;
  let selected = tabs[0];
  function select(tab, focus = false) {
    if (!tabs.includes(tab)) return;
    const previous = selected;
    selected = tab;
    for (const item of tabs) {
      const active = item === selected;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      panelFor(item).hidden = !active;
    }
    if (focus) tab.focus();
    if (previous !== tab) onChange(panelFor(tab).id, previous && panelFor(previous).id);
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[index], true);
    });
  }
  if (selected) select(selected);
  mountNavigationUnderline(tabs[0]?.parentElement);
  return { current: () => selected && panelFor(selected).id, select: id => select(tabs.find(tab => tab.id === id)) };
}
