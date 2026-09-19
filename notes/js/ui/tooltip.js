// tooltip.js — instant tooltips.
//
// "ALL buttons need tooltips that instantly start displaying."
//
// The native `title` attribute cannot do this: the delay before it appears is the
// browser's, not ours, and it is around a second. So the tooltip is an element we own.
// `title` is REMOVED from anything we decorate, or the native one turns up a second
// later underneath ours.
//
// Fades on the shared 150ms smootherstep, like everything else. Appears with no delay
// at all: a tooltip that shows the keyboard shortcut is documentation, and delayed
// documentation is documentation nobody reads.

let tip = null;

function ensure() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function show(target, text) {
  const t = ensure();
  t.textContent = text;
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  // Prefer above; flip below when there is no room. Clamp horizontally so a tooltip
  // on the first or last button in a scrolling row is never half off-screen.
  const above = r.top - tr.height - 8;
  const top = above > 4 ? above : r.bottom + 8;
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
  t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  t.classList.add('on');
}

function hide() {
  if (!tip) return;
  tip.classList.remove('on');
  tip.hidden = true;
}

/**
 * Decorate one element. `text` is read lazily so a label can change (a toggle that
 * says Bold / Remove bold) without re-binding.
 */
export function attach(el, text) {
  el.removeAttribute('title');      // or the native one arrives a second later
  const get = () => (typeof text === 'function' ? text() : text);
  el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') show(el, get()); });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('pointerdown', hide);
  el.addEventListener('focus', () => show(el, get()));
  el.addEventListener('blur', hide);
}

export { hide };
