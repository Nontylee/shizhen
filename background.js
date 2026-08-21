importScripts('asset-db.js');

const DEFAULT_FULL_CAPTURE_DELAY = 620;
const MAX_FULL_CAPTURE_SEGMENTS = 180;
const PENDING_CAPTURE_ID = '__pending_capture__';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHIZHEN_PING' });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function presentEditor(tabId) {
  const { shizhenSettings = {} } = await chrome.storage.local.get('shizhenSettings');
  const style = shizhenSettings.editAfterCapture === false ? 'disabled' : (shizhenSettings.collectionStyle || 'popup');
  if (style === 'bottom' || style === 'disabled') {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: style === 'disabled' ? 'SHIZHEN_AUTOSAVE_CAPTURE' : 'SHIZHEN_SHOW_DOCKED_EDITOR'
    });
    return;
  }

  await chrome.windows.create({
    url: chrome.runtime.getURL('editor.html'),
    type: 'popup',
    width: 1180,
    height: 780
  });
}

async function captureVisible(tabId, metadata, rect = null) {
  const tab = await chrome.tabs.get(tabId);
  if (rect) await wait(90);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const capture = {
    kind: rect ? 'crop' : 'single',
    dataUrl,
    rect,
    metadata,
    createdAt: Date.now()
  };
  await globalThis.ShizhenDB.put(PENDING_CAPTURE_ID, capture);
  await chrome.storage.local.set({
    shizhenPendingCaptureRef: { id: PENDING_CAPTURE_ID, createdAt: capture.createdAt },
    shizhenPendingCapture: null
  });
  await presentEditor(tabId);
}

async function startFullCapture(tabId, metadata) {
  await ensureContentScript(tabId);
  const tab = await chrome.tabs.get(tabId);
  const prep = await chrome.tabs.sendMessage(tabId, { type: 'SHIZHEN_PREPARE_FULL' });
  if (!prep?.ok) throw new Error(prep?.error || '无法读取页面尺寸');

  const segments = [];
  // Keep the final dimensions outside the try block: they are needed when the
  // stitched capture record is created after the page scroll state is restored.
  let pageHeight = prep.pageHeight;
  let viewportHeight = prep.viewportHeight;
  try {
    let requestedTop = 0;
    let lastActualTop = -1;
    let completed = false;

    for (let index = 0; index < MAX_FULL_CAPTURE_SEGMENTS; index += 1) {
      const scrollResult = await chrome.tabs.sendMessage(tabId, {
        type: 'SHIZHEN_SCROLL_FULL_TO',
        top: requestedTop
      });
      if (!scrollResult?.ok) throw new Error(scrollResult?.error || '页面滚动失败');

      const actualTop = Math.max(0, scrollResult.scrollTop || 0);
      pageHeight = Math.max(pageHeight, scrollResult.pageHeight || pageHeight);
      viewportHeight = Math.max(1, scrollResult.viewportHeight || viewportHeight);

      await wait(prep.renderDelay || DEFAULT_FULL_CAPTURE_DELAY);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      segments.push({
        y: actualTop,
        dataUrl,
        captureRect: scrollResult.captureRect || prep.captureRect
      });

      const maxTop = Math.max(0, pageHeight - viewportHeight);
      if (actualTop >= maxTop - 1) {
        completed = true;
        break;
      }
      if (actualTop === lastActualTop) throw new Error('页面内容区域无法继续滚动');

      lastActualTop = actualTop;
      requestedTop = Math.min(maxTop, actualTop + viewportHeight);
    }

    if (!completed && segments.length >= MAX_FULL_CAPTURE_SEGMENTS) {
      throw new Error('页面过长，已超过 180 屏的安全限制');
    }
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: 'SHIZHEN_FINISH_FULL' }).catch(() => {});
  }
  const capture = {
    kind: 'full',
    segments,
    pageWidth: prep.pageWidth,
    pageHeight,
    viewportWidth: prep.viewportWidth,
    viewportHeight,
    dpr: prep.dpr,
    scrollMode: prep.scrollMode,
    metadata,
    createdAt: Date.now()
  };
  await globalThis.ShizhenDB.put(PENDING_CAPTURE_ID, capture);
  await chrome.storage.local.set({
    shizhenPendingCaptureRef: { id: PENDING_CAPTURE_ID, createdAt: capture.createdAt },
    shizhenPendingCapture: null
  });
  await presentEditor(tabId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHIZHEN_START_CAPTURE') {
    (async () => {
      const metadata = {
        mode: message.mode,
        destination: message.destination,
        pageTitle: message.pageTitle,
        pageUrl: message.pageUrl
      };
      if (message.mode === 'visible') {
        await captureVisible(message.tabId, metadata);
      } else if (message.mode === 'full') {
        await startFullCapture(message.tabId, metadata);
      } else {
        await ensureContentScript(message.tabId);
        await chrome.tabs.sendMessage(message.tabId, {
          type: message.mode === 'element' ? 'SHIZHEN_SELECT_ELEMENT' : 'SHIZHEN_SELECT_REGION',
          metadata
        });
      }
      return { ok: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'SHIZHEN_CAPTURE_RECT') {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    captureVisible(tabId, message.metadata, message.rect)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'SHIZHEN_OPEN_LIBRARY') {
    chrome.tabs.create({ url: chrome.runtime.getURL('library.html') })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-capture') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !(tab.url?.startsWith('http://') || tab.url?.startsWith('https://'))) return;
  const { shizhenDestination = '产品灵感 / 待整理' } = await chrome.storage.local.get('shizhenDestination');
  await ensureContentScript(tab.id);
  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHIZHEN_SELECT_REGION',
    metadata: {
      mode: 'region',
      destination: shizhenDestination,
      pageTitle: tab.title,
      pageUrl: tab.url
    }
  });
});
