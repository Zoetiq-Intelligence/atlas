// motion.js — one duration and one curve for everything that moves.
//
// Smootherstep is 6t⁵ − 15t⁴ + 10t³. It is smoothstep's bigger sibling: both are
// zero-velocity at each end, but smootherstep is also zero-ACCELERATION there, so a
// short move starts and stops without the faint snap you get from an ease that only
// flattens velocity. At 150ms that difference is most of what the motion reads as.
//
// Why this exists in JS at all, rather than only in CSS: `scroll-behavior: smooth`
// takes no duration and no timing function. The browser picks both, and on a 150ms
// budget its choice is neither. A pane switch is a scroll, so the only way to put it
// on the same curve as every other transition is to animate scrollLeft ourselves.
// CSS keeps the same curve as a token (--ease-smoother) so the two never drift.

export const DUR = 150;

/** 6t⁵ − 15t⁴ + 10t³, clamped. */
export function smootherstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const reducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Animate a scroller's scrollLeft on the shared curve.
 *
 * Returns a cancel function. Cancelling leaves the scroller wherever it got to —
 * the caller decides what that means, because for a pane switch an interrupted
 * animation should hand control to the user's finger, not fight it.
 */
export function animateScrollLeft(el, to, { onDone } = {}) {
  const from = el.scrollLeft;
  const delta = to - from;

  if (reducedMotion() || Math.abs(delta) < 1) {
    el.scrollLeft = to;
    if (onDone) onDone();
    return () => {};
  }

  let raf = 0;
  let cancelled = false;
  const t0 = performance.now();

  const step = now => {
    if (cancelled) return;
    const t = Math.min(1, (now - t0) / DUR);
    el.scrollLeft = from + delta * smootherstep(t);
    if (t < 1) { raf = requestAnimationFrame(step); return; }
    if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);

  return () => { cancelled = true; cancelAnimationFrame(raf); };
}
