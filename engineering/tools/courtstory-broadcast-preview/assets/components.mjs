const toast = document.getElementById('componentToast');
let timer;
function show(text) {
  clearTimeout(timer);
  toast.querySelector('span').textContent = text;
  toast.classList.add('visible');
  timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}
document.getElementById('demoPrimary').addEventListener('click', () => show('主操作反馈示例'));
document.getElementById('demoSecondary').addEventListener('click', () => show('次要操作反馈示例'));
document.querySelectorAll('.choice').forEach(button => button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('.choice')) {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
    item.querySelector('.choice-mark').textContent = selected ? '✓' : '';
  }
}));
