// merge.js — merge two newest-at-top daily logs into one, losing nothing.
//
// Shared by the app (Merge panel, on the phone) and tools/merge-notes.mjs (the CLI).
// One implementation, so the proof the phone shows is the proof the tool prints.
//
// Built 2026-10-13 for the operator's words: "a third note that merges the two
// together without losing a single sentence of what I've said", and, for the merge
// only: "use checkboxes, hyphens and bullet points for successive lines that don't
// have a newline in between them just so that it's easier for me to parse".
//
// ---------------------------------------------------------------------------
// HOW THE TWO NOTES RELATE (measured on the first pair, not assumed)
//
// Both are newest-at-top logs. When the newer note was started, chunks of the older
// one were copied into it — not one contiguous block but runs from many places, some
// lightly edited (a line extended, a line dropped, a line added). So:
//
//   order   newer note first, then the older one: newest at the top, as written.
//   dedup   only COPIED RUNS are removed — at least MIN_RUN consecutive non-blank
//           lines of the older note matching consecutive lines of the newer one.
//           A single repeated line ("gym", "call kids") is a separate day's task and
//           is never removed: repetition across days is content.
//   edits   inside a copied run, lines match if equal or if one contains the other.
//           Where the OLDER line is the longer one, the newer line is upgraded to it,
//           so the words the copy dropped come back. Where neither contains the
//           other, the line is not part of a run and simply stays where it was.

import { newDoc, newBlock, coerce } from './doc.js';

export const MIN_RUN = 3;          // shortest copied run worth removing
export const MIN_CONTAIN = 12;     // shortest line allowed to match by containment

// ------------------------------------------------------------------ matching

const norm = s => s.trim();

/** Non-blank lines with their original indices, trimmed once (the matching is |O|×|N|). */
const solid = lines => lines.map((t, i) => ({ t, i, n: t.trim() })).filter(x => x.n);
/** Two trimmed, non-blank lines match if equal, or if one contains the other and both are long enough. */
const sameN = (x, y) => x === y || (Math.min(x.length, y.length) >= MIN_CONTAIN && (x.includes(y) || y.includes(x)));

/**
 * Greedy longest-run cover of `older` by `newer`, both as non-blank sequences.
 * Returns pairs [olderIdx, newerIdx] for every older line inside a run >= MIN_RUN.
 */
function copiedRuns(older, newer) {
  const O = solid(older), N = solid(newer);
  const pairs = [];
  // A line of the newer note can stand for ONE copied line of the older note. Without
  // this, a routine repeated under several days in the older note was removed every
  // time it matched the single copy in the newer one, and those days lost their lines.
  const used = new Uint8Array(N.length);
  let i = 0;
  while (i < O.length) {
    let best = 0, bestJ = -1;
    for (let j = 0; j < N.length; j++) {
      if (used[j] || !sameN(O[i].n, N[j].n)) continue;
      let k = 0;
      while (i + k < O.length && j + k < N.length && !used[j + k] && sameN(O[i + k].n, N[j + k].n)) k++;
      if (k > best) { best = k; bestJ = j; }
    }
    if (best >= MIN_RUN) {
      for (let k = 0; k < best; k++) { pairs.push([O[i + k].i, N[bestJ + k].i]); used[bestJ + k] = 1; }
      i += best;
    } else i++;
  }
  return pairs;
}

// ------------------------------------------------------------------ merging

/** Lines in, lines out: the newer note (upgraded where the copy lost words), then what is left of the older. */
export function mergeLines(older, newer) {
  const out = newer.slice();               // the newer note, possibly upgraded
  const pairs = copiedRuns(older, newer);
  const drop = new Set();
  let upgraded = 0, exact = 0, contained = 0;

  for (const [oi, ni] of pairs) {
    const o = older[oi], n = out[ni];
    if (norm(o) === norm(n)) exact++;
    else if (norm(n).includes(norm(o))) contained++;
    else { out[ni] = o; upgraded++; }      // the older line carries words the copy lost
    drop.add(oi);
  }
  // Blank lines strictly inside a removed run go with it; every other blank stays.
  const sorted = [...drop].sort((a, b) => a - b);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k] - sorted[k - 1] > 1 && sorted[k] - sorted[k - 1] <= 4) {
      const gap = older.slice(sorted[k - 1] + 1, sorted[k]);
      if (gap.every(l => !l.trim())) for (let g = sorted[k - 1] + 1; g < sorted[k]; g++) drop.add(g);
    }
  }
  const rest = older.filter((_, i) => !drop.has(i));
  return { lines: [...out, '', ...rest], stats: { pairs: pairs.length, exact, contained, upgraded,
           droppedOlder: drop.size, keptOlder: rest.length } };
}

// ------------------------------------------------------------------ formatting

// A line reads as a task when it opens with an imperative. Heuristic on purpose: the
// merge is a DERIVED note, regenerable from the two OLD notes, so a wrong guess costs
// a re-run, never a word.
const VERBS = new Set(`get go call text send buy order pick pickup pay book plan make setup set fix clean
move ask email build write create add start finish print return try research look find test install
reserve extend submit cancel confirm update review hire take bring decide figure verify deploy give tell
wash mow trim charge pack coordinate arrange reach contact request notify respond prep prepare schedule
check do follow sign register transfer delete package collate connect grab put wrap remove replace repair
assemble sort organize empty powerwash weed spray apply link facetime message record log read watch
practice pray plot design draft fill rent upgrade enable migrate merge reconcile sync import export backup
restore initialize demand file catch resolve solve consider compare visit drop inject pull push refill
stock cook eat shower nap sleep walk run lift train clear reset rebuild reorganize ship mail return`.split(/\s+/));

const firstWord = s => ((s.trim().match(/^[A-Za-z']+/) || [''])[0]).toLowerCase();
const isTask = s => VERBS.has(firstWord(s));
const isSeparator = s => /^[-–—=_*~.>]+$/.test(s.trim());
const CHECK = /^\s*\[( |x|X)\]\s*/;

/** Lines to blocks: in each run of consecutive lines, a label, checkboxes, bullets and hyphens. */
export function toBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { blocks.push(newBlock('p', lines[i])); i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].trim()) j++;
    const run = lines.slice(i, j);
    run.forEach((line, k) => {
      const m = line.match(CHECK);
      if (m) { blocks.push(newBlock('check', line.slice(m[0].length), { done: m[1] !== ' ' })); return; }
      if (run.length === 1 || isSeparator(line)) { blocks.push(newBlock('p', line)); return; }
      // the operator's own indentation and sub-point arrows: hyphens, one level in
      if (/^\t/.test(line) || /^\s*>/.test(line)) {
        blocks.push(newBlock('li', line.replace(/^\t+/, ''), { depth: 1 })); return;
      }
      // the first line names the group and stays a plain label when it is short and not
      // a task — or when it is a single word at all ("RETURN", "Work"): one word opening a
      // run is a heading even when that word happens to be a verb
      const single = !/\s/.test(line.trim());
      if (k === 0 && (single || (!isTask(line) && line.trim().length <= 40))) {
        blocks.push(newBlock('p', line)); return;
      }
      if (isTask(line)) { blocks.push(newBlock('check', line)); return; }
      blocks.push(newBlock('li', line));
    });
    i = j;
  }
  return blocks;
}

// ------------------------------------------------------------------ proof

const strip = s => s.replace(/^\t+/, '').replace(CHECK, '').trim();

/** Every non-blank source line must survive, verbatim or inside a longer line. */
export function prove(sources, doc) {
  const texts = doc.blocks.map(b => strip(b.text)).filter(Boolean);
  const exact = new Set(texts);
  const missing = [];
  let byContainment = 0;
  for (const src of sources) for (const line of src) {
    const t = strip(line);
    if (!t || exact.has(t)) continue;
    if (texts.some(x => x.includes(t))) { byContainment++; continue; }
    missing.push(line);
  }
  return { missing, byContainment };
}

/** coerce() is what every load does to stored data; the merge must survive it untouched. */
export function roundTrips(doc) {
  const back = coerce(JSON.parse(JSON.stringify(doc)));
  const sig = d => d.blocks.map(b => [b.t, b.text, b.depth || 0, !!b.done].join('\u0001')).join('\u0002');
  return sig(back) === sig(doc);
}

/** Block counts by what the operator sees: checkbox, bullet, hyphen, plain, blank. */
export function counts(doc) {
  return doc.blocks.reduce((a, b) => {
    const k = b.t === 'li' ? (b.depth ? 'hyphen' : 'bullet') : b.t === 'check' ? 'checkbox' : b.text.trim() ? 'plain' : 'blank';
    a[k] = (a[k] || 0) + 1; return a;
  }, {});
}

/**
 * Drop a marker suffix such as "(OLD)" from the first non-blank line: the marker is the
 * app's own, added on import, and must not travel into the merge's title or count as a
 * line the merge "lost".
 */
export function unmark(lines, suffix = '(OLD)') {
  const out = lines.slice();
  const i = out.findIndex(l => l.trim() !== '');
  const s = ' ' + suffix;
  if (i >= 0 && out[i].trimEnd().endsWith(s)) out[i] = out[i].trimEnd().slice(0, -s.length);
  return out;
}

/**
 * The whole merge, proven. `ok` is false when any source line would be lost or the
 * result would not survive a reload; callers must refuse to store it then.
 * @param {string[]} older  lines of the older note
 * @param {string[]} newer  lines of the newer note
 * @param {{title?: string}} opts  title — replaces the merge's first non-blank line
 */
export function mergeNotes(older, newer, { title } = {}) {
  const { lines, stats } = mergeLines(older, newer);
  if (title && title.trim()) {
    const i = lines.findIndex(l => l.trim() !== '');
    // the old first line is kept below the new title, so renaming can never lose it
    if (i >= 0 && lines[i].trim() !== title.trim()) lines.splice(i, 0, title.trim(), '');
    else if (i < 0) lines.unshift(title.trim());
  }
  const doc = newDoc(toBlocks(lines));
  const proof = prove([older, newer], doc);
  const rt = roundTrips(doc);
  const first = doc.blocks.find(b => b.text.trim());
  return { doc, title: first ? first.text.trim() : '', stats, proof, roundTrip: rt, counts: counts(doc),
           ok: !proof.missing.length && rt };
}
