// store.js — the only place IndexedDB is touched.
//
// One of the two adapter seams required by PROTOCOL.md. Every persistence call
// in the app goes through get/set/all/del. Swapping to extension storage, a
// local companion, or a native shell means rewriting this file and nothing else.

const DB_NAME = 'notes';
const DB_VERSION = 1;

export const KV = 'kv';          // tokens, sync cursor, ui prefs
export const NOTES = 'notes';    // { id, ...note }
export const FOLDERS = 'folders';
export const OUTBOX = 'outbox';  // { id, table, op, at }

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(NOTES)) db.createObjectStore(NOTES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FOLDERS)) db.createObjectStore(FOLDERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    // `out` is an IDBRequest for read ops; its .result is only populated by the
    // time oncomplete fires. Checking `.result !== undefined` is NOT enough —
    // a missing key has result === undefined and would leak the request object,
    // which is truthy, so "no session stored" would read as "signed in".
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Read one record. `key` is ignored for keyPath stores when the id is embedded. */
export function get(store, key) {
  return tx(store, 'readonly', s => s.get(key));
}

/** Write one record. For KV pass (KV, value, key); for keyPath stores pass (store, value). */
export function set(store, value, key) {
  return tx(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key)));
}

export function all(store) {
  return tx(store, 'readonly', s => s.getAll());
}

export function del(store, key) {
  return tx(store, 'readwrite', s => s.delete(key));
}

export function clear(store) {
  return tx(store, 'readwrite', s => s.clear());
}

/** Convenience for the KV store, which is the one that needs explicit keys. */
export const kv = {
  get: k => get(KV, k),
  set: (k, v) => set(KV, v, k),
  del: k => del(KV, k),
};
