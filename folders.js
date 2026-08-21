(() => {
  const STORAGE_KEY = 'shizhenFolders';
  const DEFAULT_FOLDERS = ['产品灵感 / 待整理', '竞品研究 / 网页', '视觉参考 / 截图'];

  function cleanName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function validateName(value) {
    const name = cleanName(value);
    if (!name) throw new Error('请输入文件夹名称');
    if (name.length > 40) throw new Error('文件夹名称不能超过 40 个字符');
    return name;
  }

  function normalize(values) {
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const name = cleanName(value);
      if (!name || result.some((entry) => entry.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
      result.push(name);
    }
    return result;
  }

  async function get() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, 'shizhenItems', 'shizhenDestination']);
    const hasSavedFolders = Array.isArray(stored[STORAGE_KEY]);
    const folders = normalize(hasSavedFolders ? stored[STORAGE_KEY] : DEFAULT_FOLDERS);

    for (const item of Array.isArray(stored.shizhenItems) ? stored.shizhenItems : []) {
      const itemFolder = cleanName(item.folder);
      if (itemFolder && !folders.includes(itemFolder)) folders.push(itemFolder);
    }
    const destination = cleanName(stored.shizhenDestination);
    if (destination && !folders.includes(destination)) folders.push(destination);
    if (!folders.length) folders.push(DEFAULT_FOLDERS[0]);

    if (!hasSavedFolders || JSON.stringify(folders) !== JSON.stringify(normalize(stored[STORAGE_KEY]))) {
      await chrome.storage.local.set({ [STORAGE_KEY]: folders });
    }
    return folders;
  }

  async function add(value) {
    const name = validateName(value);
    const folders = await get();
    if (folders.some((entry) => entry.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('已存在同名文件夹');
    }
    folders.push(name);
    await chrome.storage.local.set({ [STORAGE_KEY]: folders });
    return { folders, name };
  }

  async function rename(oldValue, newValue) {
    const oldName = cleanName(oldValue);
    const name = validateName(newValue);
    const folders = await get();
    const index = folders.indexOf(oldName);
    if (index < 0) throw new Error('找不到要重命名的文件夹');
    if (folders.some((entry, entryIndex) => entryIndex !== index && entry.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('已存在同名文件夹');
    }

    folders[index] = name;
    const stored = await chrome.storage.local.get(['shizhenItems', 'shizhenDestination']);
    const items = (Array.isArray(stored.shizhenItems) ? stored.shizhenItems : []).map((item) => (
      item.folder === oldName ? { ...item, folder: name } : item
    ));
    const destination = stored.shizhenDestination === oldName ? name : stored.shizhenDestination;
    await chrome.storage.local.set({ [STORAGE_KEY]: folders, shizhenItems: items, shizhenDestination: destination || folders[0] });
    return { folders, name, items };
  }

  async function remove(value) {
    const name = cleanName(value);
    const folders = await get();
    if (!folders.includes(name)) throw new Error('找不到要删除的文件夹');
    if (folders.length <= 1) throw new Error('至少需要保留一个文件夹');

    const nextFolders = folders.filter((entry) => entry !== name);
    const fallback = nextFolders[0];
    const stored = await chrome.storage.local.get(['shizhenItems', 'shizhenDestination']);
    let movedCount = 0;
    const items = (Array.isArray(stored.shizhenItems) ? stored.shizhenItems : []).map((item) => {
      if (item.folder !== name) return item;
      movedCount += 1;
      return { ...item, folder: fallback };
    });
    const destination = stored.shizhenDestination === name ? fallback : (stored.shizhenDestination || fallback);
    await chrome.storage.local.set({ [STORAGE_KEY]: nextFolders, shizhenItems: items, shizhenDestination: destination });
    return { folders: nextFolders, fallback, movedCount, items };
  }

  async function fillSelect(select, preferredValue = '') {
    const folders = await get();
    const preferred = cleanName(preferredValue);
    if (preferred && !folders.includes(preferred)) folders.push(preferred);
    select.textContent = '';
    for (const folder of folders) {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = folder;
      select.appendChild(option);
    }
    select.value = preferred && folders.includes(preferred) ? preferred : folders[0];
    return folders;
  }

  globalThis.ShizhenFolders = {
    STORAGE_KEY,
    DEFAULT_FOLDERS: [...DEFAULT_FOLDERS],
    cleanName,
    normalize,
    get,
    add,
    rename,
    remove,
    fillSelect
  };
})();
