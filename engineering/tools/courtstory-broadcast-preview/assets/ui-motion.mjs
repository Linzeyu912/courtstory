// Only the presentation changes. Native dialog modality and focus restoration remain intact.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const animations = new WeakMap();
const closing = new WeakSet();
const initialized = new WeakSet();
const active = new Set();

function cancel(dialog) {
  animations.get(dialog)?.cancel();
  animations.delete(dialog);
}
function motion(dialog, entering, complete) {
  cancel(dialog);
  const duration = parseFloat(getComputedStyle(dialog).getPropertyValue(entering ? '--motion-enter' : '--motion-exit')) || 0;
  if (reducedMotion.matches || !dialog.animate || !duration) { complete(); return; }
  const frames = [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }];
  if (!entering) frames.reverse();
  const animation = dialog.animate(frames, { duration, easing: 'ease-out' });
  animations.set(dialog, animation);
  animation.finished.then(() => {
    if (animations.get(dialog) === animation) { animations.delete(dialog); complete(); }
  }).catch(() => {});
}
export function openDialog(dialog, trigger) {
  if (!initialized.has(dialog)) {
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener('close', () => { if (!dialog.open) { cancel(dialog); active.delete(dialog); closing.delete(dialog); } });
    initialized.add(dialog);
  }
  if (dialog.open && !closing.has(dialog)) return;
  closing.delete(dialog);
  if (!dialog.open) dialog.showModal();
  active.add(dialog);
  motion(dialog, true, () => {});
}
export function closeDialog(dialog) {
  if (!dialog.open || closing.has(dialog)) return;
  closing.add(dialog);
  motion(dialog, false, () => { closing.delete(dialog); if (dialog.open) dialog.close(); });
}
reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  for (const dialog of active) {
    cancel(dialog);
    if (closing.has(dialog)) { closing.delete(dialog); dialog.close(); }
  }
});
