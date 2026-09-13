// panes.js — two panes, and the gutter/edge switching XENO chose.
//
// The phone swipe is native scroll-snap: no touch handlers, no physics, free
// momentum. The conflict with text selection is solved by touch-action, not by
// JavaScript — .editor is pan-y so a horizontal drag in the text belongs to
// selection, while the edge strips and the gutter are pan-x.

const DESKTOP = '(min-width: 820px)';

export function createPanes(scroller, gutter, { onActive = () => {} } = {}) {
  const panes = [...scroller.querySelectorAll('.pane')];
  let active = 0;

  const wide = () => window.matchMedia(DESKTOP).matches;

  function goTo(i, smooth = true) {
    i = Math.max(0, Math.min(i, panes.length - 1));
    active = i;
    if (!wide()) {
      scroller.scrollTo({ left: panes[i].offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    }
    onActive(i);
  }

  // track which pane the scroller settled on
  let t = null;
  scroller.addEventListener('scroll', () => {
    if (wide()) return;
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.round(scroller.scrollLeft / Math.max(1, scroller.clientWidth));
      if (i !== active) { active = i; onActive(i); }
    }, 90);
  }, { passive: true });

  // ---- gutter: tap to toggle on phone, drag to resize on desktop ----
  let drag = null;

  gutter.addEventListener('pointerdown', e => {
    if (!wide()) return;
    // GUIDE §7.4 — a drag exists only as a pointer capture and closure variables, so
    // a store-only busy check sees nothing and reloads mid-gesture.
    if (window.UPDATE) window.UPDATE.__dragging = true;
    drag = { x: e.clientX, w: panes[0].getBoundingClientRect().width };
    gutter.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  gutter.addEventListener('pointermove', e => {
    if (!drag) return;
    const total = scroller.getBoundingClientRect().width;
    const next = Math.max(220, Math.min(drag.w + (e.clientX - drag.x), total - 220));
    const pct = (next / total) * 100;
    panes[0].style.flex = `0 0 ${pct}%`;
    panes[1].style.flex = `1 1 auto`;
  });
  const endDrag = e => {
    if (window.UPDATE) window.UPDATE.__dragging = false;
    if (drag) { drag = null; try { gutter.releasePointerCapture(e.pointerId); } catch {} }
  };
  gutter.addEventListener('pointerup', endDrag);
  gutter.addEventListener('pointercancel', endDrag);

  gutter.addEventListener('click', () => { if (!wide()) goTo(active === 0 ? 1 : 0); });

  // ---- edge strips: a horizontal drag here pans the scroller natively ----
  // They exist purely so touch-action can differ from the editor's.
  for (const edge of scroller.querySelectorAll('.edge')) {
    edge.addEventListener('click', e => {
      if (wide()) return;
      goTo(edge.classList.contains('edge-l') ? active - 1 : active + 1);
      e.preventDefault();
    });
  }

  window.addEventListener('resize', () => {
    if (wide()) { panes.forEach(p => (p.style.flex = '')); }
    else goTo(active, false);
  });

  return {
    goTo,
    active: () => active,
    pane: i => panes[i],
    editor: i => panes[i].querySelector('.editor'),
    header: i => panes[i].querySelector('.pane-hd .ttl'),
    isWide: wide,
  };
}
