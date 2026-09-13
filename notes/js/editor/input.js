// input.js — the editor controller. Hybrid input, per DESIGN.md §4.
//
// Plain typing is LEFT TO THE BROWSER and reconciled afterwards, because fully
// intercepting insertText breaks iOS autocorrect, dictation and IME — which on
// the primary target device is the normal typing path, not an edge case.
//
// Structure and formatting are ALWAYS ours: Enter, Backspace-at-0,
// Delete-at-end, bold/italic/underline/strike, paste, indent, undo.
//
// Blocks are separate contenteditables, so the browser will not move the caret
// between them. Arrow navigation across block boundaries is implemented here.

import {
  blockById, indexOf, splitBlock, mergeBackward, mergeForward,
  setType, indent as indentBlock, toggleMark, hasMarkOver, marksAt,
  reconcileText, insertText, clone, newDoc, titleOf,
} from '../model/doc.js';
import { BLOCK_TYPES, LIST_TYPES } from '../model/schema.js';
import { renderDoc, renderBlock, rowFor } from './render.js';
import { getSel, setSel, activeTxt, rowOf } from './caret.js';

const UNDO_COALESCE_MS = 600;
const UNDO_MAX = 120;

export function createEditor(el, { onChange = () => {}, onFocus = () => {} } = {}) {
  let doc = newDoc();
  let noteId = null;
  let undo = [], redo = [], lastSnap = 0;
  let caret = null;   // { blockId, offset } — restored after every structural render

  // ---------------------------------------------------------------- helpers

  const txtFor = id => { const r = rowFor(el, id); return r ? r.querySelector('.txt') : null; };

  function snapshot(force) {
    const now = Date.now();
    if (!force && now - lastSnap < UNDO_COALESCE_MS) return;
    lastSnap = now;
    undo.push(clone(doc));
    if (undo.length > UNDO_MAX) undo.shift();
    redo.length = 0;
  }

  function changed() { onChange(doc, titleOf(doc)); }

  function paint() {
    renderDoc(el, doc);
    if (caret) {
      const t = txtFor(caret.blockId);
      if (t) { t.focus({ preventScroll: true }); setSel(t, caret.offset); scrollCaretIntoView(t); }
    }
  }

  function scrollCaretIntoView(txt) {
    const r = txt.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (r.top < box.top + 8) el.scrollTop -= (box.top + 8 - r.top);
    else if (r.bottom > box.bottom - 8) el.scrollTop += (r.bottom - box.bottom + 8);
  }

  /** Read the DOM back into the model for one block, without re-rendering it. */
  function syncFromDom(txt) {
    const row = rowOf(txt);
    if (!row) return null;
    const b = blockById(doc, row.dataset.id);
    if (!b) return null;
    const next = txt.textContent || '';
    if (next === b.text) return b;
    b.marks = reconcileText(b, next);
    b.text = next;
    if (next === '' && txt.childNodes.length) {
      // the browser leaves a stray <br>/empty node behind; :empty must match
      txt.textContent = '';
      setSel(txt, 0);
    }
    return b;
  }

  function here() {
    const txt = activeTxt(el);
    if (!txt) return null;
    const row = rowOf(txt);
    const b = blockById(doc, row.dataset.id);
    if (!b) return null;
    const sel = getSel(txt) || { start: 0, end: 0, collapsed: true };
    return { txt, row, b, sel };
  }

  // ---------------------------------------------------------------- input

  el.addEventListener('beforeinput', e => {
    const ctx = here();
    if (!ctx) return;
    const { txt, b, sel } = ctx;
    const it = e.inputType;

    // history — always ours, because the browser's stack knows nothing of the model
    if (it === 'historyUndo') { e.preventDefault(); doUndo(); return; }
    if (it === 'historyRedo') { e.preventDefault(); doRedo(); return; }

    if (it === 'insertParagraph') {
      e.preventDefault();
      syncFromDom(txt);
      snapshot(true);
      const newId = splitBlock(doc, b.id, sel.start);
      caret = { blockId: newId, offset: 0 };
      paint(); changed();
      return;
    }

    if (it === 'deleteContentBackward' && sel.collapsed && sel.start === 0) {
      e.preventDefault();
      syncFromDom(txt);
      snapshot(true);
      const r = mergeBackward(doc, b.id);
      if (r) { caret = r; paint(); changed(); }
      return;
    }

    if (it === 'deleteContentForward' && sel.collapsed && sel.start === b.text.length) {
      e.preventDefault();
      syncFromDom(txt);
      snapshot(true);
      const r = mergeForward(doc, b.id);
      if (r) { caret = r; paint(); changed(); }
      return;
    }

    if (it === 'formatBold')          { e.preventDefault(); mark('b'); return; }
    if (it === 'formatItalic')        { e.preventDefault(); mark('i'); return; }
    if (it === 'formatUnderline')     { e.preventDefault(); mark('u'); return; }
    if (it === 'formatStrikeThrough') { e.preventDefault(); mark('s'); return; }

    if (it === 'insertFromPaste') {
      e.preventDefault();
      const text = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (!text) return;
      syncFromDom(txt);
      snapshot(true);
      // a non-collapsed selection is replaced first
      if (!sel.collapsed) {
        b.text = b.text.slice(0, sel.start) + b.text.slice(sel.end);
        b.marks = reconcileText({ ...b, text: b.text }, b.text);
      }
      const r = insertText(doc, b.id, sel.start, text);
      if (r) caret = r;
      paint(); changed();
      return;
    }

    // everything else — plain typing, IME, autocorrect, dictation — runs natively
    snapshot(false);
  });

  el.addEventListener('input', () => {
    const txt = activeTxt(el);
    if (!txt) return;
    if (syncFromDom(txt)) changed();
  });

  // ---------------------------------------------------------------- keys

  el.addEventListener('keydown', e => {
    const ctx = here();
    if (!ctx) return;
    const { txt, row, b, sel } = ctx;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!LIST_TYPES.has(b.t)) return;
      syncFromDom(txt);
      snapshot(true);
      if (indentBlock(doc, b.id, e.shiftKey ? -1 : 1)) {
        caret = { blockId: b.id, offset: sel.start };
        paint(); changed();
      }
      return;
    }

    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const m = { b: 'b', i: 'i', u: 'u' }[k];
      if (m) { e.preventDefault(); mark(m); return; }
      if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (k === 'y') { e.preventDefault(); doRedo(); return; }
      if (k === 'enter' || e.key === 'Enter') {
        if (b.t === 'check') { e.preventDefault(); toggleDone(row); return; }
      }
    }

    // cross-block caret movement — blocks are separate contenteditables, so the
    // browser stops at the boundary and we have to carry the caret over
    const i = indexOf(doc, b.id);
    const atStart = sel.collapsed && sel.start === 0;
    const atEnd = sel.collapsed && sel.start === b.text.length;

    if ((e.key === 'ArrowLeft' && atStart) || (e.key === 'ArrowUp' && atStart) ||
        (e.key === 'ArrowUp' && onFirstLine(txt))) {
      if (i > 0) {
        e.preventDefault();
        syncFromDom(txt);
        const prev = doc.blocks[i - 1];
        const t = txtFor(prev.id);
        if (t) { t.focus({ preventScroll: true }); setSel(t, prev.text.length); scrollCaretIntoView(t); }
      }
      return;
    }
    if ((e.key === 'ArrowRight' && atEnd) || (e.key === 'ArrowDown' && atEnd) ||
        (e.key === 'ArrowDown' && onLastLine(txt))) {
      if (i < doc.blocks.length - 1) {
        e.preventDefault();
        syncFromDom(txt);
        const next = doc.blocks[i + 1];
        const t = txtFor(next.id);
        if (t) { t.focus({ preventScroll: true }); setSel(t, 0); scrollCaretIntoView(t); }
      }
    }
  });

  function caretRect() {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0) return null;
    const r = s.getRangeAt(0).cloneRange();
    let rect = r.getBoundingClientRect();
    if (rect && rect.height === 0 && r.startContainer.nodeType === 1) {
      const el2 = r.startContainer;
      rect = el2.getBoundingClientRect();
    }
    return rect && rect.height ? rect : null;
  }
  function onFirstLine(txt) {
    const c = caretRect(), t = txt.getBoundingClientRect();
    return !c || c.top - t.top < 4;
  }
  function onLastLine(txt) {
    const c = caretRect(), t = txt.getBoundingClientRect();
    return !c || t.bottom - c.bottom < 4;
  }

  // ---------------------------------------------------------------- checkbox

  el.addEventListener('click', e => {
    const chk = e.target.closest('.chk');
    if (chk) { e.preventDefault(); toggleDone(chk.closest('.row')); }
  });

  function toggleDone(row) {
    if (!row) return;
    const b = blockById(doc, row.dataset.id);
    if (!b || b.t !== 'check') return;
    snapshot(true);
    b.done = !b.done;
    row.dataset.done = b.done ? '1' : '0';
    const chk = row.querySelector('.chk');
    if (chk) chk.setAttribute('aria-pressed', b.done ? 'true' : 'false');
    changed();
  }

  el.addEventListener('focusin', onFocus);
  document.addEventListener('selectionchange', () => { if (activeTxt(el)) onFocus(); });

  // ---------------------------------------------------------------- commands

  function mark(type) {
    const ctx = here();
    if (!ctx) return;
    const { txt, b, sel } = ctx;
    if (BLOCK_TYPES[b.t]?.plain) return;
    syncFromDom(txt);
    if (sel.collapsed) return;           // v0: no pending-mark-at-caret
    snapshot(true);
    b.marks = toggleMark(b, sel.start, sel.end, type);
    caret = { blockId: b.id, offset: sel.end };
    const row = rowFor(el, b.id);
    const fresh = renderBlock(b, indexOf(doc, b.id) === 0);
    row.replaceWith(fresh);
    const t = fresh.querySelector('.txt');
    t.focus({ preventScroll: true });
    setSel(t, sel.start, sel.end);
    changed();
  }

  function block(t) {
    const ctx = here();
    if (!ctx) return;
    syncFromDom(ctx.txt);
    snapshot(true);
    setType(doc, ctx.b.id, t);
    caret = { blockId: ctx.b.id, offset: Math.min(ctx.sel.start, ctx.b.text.length) };
    paint(); changed();
  }

  function nudge(dir) {
    const ctx = here();
    if (!ctx) return;
    syncFromDom(ctx.txt);
    // indent only means something in a list; outside one, promote to a bullet
    if (!LIST_TYPES.has(ctx.b.t)) { if (dir > 0) block('li'); return; }
    snapshot(true);
    if (indentBlock(doc, ctx.b.id, dir)) {
      caret = { blockId: ctx.b.id, offset: ctx.sel.start };
      paint(); changed();
    }
  }

  function doUndo() {
    if (!undo.length) return;
    redo.push(clone(doc));
    doc = undo.pop();
    lastSnap = 0;
    paint(); changed();
  }
  function doRedo() {
    if (!redo.length) return;
    undo.push(clone(doc));
    doc = redo.pop();
    lastSnap = 0;
    paint(); changed();
  }

  /** What the footer shows as pressed. */
  function state() {
    const ctx = here();
    if (!ctx) return { type: null, marks: new Set(), empty: true };
    const { b, sel } = ctx;
    const marks = new Set();
    for (const t of ['b', 'i', 'u', 's', 'code']) {
      if (sel.collapsed ? marksAt(b, sel.start).has(t) : hasMarkOver(b, sel.start, sel.end, t)) marks.add(t);
    }
    return { type: b.t, marks, empty: false, done: !!b.done };
  }

  return {
    load(id, d) {
      noteId = id; doc = d; undo = []; redo = []; lastSnap = 0;
      caret = doc.blocks.length ? { blockId: doc.blocks[0].id, offset: 0 } : null;
      renderDoc(el, doc);
    },
    clear() { noteId = null; doc = newDoc(); el.textContent = ''; },
    noteId: () => noteId,
    doc: () => doc,
    focus() {
      const first = el.querySelector('.txt');
      if (first) { first.focus({ preventScroll: true }); setSel(first, first.textContent.length); }
    },
    mark, block, nudge, undo: doUndo, redo: doRedo, state,
    flush() { const t = activeTxt(el); if (t) syncFromDom(t); return doc; },
  };
}
