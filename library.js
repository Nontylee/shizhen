const grid = document.querySelector('#item-grid');
const emptyState = document.querySelector('#empty-state');
const detailPanel = document.querySelector('#detail-panel');
const libraryMain = document.querySelector('.library-main');
const searchInput = document.querySelector('#search-input');
const folderList = document.querySelector('#folder-list');
const folderDialog = document.querySelector('#folder-dialog');
const folderForm = document.querySelector('#folder-form');
const folderNameInput = document.querySelector('#folder-name');
const folderError = document.querySelector('#folder-error');
let items = [];
let folders = [];
let selectedFolder = 'all';
let selectedItemId = null;
let editingFolder = null;
let renderVersion = 0;
const objectUrls = new Map();

function modeName(mode) {
  const names = { element: '元素截图', region: '区域截图', full: '整页截图', visible: '当前画面' };
  return names[mode] || '网页截图';
}

function dateLabel(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

function filteredItems() {
  const query = searchInput.value.trim().toLowerCase();
  return items.filter((item) => {
    const folderMatch = selectedFolder === 'all' || item.folder === selectedFolder;
    const haystack = [item.title, item.sourceTitle, item.sourceUrl, ...(item.tags || [])].join(' ').toLowerCase();
    return folderMatch && (!query || haystack.includes(query));
  });
}

function selectFolder(folder) {
  selectedFolder = folder;
  closeDetail();
  render();
}

function renderFolders() {
  folderList.textContent = '';
  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = `nav-button${selectedFolder === 'all' ? ' is-selected' : ''}`;
  allButton.dataset.folder = 'all';
  const allLabel = document.createElement('span');
  allLabel.textContent = '全部素材';
  const allCount = document.createElement('strong');
  allCount.id = 'all-count';
  allCount.textContent = items.length;
  allButton.append(allLabel, allCount);
  allButton.addEventListener('click', () => selectFolder('all'));
  folderList.appendChild(allButton);

  for (const folder of folders) {
    const row = document.createElement('div');
    row.className = `folder-row${selectedFolder === folder ? ' is-selected' : ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nav-button${selectedFolder === folder ? ' is-selected' : ''}`;
    button.dataset.folder = folder;
    button.title = folder;
    const label = document.createElement('span');
    label.textContent = folder;
    const count = document.createElement('strong');
    count.textContent = items.filter((item) => item.folder === folder).length;
    button.append(label, count);
    button.addEventListener('click', () => selectFolder(folder));

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'folder-edit-button';
    editButton.setAttribute('aria-label', `编辑文件夹 ${folder}`);
    editButton.title = '重命名或删除';
    editButton.textContent = '•••';
    editButton.addEventListener('click', () => openFolderDialog(folder));
    row.append(button, editButton);
    folderList.appendChild(row);
  }
}

async function itemImageUrl(item) {
  if (item.dataUrl) return item.dataUrl;
  if (objectUrls.has(item.id)) return objectUrls.get(item.id);
  const blob = await window.ShizhenDB.get(item.id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.set(item.id, url);
  return url;
}

async function render() {
  const version = ++renderVersion;
  const visibleItems = filteredItems();
  document.querySelector('#view-title').textContent = selectedFolder === 'all' ? '全部素材' : selectedFolder;
  document.querySelector('#view-description').textContent = selectedFolder === 'all'
    ? '最近保存的网页截图'
    : `${items.filter((item) => item.folder === selectedFolder).length} 个素材`;
  renderFolders();
  grid.textContent = '';
  emptyState.hidden = visibleItems.length !== 0;
  for (const item of visibleItems) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'item-card';
    card.dataset.id = item.id;
    const thumbnail = document.createElement('div');
    thumbnail.className = 'item-thumbnail';
    const image = document.createElement('img');
    image.src = await itemImageUrl(item);
    if (version !== renderVersion) return;
    image.alt = '';
    const dimensions = document.createElement('span');
    dimensions.className = 'item-dimensions';
    dimensions.textContent = `${item.width} × ${item.height}`;
    thumbnail.append(image, dimensions);
    const copy = document.createElement('div');
    copy.className = 'item-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.textContent = `${modeName(item.mode)} · ${dateLabel(item.createdAt)}`;
    copy.append(title, meta);
    card.append(thumbnail, copy);
    card.addEventListener('click', () => openDetail(item.id));
    grid.appendChild(card);
  }
}

function openFolderDialog(folder = null) {
  editingFolder = folder;
  folderError.textContent = '';
  document.querySelector('#folder-dialog-title').textContent = folder ? '编辑文件夹' : '新建文件夹';
  document.querySelector('#delete-folder').hidden = !folder;
  folderNameInput.value = folder || '';
  folderDialog.showModal();
  requestAnimationFrame(() => {
    folderNameInput.focus();
    folderNameInput.select();
  });
}

async function saveFolder(event) {
  event.preventDefault();
  folderError.textContent = '';
  try {
    if (editingFolder) {
      const previousFolder = editingFolder;
      const wasSelected = selectedFolder === previousFolder;
      const result = await window.ShizhenFolders.rename(previousFolder, folderNameInput.value);
      folders = result.folders;
      items = result.items;
      if (wasSelected) selectedFolder = result.name;
    } else {
      const result = await window.ShizhenFolders.add(folderNameInput.value);
      folders = result.folders;
      selectedFolder = result.name;
    }
    folderDialog.close();
    render();
  } catch (error) {
    folderError.textContent = error.message;
    folderNameInput.focus();
  }
}

async function deleteFolder() {
  if (!editingFolder) return;
  const itemCount = items.filter((item) => item.folder === editingFolder).length;
  const question = itemCount
    ? `删除「${editingFolder}」？其中 ${itemCount} 个素材会移动到其他文件夹。`
    : `删除「${editingFolder}」？`;
  if (!confirm(question)) return;
  folderError.textContent = '';
  try {
    const removedFolder = editingFolder;
    const wasSelected = selectedFolder === removedFolder;
    const result = await window.ShizhenFolders.remove(removedFolder);
    folders = result.folders;
    items = result.items;
    if (wasSelected) selectedFolder = result.fallback;
    folderDialog.close();
    render();
  } catch (error) {
    folderError.textContent = error.message;
  }
}

async function openDetail(itemId) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return;
  selectedItemId = itemId;
  document.querySelector('#detail-image').src = await itemImageUrl(item);
  document.querySelector('#detail-title').textContent = item.title;
  document.querySelector('#detail-meta').textContent = `${item.folder} · ${modeName(item.mode)} · ${dateLabel(item.createdAt)}`;
  const tags = document.querySelector('#detail-tags');
  tags.textContent = '';
  (item.tags || []).forEach((tag) => {
    const span = document.createElement('span');
    span.textContent = tag;
    tags.appendChild(span);
  });
  const source = document.querySelector('#detail-source');
  source.href = item.sourceUrl || '#';
  source.textContent = item.sourceUrl || '无来源链接';
  detailPanel.hidden = false;
  libraryMain.classList.add('has-detail');
}

function closeDetail() {
  detailPanel.hidden = true;
  libraryMain.classList.remove('has-detail');
  selectedItemId = null;
}

async function downloadSelected() {
  const item = items.find((entry) => entry.id === selectedItemId);
  if (!item) return;
  const safeTitle = item.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const extension = item.format === 'jpeg' ? 'jpg' : 'png';
  const url = await itemImageUrl(item);
  if (!url) throw new Error('图片文件不存在');
  const { shizhenSettings = {} } = await chrome.storage.local.get('shizhenSettings');
  await chrome.downloads.download({
    url,
    filename: `拾帧/${safeTitle}.${extension}`,
    saveAs: shizhenSettings.browserDownload !== false
  });
}

async function deleteSelected() {
  const item = items.find((entry) => entry.id === selectedItemId);
  if (!item || !confirm(`删除「${item.title}」？`)) return;
  if (!item.dataUrl) await window.ShizhenDB.remove(item.id).catch(() => {});
  if (objectUrls.has(item.id)) {
    URL.revokeObjectURL(objectUrls.get(item.id));
    objectUrls.delete(item.id);
  }
  items = items.filter((entry) => entry.id !== selectedItemId);
  await chrome.storage.local.set({ shizhenItems: items });
  closeDetail();
  render();
}

searchInput.addEventListener('input', render);
document.querySelector('#add-folder').addEventListener('click', () => openFolderDialog());
folderForm.addEventListener('submit', saveFolder);
document.querySelector('#cancel-folder').addEventListener('click', () => folderDialog.close());
document.querySelector('#delete-folder').addEventListener('click', deleteFolder);
document.querySelector('#close-detail').addEventListener('click', closeDetail);
document.querySelector('#detail-download').addEventListener('click', downloadSelected);
document.querySelector('#detail-delete').addEventListener('click', deleteSelected);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.shizhenItems) items = Array.isArray(changes.shizhenItems.newValue) ? changes.shizhenItems.newValue : [];
  if (changes.shizhenFolders) folders = window.ShizhenFolders.normalize(changes.shizhenFolders.newValue);
  if (!changes.shizhenItems && !changes.shizhenFolders) return;
  if (selectedFolder !== 'all' && !folders.includes(selectedFolder)) selectedFolder = 'all';
  render();
});

async function initializeLibrary() {
  const stored = await chrome.storage.local.get('shizhenItems');
  const legacyItems = Array.isArray(stored.shizhenItems) ? stored.shizhenItems : [];
  const migration = await window.ShizhenDB.migrateLegacyItems(legacyItems);
  items = migration.items;
  if (migration.changed) await chrome.storage.local.set({ shizhenItems: items });
  folders = await window.ShizhenFolders.get();
  await render();
}

initializeLibrary().catch((error) => {
  emptyState.hidden = false;
  emptyState.querySelector('h2').textContent = '素材库读取失败';
  emptyState.querySelector('p').textContent = error.message;
});

window.addEventListener('unload', () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});
