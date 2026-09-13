// doc.js — the block document.
//
// A note's body is { v, blocks: [...] } stored as jsonb. Never HTML.
// contenteditable HTML is browser output, and Safari and Chrome produce
// different output; storing it means parsing browser quirks forever. This model
// round-trips exactly, and a v1 table is a block whose cells hold block arrays —
// a recursion of what is already here, not a parser. See DESIGN.md §3.
//
// A block:
//   { id, t, text, marks?: [[start, end, type, value?]], done?: bool, depth?: int }
//
// Marks are half-open ranges [start, end) over the block's own text. They are
// normalised after every mutation: sorted, merged when adjacent and identical,
// and dropped when empty.

import { DOC_VERSION, BLOCK_TYPES, LIST_TYPES } from './schema.js';

let counter = 0;
export function uid() {
  counter = (counter + 1) % 46656;
  return Date.now().toString(36).slice(-6) + counter.toString(36).padStart(3, '0');
}

export function newBlock(t = 'p', text = '', extra = {}) {
  const b = { id: uid(), t, text, marks: [] };
  if (t === 'check') b.done = false;
  if (LIST_TYPES.has(t)) b.depth = 0;
  return Object.assign(b, extra);
}

export function newDoc(blocks) {
  return { v: DOC_VERSION, blocks: blocks && blocks.length ? blocks : [newBlock()] };
}

export function indexOf(doc, blockId) {
  return doc.blocks.findIndex(b => b.id === blockId);
}

export function blockById(doc, blockId) {
  return doc.blocks.find(b => b.id === blockId) || null;
}

/** First non-empty line of text, used for the denormalised `title` column. */
export function titleOf(doc) {
  for (const b of doc.blocks) {
    const t = (b.text || '').trim();
    if (t) return t.slice(0, 120);
  }
  return '';
}

/** Everything typed, for client-side search. */
export function plainText(doc) {
  return doc.blocks.map(b => b.text || '').join('\n');
}

// ---------------------------------------------------------------------------
// marks
// ---------------------------------------------------------------------------

function normalise(marks, textLen) {
  const out = [];
  for (let m of marks) {
    let [a, b, t, v] = m;
    a = Math.max(0, Math.min(a, textLen));
    b = Math.max(0, Math.min(b, textLen));
    if (b <= a) continue;
    out.push(v === undefined ? [a, b, t] : [a, b, t, v]);
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : 1));

  // merge adjacent/overlapping ranges of the same type and value
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last[2] === m[2] && last[3] === m[3] && m[0] <= last[1]) {
      last[1] = Math.max(last[1], m[1]);
    } else {
      merged.push(m.slice());
    }
  }
  return merged;
}

export function marksAt(block, pos) {
  const active = new Set();
  for (const [a, b, t] of block.marks || []) {
    if (pos > a && pos <= b) active.add(t);
  }
  return active;
}

export function hasMarkOver(block, start, end, type) {
  if (start === end) return marksAt(block, start).has(type);
  // true only if the whole range is covered
  let cursor = start;
  for (const [a, b, t] of (block.marks || []).filter(m => m[2] === type).sort((x, y) => x[0] - y[0])) {
    if (b <= cursor) continue;
    if (a > cursor) return false;
    cursor = b;
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

/** Add or remove `type` across [start, end). Returns a new marks array. */
export function toggleMark(block, start, end, type, value) {
  if (start === end) return block.marks || [];
  const on = hasMarkOver(block, start, end, type);
  const kept = [];
  for (const m of block.marks || []) {
    const [a, b, t, v] = m;
    if (t !== type) { kept.push(m); continue; }
    // subtract [start,end) from this range; the surviving pieces are re-added
    if (b <= start || a >= end) { kept.push(m); continue; }
    if (a < start) kept.push(v === undefined ? [a, start, t] : [a, start, t, v]);
    if (b > end) kept.push(v === undefined ? [end, b, t] : [end, b, t, v]);
  }
  if (!on) kept.push(value === undefined ? [start, end, type] : [start, end, type, value]);
  return normalise(kept, block.text.length);
}

/**
 * Text changed underneath us — the browser typed into the block and we are
 * reconciling rather than having controlled the keystroke (DESIGN.md §4).
 * Shift marks to follow the edit.
 */
export function reconcileText(block, newText) {
  const oldText = block.text;
  if (oldText === newText) return block.marks || [];

  // common prefix / suffix
  const maxP = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < maxP && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < maxP - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;

  const start = p;
  const endOld = oldText.length - s;
  const endNew = newText.length - s;
  const delta = endNew - endOld;

  const mapStart = pos => (pos <= start ? pos : pos >= endOld ? pos + delta : start);
  const mapEnd = pos => (pos <= start ? pos : pos >= endOld ? pos + delta : endNew);

  const moved = (block.marks || []).map(m => {
    const out = [mapStart(m[0]), mapEnd(m[1]), m[2]];
    if (m[3] !== undefined) out.push(m[3]);
    return out;
  });
  return normalise(moved, newText.length);
}

// ---------------------------------------------------------------------------
// structure — every one of these is an operation we control, never the browser
// ---------------------------------------------------------------------------

/** Split at `offset`. Returns the id of the new block to put the caret in. */
export function splitBlock(doc, blockId, offset) {
  const i = indexOf(doc, blockId);
  if (i < 0) return null;
  const b = doc.blocks[i];

  // Enter on an empty list item exits the list rather than making another one.
  if (LIST_TYPES.has(b.t) && b.text.length === 0) {
    b.t = 'p';
    delete b.done;
    delete b.depth;
    b.marks = [];
    return b.id;
  }

  const head = b.text.slice(0, offset);
  const tail = b.text.slice(offset);
  const spec = BLOCK_TYPES[b.t] || BLOCK_TYPES.p;
  const nextType = offset >= b.text.length ? (spec.enterTo || b.t) : b.t;

  const next = newBlock(nextType, tail);
  if (LIST_TYPES.has(nextType) && LIST_TYPES.has(b.t)) next.depth = b.depth || 0;

  // marks that fall after the split move to the new block, rebased
  const headMarks = [];
  const tailMarks = [];
  for (const m of b.marks || []) {
    const [a, e, t, v] = m;
    if (e <= offset) headMarks.push(m);
    else if (a >= offset) tailMarks.push(v === undefined ? [a - offset, e - offset, t] : [a - offset, e - offset, t, v]);
    else {
      headMarks.push(v === undefined ? [a, offset, t] : [a, offset, t, v]);
      tailMarks.push(v === undefined ? [0, e - offset, t] : [0, e - offset, t, v]);
    }
  }
  b.text = head;
  b.marks = normalise(headMarks, head.length);
  next.marks = normalise(tailMarks, tail.length);

  doc.blocks.splice(i + 1, 0, next);
  return next.id;
}

/**
 * Backspace at offset 0. iOS Notes converts a styled block to body first and
 * only merges on the second press — same here, so a list item is never
 * destroyed by one keystroke.
 * Returns { blockId, offset } for the caret, or null if nothing happened.
 */
export function mergeBackward(doc, blockId) {
  const i = indexOf(doc, blockId);
  if (i < 0) return null;
  const b = doc.blocks[i];

  if (LIST_TYPES.has(b.t) && (b.depth || 0) > 0) {
    b.depth -= 1;
    return { blockId: b.id, offset: 0 };
  }
  if (b.t !== 'p') {
    b.t = 'p';
    delete b.done;
    delete b.depth;
    return { blockId: b.id, offset: 0 };
  }
  if (i === 0) return null;

  const prev = doc.blocks[i - 1];
  const at = prev.text.length;
  const shifted = (b.marks || []).map(m => {
    const out = [m[0] + at, m[1] + at, m[2]];
    if (m[3] !== undefined) out.push(m[3]);
    return out;
  });
  prev.text += b.text;
  prev.marks = normalise([...(prev.marks || []), ...shifted], prev.text.length);
  doc.blocks.splice(i, 1);
  return { blockId: prev.id, offset: at };
}

/** Delete at end of a block — pull the next one up into it. */
export function mergeForward(doc, blockId) {
  const i = indexOf(doc, blockId);
  if (i < 0 || i === doc.blocks.length - 1) return null;
  const b = doc.blocks[i];
  const next = doc.blocks[i + 1];
  const at = b.text.length;
  const shifted = (next.marks || []).map(m => {
    const out = [m[0] + at, m[1] + at, m[2]];
    if (m[3] !== undefined) out.push(m[3]);
    return out;
  });
  b.text += next.text;
  b.marks = normalise([...(b.marks || []), ...shifted], b.text.length);
  doc.blocks.splice(i + 1, 1);
  return { blockId: b.id, offset: at };
}

export function setType(doc, blockId, t) {
  const b = blockById(doc, blockId);
  if (!b) return;
  // toggling a list type off returns to body — matches the footer being a set
  // of toggles rather than a menu
  b.t = b.t === t ? 'p' : t;
  if (b.t === 'check' && b.done === undefined) b.done = false;
  if (b.t !== 'check') delete b.done;
  if (LIST_TYPES.has(b.t)) { if (b.depth === undefined) b.depth = 0; }
  else delete b.depth;
  if (BLOCK_TYPES[b.t]?.plain) b.marks = [];
}

export function indent(doc, blockId, dir) {
  const b = blockById(doc, blockId);
  if (!b || !LIST_TYPES.has(b.t)) return false;
  const i = indexOf(doc, blockId);
  const prev = doc.blocks[i - 1];
  const max = prev && LIST_TYPES.has(prev.t) ? (prev.depth || 0) + 1 : 0;
  const next = Math.max(0, Math.min((b.depth || 0) + dir, max));
  if (next === b.depth) return false;
  b.depth = next;
  return true;
}

/** Insert text at a caret — used by paste, which we always control. */
export function insertText(doc, blockId, offset, text) {
  const b = blockById(doc, blockId);
  if (!b) return null;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length === 1) {
    b.text = b.text.slice(0, offset) + text + b.text.slice(offset);
    b.marks = reconcileTextAfterInsert(b, offset, text.length);
    return { blockId, offset: offset + text.length };
  }
  const tailId = splitBlock(doc, blockId, offset);
  const first = blockById(doc, blockId);
  first.text += lines[0];
  let at = indexOf(doc, blockId);
  let lastId = blockId;
  for (let k = 1; k < lines.length; k++) {
    const nb = newBlock(k === lines.length - 1 ? 'p' : 'p', lines[k]);
    doc.blocks.splice(++at, 0, nb);
    lastId = nb.id;
  }
  // fold the split tail back onto the final inserted line
  const tail = blockById(doc, tailId);
  if (tail && tailId !== blockId) {
    const last = blockById(doc, lastId);
    const off = last.text.length;
    last.text += tail.text;
    last.marks = normalise([...(last.marks || []), ...(tail.marks || []).map(m => [m[0] + off, m[1] + off, m[2], m[3]].filter(x => x !== undefined))], last.text.length);
    doc.blocks.splice(indexOf(doc, tailId), 1);
    return { blockId: lastId, offset: off };
  }
  return { blockId: lastId, offset: blockById(doc, lastId).text.length };
}

function reconcileTextAfterInsert(block, offset, len) {
  const moved = (block.marks || []).map(m => {
    const a = m[0] >= offset ? m[0] + len : m[0];
    const b = m[1] >= offset ? m[1] + len : m[1];
    const out = [a, b, m[2]];
    if (m[3] !== undefined) out.push(m[3]);
    return out;
  });
  return normalise(moved, block.text.length);
}

export function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

/** Tolerate anything the database hands back, including nulls and old shapes. */
export function coerce(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return newDoc();
  const blocks = raw.blocks
    .filter(b => b && typeof b.text === 'string')
    .map(b => ({
      id: b.id || uid(),
      t: BLOCK_TYPES[b.t] ? b.t : 'p',
      text: b.text,
      marks: normalise(Array.isArray(b.marks) ? b.marks : [], b.text.length),
      ...(b.t === 'check' ? { done: !!b.done } : {}),
      ...(LIST_TYPES.has(b.t) ? { depth: Number(b.depth) || 0 } : {}),
    }));
  return newDoc(blocks);
}
