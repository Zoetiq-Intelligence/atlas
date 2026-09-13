// layout.js — the single source of geometric truth. GUIDE §3.
//
// Everything positioned in this app derives from here. Two facts are published as
// custom properties and nothing else may measure the viewport:
//
//   --app-h  the MEASURED height of the pinned shell (GUIDE §3.6)
//   --kb     the keyboard's intrusion, from visualViewport (GUIDE §3.5)
//
// Why measured rather than a viewport unit: a clamp fed by 100dvh is a second opinion
// about a box that is already pinned with inset:0, and any drift between the two
// silently mis-sizes content. Publishing the real number costs one read per resize and
// cannot feed back, because nothing the variable influences can change a pinned
// container. 100dvh stays as the first-paint fallback only.

const root = document.documentElement;
let subs = [];
let last = { h: -1, kb: -1 };

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const cssVar = n => num(getComputedStyle(root).getPropertyValue(n));

/**
 * GUIDE §3.5 — the keyboard shrinks the VISUAL viewport, not the layout viewport, so
 * a position:fixed bar stays pinned to the bottom of the layout viewport, i.e. behind
 * the keyboard. offsetTop is included because the visual viewport can also be scrolled
 * within the layout viewport, and ignoring it double-counts on a pinch-zoomed page.
 */
function keyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function viewport() {
  const shell = document.getElementById('app') || document.body;
  return {
    height: shell.clientHeight || window.innerHeight,
    keyboardHeight: keyboardInset(),
    saTop: cssVar('--sa-top'),
    saBottom: cssVar('--sa-bottom'),
    saLeft: cssVar('--sa-left'),
    saRight: cssVar('--sa-right'),
  };
}

function publish() {
  const v = viewport();
  if (v.height === last.h && v.keyboardHeight === last.kb) return;
  last = { h: v.height, kb: v.keyboardHeight };
  root.style.setProperty('--app-h', v.height + 'px');
  root.style.setProperty('--kb', v.keyboardHeight + 'px');
  root.classList.toggle('kb-up', v.keyboardHeight > 0);
  subs.forEach(f => { try { f(v); } catch (e) { /* a subscriber must never break layout */ } });
}

export function onViewport(fn) {
  subs.push(fn);
  return () => { subs = subs.filter(f => f !== fn); };
}

export function start() {
  publish();
  addEventListener('resize', publish, { passive: true });
  // GUIDE §3.6 — the late second read is defensive: metrics are not guaranteed settled
  // when orientationchange fires, and a rotation that ends at the same height fires no
  // resize at all.
  addEventListener('orientationchange', () => { publish(); setTimeout(publish, 300); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', publish, { passive: true });
    window.visualViewport.addEventListener('scroll', publish, { passive: true });
  }
  // The keyboard can open without a resize event on some paths; focus is the other tell.
  document.addEventListener('focusin', () => setTimeout(publish, 60), { passive: true });
  document.addEventListener('focusout', () => setTimeout(publish, 60), { passive: true });
}

export const standalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true;
