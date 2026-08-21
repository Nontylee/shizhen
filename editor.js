const MAX_CANVAS_HEIGHT = 30000;
const MAX_CANVAS_AREA = 100000000;
const PENDING_CAPTURE_ID = '__pending_capture__';

const canvas = document.querySelector('#editor-canvas');
let context = canvas.getContext('2d', { willReadFrequently: true });
const canvasWrap = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const overlay = document.querySelector('#selection-overlay');
const editorTip = document.querySelector('#editor-tip');
const saveStatus = document.querySelector('#save-status');
const history = [];
const query = new URLSearchParams(location.search);
const isEmbedded = query.get('embedded') === '1' || window.parent !== window;
const forceAutosave = query.get('autosave') === '1';
let pending = null;
let activeTool = 'rectangle';
let dragStart = null;
let selection = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图图片加载失败'));
    image.src = src;
  });
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
  };
}

function normalizedRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

function updateOverlay(rect) {
  const canvasRect = canvas.getBoundingClientRect();
  overlay.hidden = false;
  overlay.style.left = `${rect.x / canvas.width * canvasRect.width}px`;
  overlay.style.top = `${rect.y / canvas.height * canvasRect.height}px`;
  overlay.style.width = `${rect.width / canvas.width * canvasRect.width}px`;
  overlay.style.height = `${rect.height / canvas.height * canvasRect.height}px`;
}

function snapshot() {
  if (canvas.width * canvas.height > 25000000) {
    history.length = 0;
    return;
  }
  history.push(canvas.toDataURL('image/png'));
  if (history.length > 12) history.shift();
}

async function restore(dataUrl) {
  const image = await loadImage(dataUrl);
  canvas.width = image.width;
  canvas.height = image.height;
  context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
}

function pixelate(rect) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(canvas.width - x, Math.floor(rect.width)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.floor(rect.height)));
  const scale = Math.max(8, Math.round(Math.min(width, height) / 18));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.ceil(width / scale));
  small.height = Math.max(1, Math.ceil(height / scale));
  const smallContext = small.getContext('2d');
  smallContext.imageSmoothingEnabled = false;
  smallContext.drawImage(canvas, x, y, width, height, 0, 0, small.width, small.height);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
  context.restore();
}

async function cropCanvas(rect) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(canvas.width - x, Math.floor(rect.width)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.floor(rect.height)));
  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  temp.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  await restore(temp.toDataURL('image/png'));
}

async function applySelection(rect) {
  if (rect.width < 4 || rect.height < 4) return;
  snapshot();
  if (activeTool === 'rectangle') {
    context.save();
    context.strokeStyle = '#e55642';
    context.lineWidth = Math.max(3, Math.round(canvas.width / 500));
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.restore();
  } else if (activeTool === 'blur') {
    pixelate(rect);
  } else if (activeTool === 'crop') {
    await cropCanvas(rect);
  } else if (activeTool === 'text') {
    const text = prompt('输入标注文字');
    if (!text) {
      history.pop();
      return;
    }
    context.save();
    const size = Math.max(18, Math.round(canvas.width / 32));
    context.font = `600 ${size}px -apple-system, sans-serif`;
    const padding = Math.round(size * .35);
    const metrics = context.measureText(text);
    context.fillStyle = '#e55642';
    context.fillRect(rect.x, rect.y, metrics.width + padding * 2, size + padding * 2);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'top';
    context.fillText(text, rect.x + padding, rect.y + padding);
    context.restore();
  }
}

canvas.addEventListener('pointerdown', (event) => {
  dragStart = getCanvasPoint(event);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  selection = normalizedRect(dragStart, getCanvasPoint(event));
  updateOverlay(selection);
});

canvas.addEventListener('pointerup', async (event) => {
  if (!dragStart) return;
  selection = normalizedRect(dragStart, getCanvasPoint(event));
  dragStart = null;
  overlay.hidden = true;
  await applySelection(selection);
});

document.querySelectorAll('.tool-button[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tool-button[data-tool]').forEach((item) => item.classList.toggle('is-selected', item === button));
    activeTool = button.dataset.tool;
    const tips = {
      rectangle: '拖动鼠标添加标注框',
      text: '拖动确定文字位置和宽度',
      blur: '拖动选择需要模糊的区域',
      crop: '拖动保留需要的画面区域'
    };
    editorTip.textContent = tips[activeTool];
  });
});

document.querySelector('#undo-button').addEventListener('click', async () => {
  const previous = history.pop();
  if (previous) await restore(previous);
});

async function buildCanvas(capture) {
  if (capture.kind === 'full') {
    const width = Math.max(1, Math.round(capture.viewportWidth * capture.dpr));
    const wantedHeight = Math.max(1, Math.round(capture.pageHeight * capture.dpr));
    const height = Math.min(wantedHeight, MAX_CANVAS_HEIGHT, Math.floor(MAX_CANVAS_AREA / width));
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d', { willReadFrequently: true });
    for (const segment of capture.segments) {
      const image = await loadImage(segment.dataUrl);
      const y = Math.round(segment.y * capture.dpr);
      if (y >= height) continue;
      const rect = segment.captureRect || { x: 0, y: 0, width: capture.viewportWidth, height: capture.viewportHeight };
      const sourceX = Math.max(0, Math.round(rect.x * capture.dpr));
      const sourceY = Math.max(0, Math.round(rect.y * capture.dpr));
      const sourceWidth = Math.max(1, Math.min(image.width - sourceX, Math.round(rect.width * capture.dpr)));
      const sourceHeight = Math.max(1, Math.min(image.height - sourceY, Math.round(rect.height * capture.dpr)));
      const drawHeight = Math.min(sourceHeight, height - y);
      context.drawImage(image, sourceX, sourceY, sourceWidth, drawHeight, 0, y, width, drawHeight);
    }
    return;
  }

  const image = await loadImage(capture.dataUrl);
  if (capture.kind === 'crop' && capture.rect) {
    const dpr = capture.rect.dpr || image.width / window.innerWidth || 1;
    const x = Math.max(0, Math.round(capture.rect.x * dpr));
    const y = Math.max(0, Math.round(capture.rect.y * dpr));
    const width = Math.max(1, Math.min(image.width - x, Math.round(capture.rect.width * dpr)));
    const height = Math.max(1, Math.min(image.height - y, Math.round(capture.rect.height * dpr)));
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
  } else {
    canvas.width = image.width;
    canvas.height = image.height;
    context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
  }
}

function fileExtension(format) {
  return format === 'jpeg' ? 'jpg' : 'png';
}

function sanitizedFilename(value) {
  return (value || '拾帧截图').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}

async function currentBlob() {
  const { shizhenSettings = {} } = await chrome.storage.local.get('shizhenSettings');
  const format = shizhenSettings.format === 'jpeg' ? 'jpeg' : 'png';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('图片尺寸过大，无法生成保存文件'));
    }, `image/${format}`, .92);
  });
  return { blob, format, settings: shizhenSettings };
}

async function downloadCurrent() {
  const { blob, format, settings } = await currentBlob();
  const title = sanitizedFilename(document.querySelector('#item-title').value);
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: `拾帧/${title}.${fileExtension(format)}`,
      saveAs: settings.browserDownload !== false
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
}

async function copyToClipboard(blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch {
    // Clipboard support varies by Chrome policy; saving still succeeds.
  }
}

async function saveCurrent() {
  saveStatus.textContent = '';
  const saveButton = document.querySelector('#save-button');
  saveButton.disabled = true;
  saveButton.textContent = '正在保存…';
  const { blob, format, settings } = await currentBlob();
  const stored = await chrome.storage.local.get('shizhenItems');
  const legacyItems = Array.isArray(stored.shizhenItems) ? stored.shizhenItems : [];
  const migration = await window.ShizhenDB.migrateLegacyItems(legacyItems);
  const items = migration.items;
  const metadata = pending.metadata || {};
  const folder = document.querySelector('#item-folder').value;
  if (!folder) throw new Error('请选择保存文件夹');
  const item = {
    id: crypto.randomUUID(),
    title: document.querySelector('#item-title').value.trim() || metadata.pageTitle || '网页截图',
    folder,
    tags: document.querySelector('#item-tags').value.split(',').map((tag) => tag.trim()).filter(Boolean),
    sourceTitle: metadata.pageTitle || '',
    sourceUrl: metadata.pageUrl || '',
    mode: metadata.mode || 'capture',
    width: canvas.width,
    height: canvas.height,
    format,
    byteSize: blob.size,
    storageType: 'indexeddb',
    createdAt: Date.now()
  };
  await window.ShizhenDB.put(item.id, blob);
  try {
    items.unshift(item);
    await chrome.storage.local.set({
      shizhenItems: items,
      shizhenPendingCapture: null,
      shizhenPendingCaptureRef: null
    });
    await window.ShizhenDB.remove(PENDING_CAPTURE_ID).catch(() => {});
  } catch (error) {
    await window.ShizhenDB.remove(item.id).catch(() => {});
    throw error;
  }
  if (settings.copyAfterCapture !== false) await copyToClipboard(blob);
  if (isEmbedded) {
    window.parent.postMessage({ source: 'shizhen-editor', type: 'saved', itemId: item.id }, '*');
  } else {
    document.querySelector('#saved-dialog').showModal();
  }
  return item;
}

function reportError(error) {
  const message = error?.message || '保存失败';
  saveStatus.textContent = message;
  const saveButton = document.querySelector('#save-button');
  saveButton.disabled = false;
  saveButton.textContent = '保存到素材库';
  if (isEmbedded && forceAutosave) {
    window.parent.postMessage({ source: 'shizhen-editor', type: 'error', message }, '*');
  }
}

async function createFolderFromEditor() {
  const value = prompt('输入新文件夹名称');
  if (value === null) return;
  saveStatus.textContent = '';
  try {
    const result = await window.ShizhenFolders.add(value);
    await window.ShizhenFolders.fillSelect(document.querySelector('#item-folder'), result.name);
  } catch (error) {
    saveStatus.textContent = error.message;
  }
}

function closeEditor() {
  if (isEmbedded) window.parent.postMessage({ source: 'shizhen-editor', type: 'close' }, '*');
  else window.close();
}

document.querySelector('#download-button')?.addEventListener('click', () => downloadCurrent().catch(reportError));
document.querySelector('#save-button')?.addEventListener('click', () => saveCurrent().catch(reportError));
document.querySelector('#new-folder-button')?.addEventListener('click', createFolderFromEditor);
document.querySelector('#close-editor')?.addEventListener('click', closeEditor);
document.querySelector('#close-editor-dialog')?.addEventListener('click', closeEditor);
document.querySelector('#view-library')?.addEventListener('click', () => {
  if (isEmbedded) chrome.runtime.sendMessage({ type: 'SHIZHEN_OPEN_LIBRARY' });
  else window.location.href = 'library.html';
});

async function initialize() {
  const stored = await chrome.storage.local.get(['shizhenPendingCapture', 'shizhenPendingCaptureRef', 'shizhenSettings']);
  pending = stored.shizhenPendingCapture;
  if (!pending && stored.shizhenPendingCaptureRef?.id) {
    pending = await window.ShizhenDB.get(stored.shizhenPendingCaptureRef.id);
  }
  if (!pending) throw new Error('没有待编辑的截图，请重新截取');
  await buildCanvas(pending);
  const metadata = pending.metadata || {};
  document.querySelector('#item-title').value = metadata.pageTitle || '网页截图';
  await window.ShizhenFolders.fillSelect(document.querySelector('#item-folder'), metadata.destination);
  document.querySelector('#source-title').textContent = metadata.pageTitle || '未知页面';
  const sourceLink = document.querySelector('#source-link');
  sourceLink.textContent = metadata.pageUrl || '无来源链接';
  sourceLink.href = metadata.pageUrl || '#';
  loading.hidden = true;
  canvasWrap.hidden = false;
  if (forceAutosave || stored.shizhenSettings?.editAfterCapture === false) await saveCurrent();
}

initialize().catch((error) => {
  loading.textContent = error.message;
  saveStatus.textContent = error.message;
  if (isEmbedded && forceAutosave) {
    window.parent.postMessage({ source: 'shizhen-editor', type: 'error', message: error.message }, '*');
  }
});
