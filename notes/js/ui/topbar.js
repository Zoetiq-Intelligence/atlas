// topbar.js — ONE header for both panes plus everything global.
//
// Replaces the two per-pane headers. Two identical headers side by side said nothing
// about which pane you were acting on, and duplicated the safe-area inset into two
// places that had to agree.
//
// The part that makes it one header rather than a toolbar with two labels: on desktop
// the title segments are sized to the SAME fraction the divider is snapped to, so each
// title sits directly above the pane it names. Drag the divider to 1/3 and the header
// follows. The segments are also the pane switcher — on a phone, where only one pane
// is on screen, tapping the other title goes there, which gives the swipe a
// discoverable twin rather than leaving it as the only way across.
//
// Global controls (the list, sync status, new note) live here once instead of twice.
// "New note" acts on the FOCUSED pane, and the focused segment is visibly current, so
// which pane it will land in is always readable off the header itself.

export function createTopbar(el, { onList, onNew, onPane } = {}) {
  const tabs = [0, 1].map(i => el.querySelector(`.tab[data-pane="${i}"]`));
  const labels = tabs.map(t => t.querySelector('.tt'));
  let active = 0;

  el.querySelector('[data-act="list"]').onclick = () => onList && onList();
  el.querySelector('[data-act="new"]').onclick = () => onNew && onNew(active);

  tabs.forEach((tab, i) => {
    tab.onclick = () => onPane && onPane(i);
  });

  function setActive(i) {
    active = i;
    tabs.forEach((t, n) => {
      // aria-current rather than a tab role: on desktop BOTH panes are genuinely
      // visible, so calling one "selected" and the other not would be a lie to a
      // screen reader. Current is exactly what is true — this is the one being
      // acted on.
      if (n === i) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
  }

  return {
    setTitle(i, text) { labels[i].textContent = text || 'New Note'; },
    title(i) { return labels[i].textContent; },
    setActive,
    active: () => active,
    /**
     * Mirror the divider. `f` is the fraction of the width held by pane 0, or null
     * to hand sizing back to CSS (phone, where both segments share the bar evenly
     * because only one pane is on screen anyway).
     */
    setSplit(f) {
      if (f == null) { tabs.forEach(t => (t.style.flex = '')); return; }
      tabs[0].style.flex = `0 0 ${(f * 100).toFixed(4)}%`;
      tabs[1].style.flex = '1 1 auto';
    },
  };
}
