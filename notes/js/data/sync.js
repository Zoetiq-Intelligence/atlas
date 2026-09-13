// sync.js — local-first. The app NEVER blocks on the network.
//
// Edit -> memory -> IndexedDB (debounced) -> outbox -> server.
// Pull on load and on visibility. v0 conflict policy is last-write-wins on the
// whole note by updated_at, which can lose an edit if the same note is changed
// on two devices while one is offline. Accepted for v0 and recorded in
// STATE.md; the per-block ids exist to fix it properly in v1.

import { all, set, del, get, kv, NOTES, FOLDERS, OUTBOX } from '../adapters/store.js';
import { isTransient } from '../adapters/net.js';
import * as api from './api.js';

const CURSOR = 'pulledAt';
let flushing = false;
let timer = null;
let listeners = [];

export function onState(fn) { listeners.push(fn); }
function emit(s) { listeners.forEach(f => f(s)); }

export async function localNotes() {
  const rows = await all(NOTES);
  return rows.filter(n => !n.deleted_at)
             .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at < a.updated_at ? -1 : 1));
}
export const localFolders = () => all(FOLDERS);
export const localNote = id => get(NOTES, id);

export async function saveLocal(note) {
  note.updated_at = new Date().toISOString();
  await set(NOTES, note);
  await set(OUTBOX, { id: note.id, table: 'notes', at: Date.now() });
  emit('dirty');
  schedule();
}

export async function saveFolderLocal(folder) {
  await set(FOLDERS, folder);
  await set(OUTBOX, { id: folder.id, table: 'folders', at: Date.now() });
  emit('dirty');
  schedule();
}

function schedule(ms = 900) {
  clearTimeout(timer);
  timer = setTimeout(() => { flush(); }, ms);
}

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await all(OUTBOX);
    for (const item of queue) {
      try {
        if (item.table === 'notes') {
          const n = await get(NOTES, item.id);
          if (!n) { await del(OUTBOX, item.id); continue; }
          await api.upsertNote({
            id: n.id, title: n.title, doc: n.doc, folder_id: n.folder_id,
            pinned: !!n.pinned, deleted_at: n.deleted_at || null,
          });
        } else {
          const f = await get(FOLDERS, item.id);
          if (!f) { await del(OUTBOX, item.id); continue; }
          await api.upsertFolder({ id: f.id, name: f.name, sort: f.sort || 0 });
        }
        await del(OUTBOX, item.id);
      } catch (e) {
        if (isTransient(e)) { emit('off'); schedule(8000); return; }
        await del(OUTBOX, item.id);          // permanent rejection: drop, don't loop
      }
    }
    emit('ok');
  } finally {
    flushing = false;
  }
}

export async function pull() {
  try {
    const [notes, folders] = await Promise.all([api.fetchNotes(), api.fetchFolders()]);
    for (const f of folders) await set(FOLDERS, f);
    for (const n of notes) {
      const mine = await get(NOTES, n.id);
      // last-write-wins by updated_at; an unflushed local edit survives the pull
      if (mine && mine.updated_at > n.updated_at) continue;
      await set(NOTES, n);
    }
    await kv.set(CURSOR, new Date().toISOString());
    emit('ok');
    return true;
  } catch {
    emit('off');
    return false;
  }
}

export function start() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pull(); flush(); }
  });
  window.addEventListener('online', () => { flush(); pull(); });
  setInterval(() => { if (document.visibilityState === 'visible') flush(); }, 20000);
}
