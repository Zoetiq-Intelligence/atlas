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
import { createSelectionMenu } from './ui/selection.js';
import { createKeys } from './ui/keys.js';
import { markParity } from './editor/commands.js';
import { createSidebar } from './ui/sidebar.js';
import { createTopbar } from './ui/topbar.js';
import * as layout from './ui/layout.js';
import { mount as mountDiag } from './ui/diag.js';
import { mount as mountBackups } from './ui/backups.js';
import * as backup from './data/backup.js';

const $ = s => document.querySelector(s);
const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

let panes, footer, sidebar, topbar, selmenu;
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

  topbar = createTopbar($('#topbar'), {
    onList: pane => sidebar.openFor(pane),
    onNew: pane => newNote(null, pane),       // lands in whichever segment is current
    onPane: i => { panes.goTo(i); setFocus(i); },
  });

  panes = createPanes($('#panes'), $('#gutter'), {
    onActive: i => setFocus(i),
    onSplit: f => topbar.setSplit(panes.isWide() ? f : null),
  });
  topbar.setSplit(panes.isWide() ? 0.5 : null);
  window.__panes__ = panes;   // test surface: assert the divider's snap stops

  editors = [0, 1].map(i => createEditor(panes.editor(i), {
    onChange: (doc, title) => persist(i, doc, title),
    onFocus: () => setFocus(i),
  }));

  // The three surfaces, all rendered from editor/commands.js. `host` carries the
  // app-level actions a command can need that an editor does not own.
  const host = {
    search: () => { sidebar.openFor(focused); $('#search').focus(); },
    prompt: msg => window.prompt(msg),
  };
  footer = createFooter($('#footer'), () => editors[focused], host);
  selmenu = createSelectionMenu($('#selmenu'), () => editors[focused], host);
  createKeys({ getEditor: () => editors[focused], host, onAfter: () => footer.sync() });

  // Operator's rule: an unfinished command must be visible IN THE APP, not only in a
  // test run. Audited against the DOM that actually rendered, so a surface silently
  // dropping a command is caught too.
  const parity = markParity($('#footer'), $('#selmenu'));
  window.__PARITY__ = parity;            // test surface
  const gaps = parity.filter(r => !r.ok);
  if (gaps.length) console.warn('[parity] incomplete:', gaps.map(g => `${g.cmd.id} (${g.missing.join(', ')})`));

  sidebar = createSidebar($('#sidebar'), $('#scrim'), {
    // `pane` is undefined when the row itself was tapped (use the focused pane) and
    // 0/1 when a destination was named by a button or a swipe.
    onOpen: async (id, pane) => {
      const target = pane === undefined ? focused : pane;
      await openInto(target, id);
      if (pane !== undefined) { panes.goTo(target); setFocus(target); editors[target].focus(); }
    },
    onNew: folderId => newNote(folderId),
    onNewFolder: name => newFolder(name),
  });

  $('#signout').onclick = async () => { await auth.signOut(); location.reload(); };

  sync.onState(s => { $('#pip').dataset.s = s; });

  // A pull that changed something has to reach the screen. The list is cheap to
  // repaint; an open editor is not, because reloading it destroys the caret and can
  // clobber text that has not reached storage yet. So a pane is only reloaded when it
  // is showing one of the changed notes AND nobody is mid-edit in it.
  sync.onChange(async ids => {
    await refresh();
    for (const i of [0, 1]) {
      const id = openIds[i];
      if (!id || !ids.includes(id)) continue;
      if (isEditingIn(i)) continue;
      const n = await get(NOTES, id);
      if (!n) continue;
      editors[i].load(id, coerce(n.doc));
      topbar.setTitle(i, n.title);
    }
  });

  sync.start();
  // Live sync needs the user's own JWT: a private channel authorises against
  // auth.uid(), and the publishable key is silently ignored as an access token.
  sync.startLive({ getToken: auth.getToken, userId: () => (auth.current() || {}).user_id });

  // Snapshots. The scheduler is started here rather than at module load because it
  // needs a signed-in session to be worth anything — an unauthenticated RPC just 401s.
  $('#backups').onclick = () => mountBackups($('#backups-panel'), { onRestored });
  backup.onState(s => {
    // A backup that cannot run must not be silent. It is the one feature whose whole
    // value is that it already happened by the time you need it, so a failure that
    // only shows up when you go looking is a failure you find too late.
    if (!s.ok) console.warn('[backup]', s.notInstalled ? 'SQL not installed' : s.error);
  });
  backup.start();

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
  setFocus(0);          // header's current segment must agree with the caret
  editors[0].focus();
  sync.flush();
}

// The focused pane is what the header's "current" segment marks and what New Note
// acts on, so every route that changes it goes through here rather than assigning
// `focused` in four places that can drift.
function setFocus(i) {
  focused = i;
  topbar.setActive(i);
  if (footer) footer.sync();
}

// After a restore every note may have changed, both panes may be showing a note that
// is now different, and the local IndexedDB is stale. Pulling and then reloading is
// cheaper to get right than reconciling two open editors in place — and a restore is
// a deliberate act, so the reload costs nothing anyone is in the middle of.
async function onRestored() {
  await sync.pull();
  location.reload();
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
  topbar.setTitle(i, n.title);
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
// A COUNTER IS THE WRONG SHAPE HERE. Every keystroke calls persist(), which clears the
// previous debounce timer and sets a new one — so N keystrokes incremented N times but
// only the LAST timer ever fired and decremented once. The counter leaked upward and
// never returned to zero, which is the second reason busy() was permanently true.
// One flag per pane: set when a save is scheduled, cleared when it completes.
const savePending = [false, false];
let dragging = false;

// ⚠ REGRESSION FIXED 2026-09-17, and it is the exact failure GUIDE §7.4 warns about.
// The first version counted "the caret is inside a .txt" as busy. In a NOTES APP the
// editor is focused from boot — startApp() focuses it deliberately — so busy() was
// true forever, the idle gate never opened, the handover never fired, and THE APP
// COULD NEVER UPDATE ITSELF. Symptom: a fix is provably live on the server and a hard
// refresh does not bring it, because the precache-first worker keeps serving the old
// build and nothing ever tells it to step aside.
//
// The rule in §7.4 is "enumerate what a reload would destroy". A caret POSITION is
// cheap and is destroyed by any reload anyway. What is expensive is an edit that has
// not reached storage yet, a gesture in flight, and a selection being made. Write the
// predicate from THOSE.
let lastKeystroke = 0;
const TYPING_GRACE_MS = 1500;
document.addEventListener('input', () => { lastKeystroke = Date.now(); }, true);

/** True when pane i holds work a reload or a reload-in-place would destroy. */
function isEditingIn(i) {
  if (savePending[i]) return true;
  if (focused === i && Date.now() - lastKeystroke < TYPING_GRACE_MS) return true;
  return false;
}

function isBusy() {
  if (savePending.some(Boolean)) return true;                   // an edit has not reached storage
  if (dragging || (window.UPDATE && window.UPDATE.__dragging)) return true;  // DOM-only gesture
  if (Date.now() - lastKeystroke < TYPING_GRACE_MS) return true; // mid-sentence
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) return true;    // a selection being made
  const s = document.getElementById('search');
  if (s && s.value.trim()) return true;                          // a search they would lose
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
  topbar.setTitle(i, title);
  clearTimeout(saveTimers[i]);
  savePending[i] = true;
  saveTimers[i] = setTimeout(async () => {
    savePending[i] = false;
    const n = await get(NOTES, id);
    if (!n) return;
    n.doc = doc;
    n.title = title;
    await sync.saveLocal(n);
    // THE SAME NOTE OPEN IN BOTH PANES. Only the title was being mirrored, so the
    // other pane kept rendering a document that no longer existed — and worse, its
    // own next save would write that stale copy back over this one. Not a display
    // bug: a way to lose text on ONE device with no network involved.
    // The doc is cloned rather than shared; two editors holding one mutable object
    // would each apply their own edits to the other's state.
    const other = i === 0 ? 1 : 0;
    if (openIds[other] === id) {
      topbar.setTitle(other, title);
      if (!isEditingIn(other)) editors[other].load(id, coerce(JSON.parse(JSON.stringify(doc))));
    }
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
