const DB_NAME = 'road-sos-offline';
const STORE = 'pending-sos';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Offline storage is not supported in this browser.'));
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error || new Error('Could not open offline storage.'));
  });
}

async function withStore(mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage failed.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Offline storage failed.')); };
  });
}

export const savePendingSOS = item => withStore('readwrite', store => store.add({ ...item, savedAt: new Date().toISOString() }));
export const listPendingSOS = async () => (await withStore('readonly', store => store.getAll())) || [];
export const deletePendingSOS = id => withStore('readwrite', store => store.delete(id));
