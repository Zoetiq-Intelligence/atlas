// footer.js — two rows of little buttons, everything flat.
//
// XENO's rule: every control exposed, nothing behind a layer or a menu. If a control
// would need a submenu, the control is wrong. Rows scroll horizontally rather than
// collapsing into a "more" button.
//
// The button list is NOT declared here any more. It is rendered from
// editor/commands.js, which is also what the selection menu and the keymap render
// from — that is what makes the three-way parity structural instead of a promise.
// Every button's tooltip prints its shortcut, so the keymap documents itself.

import { COMMANDS, GROUPS, keyHint, run, isOn } from '../editor/commands.js';
import { attach as tip } from './tooltip.js';

// Two rows, split by key group. Marks and actions on top (what you reach for mid
// sentence), structure underneath.
const LAYOUT = [
  ['asdf', '5tgb'],
  ['1234', 'qwer', 'zxcv'],
];

export function createFooter(root, getEditor, host = {}) {
  root.textContent = '';

  const rows = LAYOUT.map(groups => {
    const row = document.createElement('div');
    row.className = 'frow';
    groups.forEach((g, gi) => {
      if (gi > 0) { const s = document.createElement('span'); s.className = 'fsep'; row.appendChild(s); }
      for (const c of COMMANDS.filter(x => x.group === g)) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'fbtn';
        el.innerHTML = c.html;
        el.dataset.id = c.id;
        el.dataset.k = c.kind;
        el.dataset.v = String(c.value);
        el.setAttribute('aria-label', `${c.label} (${keyHint(c)})`);
        tip(el, `${c.label} · ${keyHint(c)}`);
        row.appendChild(el);
      }
    });
    root.appendChild(row);
    return row;
  });

  // pointerdown, not click: the editor must never lose its selection
  root.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.fbtn');
    if (!btn) return;
    e.preventDefault();
    const ed = getEditor();
    if (!ed) return;
    run(COMMANDS.find(c => c.id === btn.dataset.id), ed, host);
    sync();
  });

  function sync() {
    const ed = getEditor();
    const st = ed ? ed.state() : { type: null, marks: new Set() };
    for (const row of rows) {
      for (const btn of row.querySelectorAll('.fbtn')) {
        const c = COMMANDS.find(x => x.id === btn.dataset.id);
        btn.setAttribute('aria-pressed', isOn(c, st) ? 'true' : 'false');
      }
    }
  }

  return { sync };
}
