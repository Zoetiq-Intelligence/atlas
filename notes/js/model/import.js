// import.js — plain text in, a note out, and not one character lost.
//
// The operator's requirement for bringing his iOS Notes across: "without losing a
// single sentence of what I've said." So this module promises something stronger
// and checks it: plainText(doc) is EXACTLY the file's text, line for line, after
// exactly one normalisation — line terminators.
//
// What that normalisation is, precisely, because it is the only change made:
//   * CRLF and lone CR become LF. iOS Notes exports every line as CRLF; split on LF
//     alone and every line keeps an invisible \r, which then rides along in every
//     save, every search and every copy forever.
//   * ONE trailing terminator is dropped. A file ending in "\r\n" ends its last line
//     there; it does not contain an extra empty line after it.
// Nothing else is touched: leading tabs, whitespace-only lines, emoji variation
// selectors, runs of blank lines — all of it is the operator's own formatting.
//
// One block per line, all body text. Structure (lists, checkboxes) is deliberately
// NOT inferred here: an import is the untouched record, and any formatting belongs to
// a derived note that can be regenerated from this one as often as wanted.

import { newDoc, newBlock, plainText, titleOf, coerce } from './doc.js';
import { isOpaque } from './schema.js';

/** The file's text exactly as lines, with terminators normalised and nothing else. */
export function splitLines(text) {
  const t = String(text).replace(/\r\n?/g, '\n');
  const body = t.endsWith('\n') ? t.slice(0, -1) : t;
  return body.split('\n');
}

/**
 * @param {string} text   the file's contents
 * @param {{suffix?: string}} opts
 *   suffix — appended to the title line, e.g. "(OLD)". The title is the first
 *   non-blank line, which is also the first thing the app shows, so marking it there
 *   is what makes the mark stick; a title column edited on its own is recomputed from
 *   the document on the next save.
 * @returns {{doc, title, lines:number, expected:string}}
 */
export function textToDoc(text, { suffix = '' } = {}) {
  const lines = splitLines(text);
  const sfx = String(suffix || '').trim();
  if (sfx) {
    const i = lines.findIndex(l => l.trim() !== '');
    if (i >= 0) lines[i] = lines[i] + ' ' + sfx;
  }
  const doc = newDoc(lines.map(l => newBlock('p', l)));
  const expected = lines.join('\n');
  // The promise, checked rather than intended. A mismatch here means a block type or
  // the model rewrote something, and an import that cannot prove itself is refused.
  if (plainText(doc) !== expected) {
    throw new Error('import would alter the text — refused');
  }
  return { doc, title: titleOf(doc), lines: lines.length, expected };
}

// ---------------------------------------------------------------- structured

/**
 * A `.atlasnote.json` file: { atlas: "note", v: 1, title, doc } — the app's own document
 * format, which can carry structure (checkboxes, bullets, hyphens) that a .txt cannot.
 * Written by tools/merge-notes.mjs.
 *
 * Same promise as a text import, checked the same way: the document must come through
 * coerce() — what every load does to stored data — with every block's type, text,
 * depth and checked state unchanged, or the import is refused.
 */
export function isNoteFile(name, text) {
  return /\.atlasnote\.json$/i.test(name || '') || /^\s*\{\s*"atlas"\s*:\s*"note"/.test(text || '');
}

export function jsonToDoc(text, { suffix = '' } = {}) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('not a readable note file'); }
  if (!raw || raw.atlas !== 'note' || !raw.doc || !Array.isArray(raw.doc.blocks)) {
    throw new Error('not an Atlas note file');
  }
  const doc = coerce(raw.doc);
  const sig = d => d.blocks.map(b => (b ? [b.t, b.text, b.depth || 0, !!b.done].join('\u0001') : ''));
  const want = sig(raw.doc), got = sig(doc);
  if (want.length !== got.length || want.some((x, i) => x !== got[i])) {
    throw new Error('import would alter the note — refused');
  }
  const sfx = String(suffix || '').trim();
  if (sfx) {
    const b = doc.blocks.find(x => !isOpaque(x) && (x.text || '').trim());   // never rewrite a newer build's block
    if (b) b.text = b.text + ' ' + sfx;
  }
  return { doc, title: titleOf(doc), lines: doc.blocks.length, expected: plainText(doc) };
}
