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
import * as realtime from './realtime.js';

const CURSOR = 'pulledAt';
let flushing = false;
let timer = null;
let listeners = [];
let changed = [];

// WHAT WE JUST WROTE, so we can recognise our own echo. A database broadcast ALWAYS
// reaches the writer — broadcast.self only governs client-sent messages — so without
// this every save comes back as news and costs a pointless round trip. The server's
// updated_at is the discriminator, which is why the upsert's returned row is kept
// rather than discarded.
const recent = new Map();
const RECENT_TTL = 15000;
function remember(row) {
  if (!row || !row.id) return;
  recent.set(row.id, row.updated_at);
  setTimeout(() => recent.delete(row.id), RECENT_TTL);
}

let liveState = 'off';
export const live = () => liveState;

export function onState(fn) { listeners.push(fn); }
/** Called with the ids a pull actually overwrote. Empty pulls do not fire. */
export function onChange(fn) { changed.push(fn); }
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
          remember(await api.upsertNote({
            id: n.id, title: n.title, doc: n.doc, folder_id: n.folder_id,
            pinned: !!n.pinned, deleted_at: n.deleted_at || null,
          }));
        } else {
          const f = await get(FOLDERS, item.id);
          if (!f) { await del(OUTBOX, item.id); continue; }
          remember(await api.upsertFolder({ id: f.id, name: f.name, sort: f.sort || 0 }));
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
    // WHICH ids actually moved. Writing to IndexedDB is not the end of a pull: nothing
    // on screen re-reads the store on its own, so before this the poll was fetching
    // rows into a database nobody looked at again until the next boot. A pull has to
    // say what it changed or it may as well not have run.
    const touched = [];
    for (const n of notes) {
      const mine = await get(NOTES, n.id);
      // last-write-wins by updated_at; an unflushed local edit survives the pull
      if (mine && mine.updated_at > n.updated_at) continue;
      if (!mine || mine.updated_at !== n.updated_at) touched.push(n.id);
      await set(NOTES, n);
    }
    await kv.set(CURSOR, new Date().toISOString());
    emit('ok');
    if (touched.length) changed.forEach(f => { try { f(touched); } catch (e) { /* never break the loop */ } });
    return true;
  } catch {
    emit('off');
    return false;
  }
}

// A VISIBLE APP NEVER PULLED. Before this, pull() ran only on visibilitychange and
// on `online`, while the 20s interval flushed writes and never read — so two devices
// both sitting open, or two panes on one device, would not see each other's edits
// until something was backgrounded and foregrounded. That is not a sync latency
// problem, it is no sync at all in the case that matters most.
//
// This is the FLOOR, not the answer. Live sync (QUEUE #1) is a database broadcast that
// gets this under a second; the design says explicitly to keep a poll underneath it,
// because broadcast delivery is at-most-once and a missed message must not mean a
// missed edit. So this stays after realtime lands, just at a longer interval.
const PULL_MS = 5000;
const PULL_MS_LIVE = 30000;      // the floor stays under realtime, just further down
const FLUSH_MS = 20000;

let pullTimer = null;

/**
 * A burst of broadcasts (a restore, a paste across many notes) must not become a burst
 * of pulls. One pull answers all of them, because a pull is "fetch everything that
 * changed", not "fetch this row".
 */
let coalesce = null;
function pullSoon() {
  clearTimeout(coalesce);
  coalesce = setTimeout(() => { coalesce = null; pull(); }, 120);
}

/**
 * Live sync. The stream carries a POINTER — {op, kind, id, updated_at} — and the row
 * comes over the PostgREST path that is already proven. Delivery is at-most-once, so
 * the poll below is not redundant; it is what makes a dropped message cost seconds
 * instead of an edit.
 */
export function startLive({ getToken, userId }) {
  realtime.start({
    getToken,
    userId,
    onChange: p => {
      if (recent.get(p.id) === p.updated_at) return;      // our own write, already applied
      pullSoon();
    },
    onState: s => {
      liveState = s;
      // Realtime being down is not the same as sync being down: HTTP still works and
      // the poll still runs, so this must NOT paint the offline pip.
      clearInterval(pullTimer);
      pullTimer = setInterval(
        () => { if (document.visibilityState === 'visible') pull(); },
        s === 'live' ? PULL_MS_LIVE : PULL_MS);
      if (s === 'live') pull();       // reconcile immediately on (re)join
    },
  });
}

export function start() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pull(); flush(); }
  });
  window.addEventListener('online', () => { flush(); pull(); });
  setInterval(() => { if (document.visibilityState === 'visible') flush(); }, FLUSH_MS);
  clearInterval(pullTimer);
  pullTimer = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, PULL_MS);
}
