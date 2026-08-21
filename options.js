const defaults = {
  theme: 'system',
  language: 'browser',
  collectionStyle: 'popup',
  editAfterCapture: true,
  browserDownload: true,
  copyAfterCapture: true,
  format: 'png'
};

let settings = { ...defaults };
let feedbackTimer;

function showSaved() {
  const feedback = document.querySelector('#save-feedback');
  feedback.textContent = '设置已保存';
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 1400);
}

function render() {
  document.querySelectorAll('[data-setting="theme"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.value === settings.theme));
  });
  document.querySelectorAll('[data-setting="collectionStyle"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.value === settings.collectionStyle));
  });
  document.querySelector('#language').value = settings.language;
  document.querySelector('#edit-after-capture').checked = settings.editAfterCapture;
  document.querySelector('#browser-download').checked = settings.browserDownload;
  document.querySelector('#copy-after-capture').checked = settings.copyAfterCapture;
  document.querySelector('#image-format').value = settings.format;
  document.documentElement.dataset.theme = settings.theme;
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ shizhenSettings: settings });
  render();
  showSaved();
}

document.querySelectorAll('.choice-card').forEach((button) => {
  button.addEventListener('click', () => save({ [button.dataset.setting]: button.dataset.value }));
});

document.querySelector('#edit-after-capture').addEventListener('change', (event) => save({ editAfterCapture: event.target.checked }));
document.querySelector('#browser-download').addEventListener('change', (event) => save({ browserDownload: event.target.checked }));
document.querySelector('#copy-after-capture').addEventListener('change', (event) => save({ copyAfterCapture: event.target.checked }));
document.querySelector('#image-format').addEventListener('change', (event) => save({ format: event.target.value }));
document.querySelector('#language').addEventListener('change', (event) => save({ language: event.target.value }));
document.querySelector('#back-button').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});

chrome.storage.local.get('shizhenSettings').then(({ shizhenSettings = {} }) => {
  settings = { ...defaults, ...shizhenSettings };
  render();
});
