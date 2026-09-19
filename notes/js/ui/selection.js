// selection.js — the menu that appears when you select text.
//
// "a selection menu when we select text" — explicitly NOT the right-click menu. This
// one is triggered by there being a selection at all, which is why it is a separate
// surface from the context menu (whose ruling stands: suppress the native one on
// Windows, supplement on iOS).
//
// It renders from editor/commands.js, so it carries every command the footer does —
// that is the parity requirement, and it holds by construction rather than by anyone
// remembering to add a case in two places.
//
// On iOS the system's own callout appears for a selection too. The menu is offset to
// sit ABOVE the selection with a gap, which is where the system callout is not, so
// the two supplement rather than collide — the 09-17 ruling.

import { COMMANDS, GROUPS, keyHint, run, isOn } from '../editor/commands.js';

const CALLOUT_GAP = 44;   // room for the iOS system callout, which we do not replace

export function createSelectionMenu(root, getEditor, host = {}) {
  root.textContent = '';
  root.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'selbar';
  root.appendChild(bar);

  const buttons = [];
  GROUPS.forEach((g, gi) => {
    if (gi > 0) { const s = document.createElement('span'); s.className = 'fsep'; bar.appendChild(s); }
    for (const c of COMMANDS.filter(x => x.group === g)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'selbtn';
      b.innerHTML = c.html;
      b.dataset.id = c.id;
      b.setAttribute('aria-label', `${c.label} (${keyHint(c)})`);
      b.title = `${c.label} · ${keyHint(c)}`;
      bar.appendChild(b);
      buttons.push(b);
    }
  });

  // pointerdown and preventDefault, or the act of pressing a button collapses the
  // selection the button is about to act on.
  bar.addEventListener('pointerdown', e => {
    const b = e.target.closest('.selbtn');
    if (!b) return;
    e.preventDefault();
    const ed = getEditor();
    if (!ed) return;
    run(COMMANDS.find(c => c.id === b.dataset.id), ed, host);
    paint();
  });

  function paint() {
    const ed = getEditor();
    const st = ed ? ed.state() : null;
    for (const b of buttons) {
      const c = COMMANDS.find(x => x.id === b.dataset.id);
      b.setAttribute('aria-pressed', isOn(c, st) ? 'true' : 'false');
    }
  }

  function place() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return hide();
    const r = sel.getRangeAt(0);
    let rect = r.getBoundingClientRect();
    // A collapsed-looking rect happens mid-drag; fall back to the anchor element.
    if (!rect || (!rect.width && !rect.height)) {
      const n = sel.anchorNode;
      const el = n && (n.nodeType === 1 ? n : n.parentElement);
      if (!el) return hide();
      rect = el.getBoundingClientRect();
    }
    root.hidden = false;
    const mw = root.getBoundingClientRect().width || 280;
    let left = rect.left + rect.width / 2 - mw / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - mw - 6));
    const h = root.getBoundingClientRect().height || 40;
    let top = rect.top - h - CALLOUT_GAP;
    if (top < 6) top = rect.bottom + CALLOUT_GAP;      // no room above: go below
    root.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    root.classList.add('on');
    paint();
  }

  function hide() { root.classList.remove('on'); root.hidden = true; }

  function update() {
    const sel = window.getSelection();
    const ed = getEditor();
    if (!ed || !sel || sel.isCollapsed || !sel.rangeCount) return hide();
    // Only for selections inside an editor: selecting the build id should not raise
    // a formatting menu.
    const n = sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (!el || !el.closest('.txt')) return hide();
    place();
  }

  document.addEventListener('selectionchange', update);
  window.addEventListener('scroll', () => { if (!root.hidden) update(); }, true);
  window.addEventListener('resize', () => { if (!root.hidden) update(); });

  return { update, hide };
}
