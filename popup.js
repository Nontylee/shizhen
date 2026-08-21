const state = {
  mode: 'element',
  destinationIndex: 0,
  destinations: [],
  tab: null
};

const pageTitle = document.querySelector('#page-title');
const pageHost = document.querySelector('#page-host');
const pageStatus = document.querySelector('#page-status');
const modeHint = document.querySelector('#mode-hint');
const captureButton = document.querySelector('#capture-button');
const feedback = document.querySelector('#feedback');
const settingsToggle = document.querySelector('#settings-toggle');

function setBusy(busy, label = '') {
  captureButton.disabled = busy;
  if (label) captureButton.textContent = label;
}

function showError(message) {
  feedback.textContent = message;
  setBusy(false);
}

function isCapturable(tab) {
  return tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://');
}

async function loadInitialState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  pageTitle.textContent = tab?.title || '当前网页';
  try {
    pageHost.textContent = new URL(tab.url).host;
  } catch {
    pageHost.textContent = '此页面不可截取';
  }
  pageStatus.textContent = isCapturable(tab) ? '当前页面可正常截取' : 'Chrome 内置页面不可截取';
  if (!isCapturable(tab)) captureButton.disabled = true;

  const [saved, destinations] = await Promise.all([
    chrome.storage.local.get(['shizhenSettings', 'shizhenDestination']),
    window.ShizhenFolders.get()
  ]);
  state.destinations = destinations;
  const destination = destinations.includes(saved.shizhenDestination) ? saved.shizhenDestination : destinations[0];
  state.destinationIndex = Math.max(0, destinations.indexOf(destination));
  document.querySelector('#destination-name').textContent = destination;
  if (saved.shizhenDestination !== destination) await chrome.storage.local.set({ shizhenDestination: destination });
}

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.mode-button').forEach((item) => item.classList.toggle('is-selected', item === button));
    state.mode = button.dataset.mode;
    modeHint.textContent = button.dataset.hint;
    captureButton.innerHTML = `${button.dataset.label} <span>⌥ ⇧ S</span>`;
  });
});

document.querySelector('#destination-button').addEventListener('click', async () => {
  if (!state.destinations.length) return showError('请先在素材库中新建文件夹');
  state.destinationIndex = (state.destinationIndex + 1) % state.destinations.length;
  const destination = state.destinations[state.destinationIndex];
  document.querySelector('#destination-name').textContent = destination;
  await chrome.storage.local.set({ shizhenDestination: destination });
});

settingsToggle.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.querySelector('#open-library').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
});

async function requestCapture(mode, delayed = false) {
  if (!isCapturable(state.tab)) return showError('请在普通网页中使用拾帧');
  if (!state.destinations.length) return showError('请先在素材库中新建文件夹');
  feedback.textContent = '';
  setBusy(true, delayed ? '3 秒后开始…' : '正在准备截图…');
  if (delayed) await new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SHIZHEN_START_CAPTURE',
      mode,
      tabId: state.tab.id,
      destination: state.destinations[state.destinationIndex],
      pageTitle: state.tab.title,
      pageUrl: state.tab.url
    });
    if (!response?.ok) throw new Error(response?.error || '无法启动截图');
    window.close();
  } catch (error) {
    showError(error.message || '截图启动失败');
  }
}

captureButton.addEventListener('click', () => requestCapture(state.mode));
document.querySelector('#visible-capture').addEventListener('click', () => requestCapture('visible'));
document.querySelector('#delayed-capture').addEventListener('click', () => requestCapture(state.mode, true));

loadInitialState().catch((error) => showError(error.message || '读取页面失败'));
