// panes.js — two panes, and the gutter/edge switching XENO chose.
//
// The phone swipe is native scroll-snap: no touch handlers, no physics, free
// momentum. The conflict with text selection is solved by touch-action, not by
// JavaScript — .editor is pan-y so a horizontal drag in the text belongs to
// selection, while the edge strips and the gutter are pan-x.

import { animateScrollLeft } from './motion.js';

const DESKTOP = '(min-width: 820px)';

/**
 * Divider stops: every k/n for n in 2..5, deduped and sorted. Snapping to these
 * rather than to arbitrary pixels means the split is always a describable ratio —
 * a half, a third, two fifths — which is both easier to re-hit and easier to reason
 * about than "roughly 47%". The divider snaps DURING the drag, not on release, so
 * it feels magnetic rather than corrective.
 */
const STOPS = [...new Set(
  [2, 3, 4, 5].flatMap(n => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n))
)].sort((a, b) => a - b);

function nearestStop(fraction) {
  return STOPS.reduce((best, s) =>
    Math.abs(s - fraction) < Math.abs(best - fraction) ? s : best, STOPS[0]);
}

/** Readable label for the stop, so the drag can say what it snapped to. */
function stopLabel(f) {
  for (const n of [2, 3, 4, 5]) {
    for (let k = 1; k < n; k++) if (Math.abs(k / n - f) < 1e-9) return `${k}/${n}`;
  }
  return Math.round(f * 100) + '%';
}

export function createPanes(scroller, gutter, { onActive = () => {}, onSplit = () => {} } = {}) {
  const panes = [...scroller.querySelectorAll('.pane')];
  let active = 0;

  const wide = () => window.matchMedia(DESKTOP).matches;

  let cancelAnim = null;
  let animating = false;

  /** Where pane i rests: its own offset, clamped so the last pane ends flush right. */
  function restFor(i) {
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    return Math.min(panes[i].offsetLeft, max);
  }

  function goTo(i, smooth = true) {
    i = Math.max(0, Math.min(i, panes.length - 1));
    active = i;
    if (!wide()) {
      if (cancelAnim) cancelAnim();
      const to = restFor(i);
      if (!smooth) {
        scroller.scrollLeft = to;
      } else {
        // scroll-snap and a scripted scroll are two authorities over one number, and
        // the snap wins mid-flight — so it is suspended for the 150ms and restored to
        // whatever it was, because main.js owns that value for the caret's sake.
        const saved = scroller.style.scrollSnapType;
        scroller.style.scrollSnapType = 'none';
        animating = true;
        cancelAnim = animateScrollLeft(scroller, to, {
          onDone: () => { animating = false; cancelAnim = null; scroller.style.scrollSnapType = saved; },
        });
      }
    }
    onActive(i);
  }

  // track which pane the scroller settled on, and finish the job if it settled
  // between two of them
  let t = null;
  scroller.addEventListener('scroll', () => {
    if (wide() || animating) return;
    clearTimeout(t);
    t = setTimeout(() => {
      if (animating) return;
      // Nearest by REST POSITION, not by dividing scrollLeft by the viewport width:
      // the last pane rests flush right rather than at its own offset, so the naive
      // ratio misidentifies it whenever the peek makes the panes narrower than the
      // viewport — which is always.
      let best = 0;
      for (let i = 1; i < panes.length; i++) {
        if (Math.abs(restFor(i) - scroller.scrollLeft) < Math.abs(restFor(best) - scroller.scrollLeft)) best = i;
      }
      // CSS scroll-snap is switched OFF whenever the editor has focus (GUIDE §4.4,
      // main.js) — and a notes app focuses its editor at boot and keeps it. So in
      // practice nothing was ever settling a half-finished swipe, which is the other
      // half of the "peek on the wrong side" report. Settle it ourselves, on the same
      // curve as everything else.
      const off = Math.abs(restFor(best) - scroller.scrollLeft);
      if (best !== active) { active = best; onActive(best); }
      if (off > 2) goTo(best);
    }, 90);
  }, { passive: true });

  // ---- gutter: tap to toggle on phone, drag to resize on desktop ----
  let drag = null;

  gutter.addEventListener('pointerdown', e => {
    if (!wide()) return;
    // GUIDE §7.4 — a drag exists only as a pointer capture and closure variables, so
    // a store-only busy check sees nothing and reloads mid-gesture.
    if (window.UPDATE) window.UPDATE.__dragging = true;
    drag = { x: e.clientX, w: panes[0].getBoundingClientRect().width, last: null };
    gutter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  gutter.addEventListener('pointermove', e => {
    if (!drag) return;
    const total = scroller.getBoundingClientRect().width;
    if (total <= 0) return;
    const raw = (drag.w + (e.clientX - drag.x)) / total;
    const snapped = nearestStop(Math.max(STOPS[0], Math.min(raw, STOPS[STOPS.length - 1])));
    if (snapped === drag.last) return;          // nothing to repaint between stops
    drag.last = snapped;
    panes[0].style.flex = `0 0 ${(snapped * 100).toFixed(4)}%`;
    panes[1].style.flex = '1 1 auto';
    gutter.setAttribute('aria-valuetext', stopLabel(snapped));
    gutter.dataset.stop = stopLabel(snapped);
    onSplit(snapped);          // the header segments follow the divider live
  });
  const endDrag = e => {
    if (window.UPDATE) window.UPDATE.__dragging = false;
    if (drag) { drag = null; try { gutter.releasePointerCapture(e.pointerId); } catch {} }
  };
  gutter.addEventListener('pointerup', endDrag);
  gutter.addEventListener('pointercancel', endDrag);

  // Kept, but inert on phone: the CSS gives #gutter pointer-events:none below 820px
  // because a fixed element sitting over the peek would swallow the swipe it cannot
  // perform (see the rule in layout.css). The edge strip underneath does the tap.
  // This stays so the behaviour returns the moment the gutter is a hit target again.
  gutter.addEventListener('click', () => { if (!wide()) goTo(active === 0 ? 1 : 0); });

  // ---- edge strips: a horizontal drag here pans the scroller natively ----
  // They exist so touch-action can differ from the editor's (the editor is pan-y so
  // a sideways drag in text belongs to selection).
  //
  // Each strip overhangs its pane by the peek width, so at the seam TWO strips
  // overlap — pane N's right strip and pane N+1's left strip occupy the same pixels,
  // and the later one in DOM order wins the hit test. A rule of "left strip means
  // back, right strip means forward" therefore fires the WRONG DIRECTION at exactly
  // the place the user actually taps.
  //
  // So the rule is stated in terms of the pane, not the strip: tapping any visible
  // part of a pane that is not the current one goes TO that pane. Only when the strip
  // belongs to the pane you are already on does it mean "move along".
  for (const edge of scroller.querySelectorAll('.edge')) {
    edge.addEventListener('click', e => {
      if (wide()) return;
      e.preventDefault();
      const own = panes.indexOf(edge.closest('.pane'));
      if (own === -1) return;
      if (own !== active) { goTo(own); return; }
      goTo(edge.classList.contains('edge-l') ? own - 1 : own + 1);
    });
  }

  window.addEventListener('resize', () => {
    if (wide()) { panes.forEach(p => (p.style.flex = '')); onSplit(0.5); }
    // On a phone only one pane is on screen, so there is no split for the header to
    // mirror — null hands the segments back to CSS, which shares the bar evenly.
    else { goTo(active, false); onSplit(null); }
  });

  return {
    goTo,
    stops: STOPS,
    setSplit(fraction) {
      const f = nearestStop(fraction);
      panes[0].style.flex = `0 0 ${(f * 100).toFixed(4)}%`;
      panes[1].style.flex = '1 1 auto';
      onSplit(f);
      return f;
    },
    active: () => active,
    pane: i => panes[i],
    editor: i => panes[i].querySelector('.editor'),
    isWide: wide,
  };
}
