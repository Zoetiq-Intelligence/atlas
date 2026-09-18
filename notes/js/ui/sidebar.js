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
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nrow';
      if (n.id === currentId) b.setAttribute('aria-current', 'true');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = (n.pinned ? '★ ' : '') + (n.title || 'New Note');
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = preview(n);
      b.append(t, s);
      b.onclick = () => { onOpen(n.id); close(); };
      listEl.appendChild(b);
    }
  }

  searchEl.addEventListener('input', () => { q = searchEl.value.trim().toLowerCase(); paintList(); });
  el.querySelector('#new').onclick = () => { onNew(folderId); close(); };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) close(); });

  function open() { el.hidden = false; scrim.hidden = false; requestAnimationFrame(() => el.classList.add('open')); }
  function close() {
    el.classList.remove('open');
    scrim.hidden = true;
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, DUR);
  }

  return {
    open, close,
    toggle: () => (el.hidden ? open() : close()),
    set(n, f, cur) { notes = n; folders = f; currentId = cur; paintFolders(); paintList(); },
    current(id) { currentId = id; paintList(); },
  };
}
