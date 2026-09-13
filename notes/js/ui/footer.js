// footer.js — two rows of little buttons, everything flat.
//
// XENO's rule: every control exposed, nothing behind a layer or a menu. If a
// control would need a submenu, the control is wrong. Rows scroll horizontally
// rather than collapsing into a "more" button.

const svg = d => `<svg viewBox="0 0 20 20" aria-hidden="true">${d}</svg>`;

const UNDO = svg('<path d="M7 4 3 8l4 4"/><path d="M3 8h8a5 5 0 0 1 0 10H8"/>');
const REDO = svg('<path d="M13 4l4 4-4 4"/><path d="M17 8H9a5 5 0 0 0 0 10h3"/>');
const OUT  = svg('<path d="M9 5h8M9 10h8M9 15h8"/><path d="M6 7 3 10l3 3"/>');
const IN   = svg('<path d="M9 5h8M9 10h8M9 15h8"/><path d="M3 7l3 3-3 3"/>');
const BUL  = svg('<circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="14" r="1.5" fill="currentColor" stroke="none"/><path d="M8 6h9M8 14h9"/>');
const CHK  = svg('<path d="M2 6.5 4 8.5 7.5 4.5"/><path d="M2 14.5 4 16.5 7.5 12.5"/><path d="M11 6.5h7M11 14.5h7"/>');

const ROW1 = [
  { k: 'mark', v: 'b',    html: '<b>B</b>',   t: 'Bold' },
  { k: 'mark', v: 'i',    html: '<i>I</i>',   t: 'Italic' },
  { k: 'mark', v: 'u',    html: '<u>U</u>',   t: 'Underline' },
  { k: 'mark', v: 's',    html: '<s>S</s>',   t: 'Strikethrough' },
  { k: 'mark', v: 'code', html: '<code style="font:600 12px var(--mono)">M</code>', t: 'Mono' },
  { sep: true },
  { k: 'cmd',  v: 'undo', html: UNDO, t: 'Undo' },
  { k: 'cmd',  v: 'redo', html: REDO, t: 'Redo' },
];

const ROW2 = [
  { k: 'block', v: 'h1',    html: '<span style="font:700 14px/1 var(--font)">T</span>',  t: 'Title' },
  { k: 'block', v: 'h2',    html: '<span style="font:700 12px/1 var(--font)">H</span>',  t: 'Heading' },
  { k: 'block', v: 'h3',    html: '<span style="font:600 11px/1 var(--font)">h</span>',  t: 'Subheading' },
  { k: 'block', v: 'p',     html: '<span style="font:400 14px/1 var(--font)">&para;</span>', t: 'Body' },
  { sep: true },
  { k: 'block', v: 'li',    html: BUL, t: 'Bulleted' },
  { k: 'block', v: 'ol',    html: '<span style="font:600 11px/1 var(--mono)">1.</span>', t: 'Numbered' },
  { k: 'block', v: 'check', html: CHK, t: 'Checklist' },
  { sep: true },
  { k: 'block', v: 'quote', html: '<span style="font:700 15px/1 Georgia,serif">&ldquo;</span>', t: 'Quote' },
  { k: 'block', v: 'code',  html: '<span style="font:600 11px/1 var(--mono)">{ }</span>', t: 'Code block' },
  { sep: true },
  { k: 'nudge', v: -1, html: OUT, t: 'Outdent' },
  { k: 'nudge', v:  1, html: IN,  t: 'Indent' },
];

export function createFooter(root, getEditor) {
  const rows = [ROW1, ROW2].map(spec => {
    const row = document.createElement('div');
    row.className = 'frow';
    for (const b of spec) {
      if (b.sep) { const s = document.createElement('span'); s.className = 'fsep'; row.appendChild(s); continue; }
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'fbtn';
      el.innerHTML = b.html;
      el.title = b.t;
      el.setAttribute('aria-label', b.t);
      el.dataset.k = b.k;
      el.dataset.v = String(b.v);
      row.appendChild(el);
    }
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
    const { k, v } = btn.dataset;
    if (k === 'mark')  ed.mark(v);
    else if (k === 'block') ed.block(v);
    else if (k === 'nudge') ed.nudge(Number(v));
    else if (v === 'undo')  ed.undo();
    else if (v === 'redo')  ed.redo();
    sync();
  });

  function sync() {
    const ed = getEditor();
    const st = ed ? ed.state() : { type: null, marks: new Set() };
    for (const row of rows) {
      for (const btn of row.querySelectorAll('.fbtn')) {
        const { k, v } = btn.dataset;
        let on = false;
        if (k === 'mark') on = st.marks.has(v);
        else if (k === 'block') on = st.type === v;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  return { sync };
}
