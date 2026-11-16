// Speicher im Browser (IndexedDB): Einstellungen/Boards in "kv", Audiodateien in "files".

let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('turniersounds', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kv');
        r.result.createObjectStore('files');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function run(storeName, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(storeName, mode);
    const rq = fn(t.objectStore(storeName));
    t.oncomplete = () => res(rq ? rq.result : undefined);
    t.onerror = t.onabort = () => rej(t.error || new Error('Speicherfehler'));
  }));
}

export const get = k => run('kv', 'readonly', s => s.get(k));
export const set = (k, v) => run('kv', 'readwrite', s => s.put(v, k));
export const getFile = k => run('files', 'readonly', s => s.get(k));
export const putFile = (k, rec) => run('files', 'readwrite', s => s.put(rec, k));
export const delFile = k => run('files', 'readwrite', s => s.delete(k));
export const fileKeys = () => run('files', 'readonly', s => s.getAllKeys());
export const clearAll = () => Promise.all([
  run('kv', 'readwrite', s => s.clear()),
  run('files', 'readwrite', s => s.clear()),
]);
