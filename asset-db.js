(() => {
  const DB_NAME = 'shizhen-assets';
  const DB_VERSION = 1;
  const STORE_NAME = 'images';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开图片数据库'));
    });
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error('图片数据库操作失败'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error('图片数据库操作已取消'));
      };
      result = operation(store);
    });
  }

  async function put(id, payload) {
    await runTransaction('readwrite', (store) => store.put({ id, blob: payload, updatedAt: Date.now() }));
  }

  async function get(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => {
        database.close();
        resolve(request.result?.blob || null);
      };
      request.onerror = () => {
        database.close();
        reject(request.error || new Error('无法读取图片'));
      };
    });
  }

  async function remove(id) {
    await runTransaction('readwrite', (store) => store.delete(id));
  }

  async function migrateLegacyItems(items) {
    let changed = false;
    const migrated = [];
    for (const original of items) {
      if (!original?.dataUrl || !original.id) {
        migrated.push(original);
        continue;
      }
      const response = await fetch(original.dataUrl);
      const blob = await response.blob();
      await put(original.id, blob);
      const item = { ...original, byteSize: blob.size, storageType: 'indexeddb' };
      delete item.dataUrl;
      migrated.push(item);
      changed = true;
    }
    return { items: migrated, changed };
  }

  globalThis.ShizhenDB = { put, get, remove, migrateLegacyItems };
})();
