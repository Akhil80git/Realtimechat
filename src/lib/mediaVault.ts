const DB_NAME = 'varta_private_vault_v1';
const STORE_NAME = 'media_blobs';

let dbPromise: Promise<IDBDatabase> | null = null;
const objectUrlCache = new Map<string, string>();

function openVaultDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });

  return dbPromise;
}

export async function saveMediaBlob(mediaId: string, blob: Blob): Promise<string> {
  const existingUrl = objectUrlCache.get(mediaId);
  if (existingUrl) {
    URL.revokeObjectURL(existingUrl);
  }
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(mediaId, url);

  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, mediaId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Keep in-memory object URL even if IndexedDB is restricted in private mode
  }

  return url;
}

export async function getMediaBlob(mediaId: string): Promise<Blob | null> {
  try {
    const db = await openVaultDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(mediaId);
      req.onsuccess = () => {
        const res = req.result;
        resolve(res instanceof Blob ? res : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getMediaObjectUrl(mediaId: string): Promise<string | null> {
  const cached = objectUrlCache.get(mediaId);
  if (cached) return cached;

  const blob = await getMediaBlob(mediaId);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  objectUrlCache.set(mediaId, url);
  return url;
}

export async function deleteMediaBlobs(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;

  for (const id of mediaIds) {
    const url = objectUrlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlCache.delete(id);
    }
  }

  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of mediaIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function clearAllMediaBlobs(): Promise<void> {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();

  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function getMediaVaultBytes(): Promise<number> {
  try {
    const db = await openVaultDb();
    return await new Promise<number>((resolve) => {
      let total = 0;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value instanceof Blob) {
            total += cursor.value.size;
          }
          cursor.continue();
        } else {
          resolve(total);
        }
      };
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}
