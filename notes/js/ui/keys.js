// keys.js — Spacebar as the modifier.
//
// The hard part, stated plainly: space is a PRINTING CHARACTER, and at speed
// keystrokes overlap. Type "a b" quickly and space-down/b-down interleave, so naive
// chording fires a command instead of typing a space — which in a notes app feels
// exactly like data loss.
//
// Three rules keep it honest:
//
//   1. Space-down does not insert. The space goes in on KEYUP, which for a single
//      character is imperceptible.
//   2. A chord needs a DWELL: the space must have been held ~90ms before the other
//      key arrives. A fast overlap is under that, so it stays a space.
//   3. A chord is refused if another key was ALREADY down when space went down —
//      that is a rollover from the previous word, not an intent to chord.
//
// DESKTOP ONLY, deliberately. On a touch device there is no physical space bar to
// hold, and intercepting keydown is the exact thing that breaks iOS autocorrect,
// dictation and IME — the normal typing path on the primary target device. The footer
// and the selection menu carry all 20 commands there, which is why parity matters.

import { byKey, run } from '../editor/commands.js';

const DWELL_MS = 90;

export function createKeys({ getEditor, host = {}, onAfter = () => {} } = {}) {
  const physical = !!(window.matchMedia
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  if (!physical) return { enabled: false, reason: 'no physical keyboard' };

  let spaceAt = 0;            // when space went down, 0 when it is up
  let consumed = false;       // space was used as a modifier, so do not type it
  let othersDown = 0;

  const inEditor = () => {
    const a = document.activeElement;
    return !!(a && a.closest && a.closest('.txt'));
  };

  document.addEventListener('keydown', e => {
    if (!inEditor()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === ' ') {
      if (e.repeat) { e.preventDefault(); return; }
      // Rule 3: something was already held, so this is rollover, not a chord.
      if (othersDown > 0) return;
      spaceAt = performance.now();
      consumed = false;
      e.preventDefault();               // rule 1: nothing is typed yet
      return;
    }

    othersDown++;

    if (!spaceAt) return;
    // Rule 2: too quick to be deliberate — let the space and this key both type.
    if (performance.now() - spaceAt < DWELL_MS) return;

    const cmd = byKey.get(e.key.toLowerCase());
    if (!cmd) return;
    e.preventDefault();
    consumed = true;
    const ed = getEditor();
    if (ed) { run(cmd, ed, host); onAfter(cmd); }
  }, true);

  document.addEventListener('keyup', e => {
    if (e.key === ' ') {
      const was = spaceAt;
      spaceAt = 0;
      if (!was || consumed) { consumed = false; return; }
      if (!inEditor()) return;
      // The space we withheld on keydown. execCommand keeps it inside the browser's
      // own undo stack and fires the input event the editor reconciles from, which is
      // what the hybrid input design depends on.
      document.execCommand('insertText', false, ' ');
      return;
    }
    othersDown = Math.max(0, othersDown - 1);
  }, true);

  // A window that loses focus mid-chord would otherwise come back with space "held".
  window.addEventListener('blur', () => { spaceAt = 0; consumed = false; othersDown = 0; });

  return { enabled: true, dwell: DWELL_MS };
}
