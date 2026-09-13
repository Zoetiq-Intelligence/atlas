// main.js — wiring only. No logic lives here that isn't about connecting modules.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import * as net from './adapters/net.js';
import { NOTES, set, get } from './adapters/store.js';
import * as auth from './data/auth.js';
import * as sync from './data/sync.js';
import { newDoc, coerce, titleOf } from './model/doc.js';
import { createEditor } from './editor/input.js';
import { createPanes } from './ui/panes.js';
import { createFooter } from './ui/footer.js';
import { createSidebar } from './ui/sidebar.js';
import * as layout from './ui/layout.js';
import { mount as mountDiag } from './ui/diag.js';

const $ = s => document.querySelector(s);
const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

let panes, footer, sidebar;
let editors = [];
let openIds = [null, null];
let focused = 0;
let notes = [], folders = [];

// ---------------------------------------------------------------- boot

async function boot() {
  layout.start();

  if (SUPABASE_URL.startsWith('__')) {
    gateMessage('config.js still has placeholders — Supabase URL and anon key are not set.', true);
    $('#gate').hidden = false;
    return;
  }

  net.configure({
    getToken: auth.getToken,
    onUnauthorized: () => { auth.signOut().then(showGate); },
  });

  await auth.restore();
  try { await auth.consumeRedirect(); }
  catch (e) { gateMessage(e.message, true); }

  if (!auth.signedIn()) { showGate(); return; }
  await startApp();
}

function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
}

function gateMessage(text, bad) {
  const m = $('#gate .msg');
  m.textContent = text;
  m.classList.toggle('bad', !!bad);
}

$('#f-email').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#email').value.trim();
  if (!email) return;
  gateMessage('Sending…');
  try {
    await auth.sendLoginEmail(email);
    $('#f-email').hidden = true;
    $('#f-code').hidden = false;
    $('#code').focus();
    gateMessage('Check your email. Enter the code here, or open the link on a computer.');
  } catch (err) {
    gateMessage(err.status === 429
      ? 'Too many emails for now — Supabase rate-limits auth mail on the free tier. Try again shortly.'
      : (err.message || 'Could not send the email.'), true);
  }
});

$('#f-code').addEventListener('submit', async e => {
  e.preventDefault();
  const code = $('#code').value.trim();
  const email = $('#email').value.trim();
  if (!code) return;
  gateMessage('Checking…');
  try {
    await auth.verifyCode(email, code);
    await startApp();
  } catch (err) {
    gateMessage(err.status === 403 || err.status === 401
      ? 'That code is wrong or has expired. Codes last one hour.'
      : (err.message || 'Could not verify that code.'), true);
  }
});

$('#back').addEventListener('click', () => {
  $('#f-code').hidden = true;
  $('#f-email').hidden = false;
  $('#code').value = '';
  gateMessage('');
});

// ---------------------------------------------------------------- app

async function startApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;

  panes = createPanes($('#panes'), $('#gutter'), { onActive: i => { focused = i; footer.sync(); } });

  editors = [0, 1].map(i => createEditor(panes.editor(i), {
    onChange: (doc, title) => persist(i, doc, title),
    onFocus: () => { focused = i; footer.sync(); },
  }));

  footer = createFooter($('#footer'), () => editors[focused]);

  sidebar = createSidebar($('#sidebar'), $('#scrim'), {
    onOpen: id => openInto(focused, id),
    onNew: folderId => newNote(folderId),
    onNewFolder: name => newFolder(name),
  });

  for (const b of document.querySelectorAll('[data-act="list"]')) b.onclick = () => sidebar.toggle();
  for (const b of document.querySelectorAll('[data-act="new"]')) b.onclick = () => newNote(null);
  $('#signout').onclick = async () => { await auth.signOut(); location.reload(); };

  sync.onState(s => { $('#pip').dataset.s = s; });
  sync.start();

  // ---- GUIDE §7 — hand the update layer its predicates and its surfaces ----
  const U = (window.UPDATE = window.UPDATE || {});
  U.isBusy = isBusy;
  U.onPrimarySurface = onPrimarySurface;
  const badge = $('#updbadge');
  // §7.7 — passive and non-modal, allowed to show while busy, so an update is never
  // invisible to someone who never leaves the work surface. Tapping it is consent to
  // be interrupted now.
  U.onAvailable = v => { badge.hidden = !v; };
  badge.onclick = () => location.reload();

  // §7.13 — the build id is read from the LIVE cache, never a constant.
  const buildBtn = $('#build');
  const showBuild = () => {
    if (!U.buildId) { buildBtn.textContent = 'build —'; return; }
    U.buildId().then(id => { buildBtn.textContent = id ? 'build ' + id.replace(/^notes-/, '') : 'build (uncached)'; });
  };
  showBuild();

  // §9 — five taps opens the device truth kit. Hidden rather than absent, because a
  // diagnostic that is easy to open by accident gets tapped by accident, and one that
  // needs a new deploy to reach the device is useless when you need it.
  let taps = 0, tapTimer = null;
  buildBtn.onclick = () => {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 1200);
    if (taps >= 5) { taps = 0; mountDiag($('#diag')); }
  };

  await refresh();
  await sync.pull();
  await refresh();

  // both panes get a note on first launch, so the dual layout is real
  // immediately rather than after the user finds the second pane
  if (notes[0]) await openInto(0, notes[0].id); else await newNote(null, 0);
  if (notes[1]) await openInto(1, notes[1].id); else await newNote(null, 1);
  focused = 0;
  editors[0].focus();
  sync.flush();
}

async function refresh() {
  notes = await sync.localNotes();
  folders = await sync.localFolders();
  sidebar.set(notes, folders, openIds[focused]);
}

// ---------------------------------------------------------------- notes

async function newNote(folderId, pane) {
  const row = {
    id: uuid(),
    title: '',
    doc: newDoc(),
    folder_id: folderId || null,
    pinned: false,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  };
  await set(NOTES, row);
  await sync.saveLocal(row);
  await refresh();
  await openInto(pane === undefined ? focused : pane, row.id);
  editors[pane === undefined ? focused : pane].focus();
}

async function newFolder(name) {
  const row = { id: uuid(), name, sort: folders.length, created_at: now(), updated_at: now() };
  await sync.saveFolderLocal(row);
  await refresh();
}

async function openInto(i, id) {
  const n = await get(NOTES, id);
  if (!n) return;
  openIds[i] = id;
  editors[i].load(id, coerce(n.doc));
  panes.header(i).textContent = n.title || 'New Note';
  sidebar.current(openIds[focused]);
  footer.sync();
}

// ===========================================================================
// GUIDE §7.4 — busy() must be written from what a RELOAD WOULD DESTROY, not from
// what the state object happens to expose. The obvious version asks the store
// whether it holds a pending value — and the interval between "the user is typing"
// and "the debounce fired" is exactly the interval that matters, during which the
// store is clean. So the guard reads false at the moment the user is most engaged.
// DOM-only state counts too: a gutter drag exists only as a pointer capture.
// ===========================================================================
let pendingSaves = 0;
let dragging = false;

function isBusy() {
  if (pendingSaves > 0) return true;                       // an edit is mid-debounce
  if (dragging || (window.UPDATE && window.UPDATE.__dragging)) return true;  // DOM-only gesture
  if (document.activeElement && document.activeElement.closest &&
      document.activeElement.closest('.txt')) return true; // caret is in the text
  const s = document.getElementById('search');
  if (s && s.value.trim()) return true;                    // a search they would lose
  return false;
}

// GUIDE §7.6 — a DIFFERENT predicate: not about losing state, about interrupting.
// A visible reload on the surface someone is working on is an interruption even when
// the state cost is nil.
function onPrimarySurface() {
  const sb = document.getElementById('sidebar');
  if (sb && !sb.hidden) return false;      // the list is open: not the work surface
  return document.visibilityState === 'visible';
}

let saveTimers = [null, null];
function persist(i, doc, title) {
  const id = openIds[i];
  if (!id) return;
  panes.header(i).textContent = title || 'New Note';
  clearTimeout(saveTimers[i]);
  pendingSaves++;
  saveTimers[i] = setTimeout(async () => {
    pendingSaves = Math.max(0, pendingSaves - 1);
    const n = await get(NOTES, id);
    if (!n) return;
    n.doc = doc;
    n.title = title;
    await sync.saveLocal(n);
    // the other pane may be showing the same note
    const other = i === 0 ? 1 : 0;
    if (openIds[other] === id) panes.header(other).textContent = title || 'New Note';
    notes = await sync.localNotes();
    sidebar.set(notes, folders, openIds[focused]);
  }, 400);
}

// GUIDE §4.4 — a scroll-snap container holding a focused contenteditable fights the
// browser's scroll-caret-into-view: WebKit scrolls to the caret, snap yanks it back to
// the nearest snap point. Suspend snapping while the editor has focus.
document.addEventListener('focusin', e => {
  if (e.target.closest && e.target.closest('.txt')) $('#panes').style.scrollSnapType = 'none';
});
document.addEventListener('focusout', e => {
  if (e.target.closest && e.target.closest('.txt')) {
    setTimeout(() => {
      if (!document.activeElement || !document.activeElement.closest('.txt')) {
        $('#panes').style.scrollSnapType = '';
      }
    }, 80);
  }
});

// GUIDE §3.5 — when the keyboard opens it shrinks the visual viewport only, so the
// block being typed into can end up behind it. Re-reveal it whenever --kb changes.
layout.onViewport(v => {
  if (!v.keyboardHeight) return;
  const t = document.activeElement;
  if (!t || !t.closest || !t.closest('.txt')) return;
  const r = t.getBoundingClientRect();
  // NOTE: never parseFloat a custom property whose value is a calc() —
  // getPropertyValue returns the unresolved token stream, so it reads 0. Measure the
  // element instead. (Found by device.test.mjs, which is why that test exists.)
  const bar = document.getElementById('footer');
  const barH = bar ? bar.getBoundingClientRect().height : 0;
  const floor = window.innerHeight - v.keyboardHeight - barH - 8;
  if (r.bottom > floor) {
    const ed = t.closest('.editor');
    if (ed) ed.scrollTop += (r.bottom - floor);
  }
});

window.addEventListener('pagehide', () => { editors.forEach(e => e && e.flush()); sync.flush(); });

boot();
