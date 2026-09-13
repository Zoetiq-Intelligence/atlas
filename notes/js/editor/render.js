// render.js — model to DOM. The only module that builds editor markup.

import { BLOCK_TYPES, LIST_TYPES } from '../model/schema.js';

const CHECK_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.3 4.6 9 10 3"/></svg>';

/** Split text into runs that share the same set of marks. */
export function segments(text, marks) {
  if (!marks || marks.length === 0) return [{ s: 0, e: text.length, types: [], href: null }];
  const pts = new Set([0, text.length]);
  for (const m of marks) {
    if (m[0] > 0 && m[0] < text.length) pts.add(m[0]);
    if (m[1] > 0 && m[1] < text.length) pts.add(m[1]);
  }
  const cuts = [...pts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = cuts[i], e = cuts[i + 1];
    if (e <= s) continue;
    const active = marks.filter(m => m[0] <= s && m[1] >= e);
    out.push({
      s, e,
      types: active.map(m => m[2]),
      href: (active.find(m => m[2] === 'link') || [])[3] || null,
    });
  }
  return out;
}

function fillText(txt, block) {
  txt.textContent = '';
  if (!block.text) return;                       // stays :empty so the placeholder shows
  const segs = segments(block.text, block.marks);
  if (segs.length === 1 && segs[0].types.length === 0) {
    txt.appendChild(document.createTextNode(block.text));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const g of segs) {
    const piece = block.text.slice(g.s, g.e);
    if (g.types.length === 0) { frag.appendChild(document.createTextNode(piece)); continue; }
    const span = document.createElement('span');
    span.className = g.types.map(t => 'm-' + t).join(' ');
    if (g.href) span.dataset.href = g.href;
    span.textContent = piece;
    frag.appendChild(span);
  }
  txt.appendChild(frag);
}

export function renderBlock(block, isFirst) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.id = block.id;
  row.dataset.t = block.t;
  if (LIST_TYPES.has(block.t)) row.dataset.depth = String(block.depth || 0);
  if (block.t === 'check') row.dataset.done = block.done ? '1' : '0';

  if (block.t === 'check') {
    const chk = document.createElement('button');
    chk.className = 'chk';
    chk.type = 'button';
    chk.setAttribute('aria-pressed', block.done ? 'true' : 'false');
    chk.setAttribute('aria-label', 'Toggle');
    chk.innerHTML = CHECK_SVG;
    row.appendChild(chk);
  }

  const txt = document.createElement('div');
  txt.className = 'txt';
  txt.contentEditable = 'true';
  txt.spellcheck = true;
  txt.setAttribute('role', 'textbox');
  if (isFirst) txt.dataset.ph = 'Title';
  else if (BLOCK_TYPES[block.t]?.plain) txt.dataset.ph = 'Code';
  fillText(txt, block);
  row.appendChild(txt);

  return row;
}

/** Repaint a single block in place. Returns the new row element. */
export function repaintBlock(row, block, isFirst) {
  const fresh = renderBlock(block, isFirst);
  row.replaceWith(fresh);
  return fresh;
}

/** Full document render. Only called on load and structural change. */
export function renderDoc(editor, doc) {
  const wrap = document.createElement('div');
  wrap.className = 'doc';
  doc.blocks.forEach((b, i) => wrap.appendChild(renderBlock(b, i === 0)));
  editor.textContent = '';
  editor.appendChild(wrap);
  return wrap;
}

export function rowFor(editor, blockId) {
  return editor.querySelector(`.row[data-id="${CSS.escape(blockId)}"]`);
}
