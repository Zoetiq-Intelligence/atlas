// caret.js — the one place DOM Selection is translated to and from the model.
//
// The caret is stored as (blockId, offset) in the model and NEVER as a live DOM
// Range. Every render restores it from the model. This single discipline
// removes the entire class of "cursor jumped to the start" bugs.

/** Model offset of a (node, offset) pair inside a .txt element. */
export function offsetIn(txt, node, nodeOffset) {
  if (node === txt) {
    let n = 0;
    for (let i = 0; i < nodeOffset && i < txt.childNodes.length; i++) {
      n += (txt.childNodes[i].textContent || '').length;
    }
    return n;
  }
  const walk = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
  let acc = 0, t;
  while ((t = walk.nextNode())) {
    if (t === node) return acc + nodeOffset;
    acc += t.nodeValue.length;
  }
  return acc;
}

/** Current selection as model offsets within `txt`, or null if it isn't there. */
export function getSel(txt) {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0);
  if (!txt.contains(r.startContainer) || !txt.contains(r.endContainer)) return null;
  const a = offsetIn(txt, r.startContainer, r.startOffset);
  const b = offsetIn(txt, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b), collapsed: a === b };
}

function locate(txt, offset) {
  const walk = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT);
  let acc = 0, t, last = null;
  while ((t = walk.nextNode())) {
    const len = t.nodeValue.length;
    if (offset <= acc + len) return { node: t, off: offset - acc };
    acc += len;
    last = t;
  }
  if (last) return { node: last, off: last.nodeValue.length };
  return { node: txt, off: 0 };
}

export function setSel(txt, start, end = start) {
  const r = document.createRange();
  const a = locate(txt, Math.max(0, start));
  const b = end === start ? a : locate(txt, Math.max(0, end));
  try {
    r.setStart(a.node, a.off);
    r.setEnd(b.node, b.off);
  } catch {
    r.selectNodeContents(txt);
    r.collapse(true);
  }
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/** The .txt element the caret is currently inside, if any. */
export function activeTxt(root) {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  let n = s.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const txt = n && n.closest ? n.closest('.txt') : null;
  if (!txt) return null;
  if (root && !root.contains(txt)) return null;
  return txt;
}

export function rowOf(el) { return el ? el.closest('.row') : null; }
export function blockIdOf(el) { const r = rowOf(el); return r ? r.dataset.id : null; }
