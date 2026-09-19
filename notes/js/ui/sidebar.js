// sidebar.js — the slide-over list. Panes are always notes; this overlays and
// dismisses when you start writing.
//
// Search is client-side over the loaded notes: one user, hundreds of notes,
// instant, no network. A tsvector column is the v1 move, not the v0 one.

import { plainText, coerce } from '../model/doc.js';
import { DUR } from './motion.js';

const PLUS = '<svg viewBox="0 0 20 20" aria-hidden="true" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round"><path d="M10 4v12M4 10h12"/></svg>';

export function createSidebar(el, scrim, { onOpen, onNew, onNewFolder }) {
  const listEl = el.querySelector('#list');
  const foldersEl = el.querySelector('#folders');
  const searchEl = el.querySelector('#search');
  el.querySelector('#new').innerHTML = PLUS;

  let notes = [], folders = [], folderId = null, currentId = null, q = '';
  // Which pane a plain title tap fills. Always set by whoever opened the list, so
  // it is never inherited from an earlier interaction.
  let dest = 0;
  const destEl = el.querySelector('#dest');

  function preview(n) {
    const body = plainText(coerce(n.doc)).split('\n').slice(1).join(' ').trim();
    return body || 'No additional text';
  }

  function matches(n) {
    if (folderId && n.folder_id !== folderId) return false;
    if (!q) return true;
    const hay = (n.title + ' ' + plainText(coerce(n.doc))).toLowerCase();
    return hay.includes(q);
  }

  function paintFolders() {
    foldersEl.textContent = '';
    const mk = (id, name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', folderId === id ? 'true' : 'false');
      b.onclick = () => { folderId = id; paintFolders(); paintList(); };
      return b;
    };
    foldersEl.appendChild(mk(null, 'All'));
    folders.forEach(f => foldersEl.appendChild(mk(f.id, f.name)));
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ Folder';
    add.onclick = () => { const n = prompt('Folder name'); if (n && n.trim()) onNewFolder(n.trim()); };
    foldersEl.appendChild(add);
  }

  function paintList() {
    const rows = notes.filter(matches);
    listEl.textContent = '';
    if (!rows.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = q ? 'Nothing matches.' : 'No notes yet.';
      listEl.appendChild(d);
      return;
    }
    for (const n of rows) {
      listEl.appendChild(makeRow(n));
    }
  }

  // A row names its destination explicitly. Opening used to land in "whichever pane
  // you touched last", which is state the list does not show and the user has to
  // remember — so the same tap meant different things a minute apart.
  const SEND = { 0: { label: 'Open left', glyph: '◧' }, 1: { label: 'Open right', glyph: '◨' } };

  function send(id, pane) { onOpen(id, pane === undefined ? dest : pane); close(); }

  function makeRow(n) {
    const row = document.createElement('div');
    row.className = 'nrow';
    row.dataset.id = n.id;
    if (n.id === currentId) row.setAttribute('aria-current', 'true');

    // The row's own surface is the button: nested buttons are invalid, so the main
    // target and the two destinations are siblings inside a plain container.
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'nmain';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = (n.pinned ? '★ ' : '') + (n.title || 'New Note');
    const s = document.createElement('span');
    s.className = 's';
    s.textContent = preview(n);
    main.append(t, s);
    main.onclick = () => send(n.id, undefined);      // undefined = this list's pane

    const acts = document.createElement('span');
    acts.className = 'nacts';
    for (const pane of [0, 1]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nsend';
      b.dataset.pane = String(pane);
      b.setAttribute('aria-label', SEND[pane].label + ': ' + (n.title || 'New Note'));
      b.title = SEND[pane].label;
      b.textContent = SEND[pane].glyph;
      b.onclick = e => { e.stopPropagation(); send(n.id, pane); };
      acts.appendChild(b);
    }

    row.append(main, acts);
    attachSwipe(row, n.id);
    return row;
  }

  // ---- swipe a row to send it --------------------------------------------
  //
  // The list scrolls vertically and sits inside a slide-over, so a horizontal drag on
  // a row has three possible owners. The answer in this app is always touch-action
  // rather than a JS gesture arbiter: the row is pan-y, so the browser keeps vertical
  // scrolling for itself and hands us anything horizontal. Same split as .editor
  // (pan-y) against the edge strips (pan-x).
  const THRESHOLD = 56;

  function attachSwipe(row, id) {
    let startX = 0, startY = 0, dx = 0, dragging = false, decided = false;

    const reset = () => {
      row.style.transition = `transform var(--dur) var(--ease-smoother)`;
      row.style.transform = '';
      row.classList.remove('swiping', 'to-left', 'to-right');
      setTimeout(() => { row.style.transition = ''; }, 180);
    };

    row.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      dx = 0; dragging = true; decided = false;
    });

    row.addEventListener('pointermove', e => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (!decided) {
        // Let a clearly vertical drag go back to the scroller untouched.
        if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > 6) { dragging = false; return; }
        if (Math.abs(mx) < 6) return;
        decided = true;
        row.classList.add('swiping');
        try { row.setPointerCapture(e.pointerId); } catch { /* not required */ }
      }
      dx = mx;
      row.style.transform = `translateX(${dx.toFixed(1)}px)`;
      row.classList.toggle('to-left', dx <= -THRESHOLD);
      row.classList.toggle('to-right', dx >= THRESHOLD);
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      if (!decided) return;
      const go = dx <= -THRESHOLD ? 0 : dx >= THRESHOLD ? 1 : null;
      reset();
      if (go !== null) send(id, go);
    };
    row.addEventListener('pointerup', finish);
    row.addEventListener('pointercancel', () => { dragging = false; reset(); });
  }

  searchEl.addEventListener('input', () => { q = searchEl.value.trim().toLowerCase(); paintList(); });
  el.querySelector('#new').onclick = () => { onNew(folderId); close(); };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) close(); });

  function paintDest() {
    destEl.hidden = false;
    destEl.textContent = dest === 0 ? 'Opening into the left pane' : 'Opening into the right pane';
  }

  function open() { el.hidden = false; scrim.hidden = false; requestAnimationFrame(() => el.classList.add('open')); }
  function close() {
    el.classList.remove('open');
    scrim.hidden = true;
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, DUR);
  }

  return {
    open, close,
    /** Open the list bound to a pane. Every entry point names its destination. */
    openFor(pane) {
      dest = pane === undefined ? dest : pane;
      paintDest();
      if (el.hidden) open();
    },
    toggle: () => (el.hidden ? open() : close()),
    set(n, f, cur) { notes = n; folders = f; currentId = cur; paintFolders(); paintList(); },
    current(id) { currentId = id; paintList(); },
  };
}
