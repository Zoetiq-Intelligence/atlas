#!/usr/bin/env node
// merge-notes.mjs — merge two exported iOS Notes daily logs into one, losing nothing.
//
//   node tools/merge-notes.mjs <older.txt> <newer.txt> <out-dir>
//
// Writes three importable .atlasnote.json files into <out-dir>:
//   "<older title> (OLD)"   the older note, verbatim
//   "<newer title> (OLD)"   the newer note, verbatim
//   "<newer title>"         the merge, formatted as lists
// and prints a report ending in a COVERAGE PROOF. Nothing is written if the proof fails.
//
// Built 2026-10-13 for the operator's words: "a third note that merges the two
// together without losing a single sentence of what I've said", and, for the merge
// only: "use checkboxes, hyphens and bullet points for successive lines that don't
// have a newline in between them just so that it's easier for me to parse".
// Reusable for the later pass over every Today/Daily note.
//
// ⚠ Output contains the operator's private notes. Never write it inside the repo:
// atlas is PUBLIC. Pass an out-dir outside it.
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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const { newDoc, newBlock, coerce } = await import(join(here, '../notes/js/model/doc.js'));
const { splitLines, textToDoc } = await import(join(here, '../notes/js/model/import.js'));

const MIN_RUN = 3;          // shortest copied run worth removing
const MIN_CONTAIN = 12;     // shortest line allowed to match by containment

// ------------------------------------------------------------------ matching

const norm = s => s.trim();
const same = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < MIN_CONTAIN) return false;
  return x.includes(y) || y.includes(x);
};

/** Non-blank lines with their original indices. */
const solid = lines => lines.map((t, i) => ({ t, i })).filter(x => x.t.trim());

/**
 * Greedy longest-run cover of `older` by `newer`, both as non-blank sequences.
 * Returns pairs [olderIdx, newerIdx] for every older line inside a run >= MIN_RUN.
 */
function copiedRuns(older, newer) {
  const O = solid(older), N = solid(newer);
  const pairs = [];
  let i = 0;
  while (i < O.length) {
    let best = 0, bestJ = -1;
    for (let j = 0; j < N.length; j++) {
      if (!same(O[i].t, N[j].t)) continue;
      let k = 0;
      while (i + k < O.length && j + k < N.length && same(O[i + k].t, N[j + k].t)) k++;
      if (k > best) { best = k; bestJ = j; }
    }
    if (best >= MIN_RUN) {
      for (let k = 0; k < best; k++) pairs.push([O[i + k].i, N[bestJ + k].i]);
      i += best;
    } else i++;
  }
  return pairs;
}

// ------------------------------------------------------------------ merging

function merge(older, newer) {
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

function toBlocks(lines) {
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
function prove(sources, doc) {
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

/** coerce() is what every load does to stored data; the file must survive it untouched. */
function roundTrips(doc) {
  const back = coerce(JSON.parse(JSON.stringify(doc)));
  const sig = d => d.blocks.map(b => [b.t, b.text, b.depth || 0, !!b.done].join('\u0001')).join('\u0002');
  return sig(back) === sig(doc);
}

// ------------------------------------------------------------------ main

const [olderPath, newerPath, outDir] = process.argv.slice(2);
if (!olderPath || !newerPath || !outDir) {
  console.error('usage: node tools/merge-notes.mjs <older.txt> <newer.txt> <out-dir>');
  process.exit(2);
}
if (resolve(outDir).startsWith(resolve(here, '..'))) {
  console.error('refusing: out-dir is inside the repo, and atlas is PUBLIC');
  process.exit(2);
}

const olderText = readFileSync(olderPath, 'utf8');
const newerText = readFileSync(newerPath, 'utf8');
const older = splitLines(olderText), newer = splitLines(newerText);

const oldA = textToDoc(olderText, { suffix: '(OLD)' });
const oldB = textToDoc(newerText, { suffix: '(OLD)' });
const { lines, stats } = merge(older, newer);
const merged = newDoc(toBlocks(lines));

const proof = prove([older, newer], merged);
const counts = merged.blocks.reduce((a, b) => {
  const k = b.t === 'li' ? (b.depth ? 'hyphen' : 'bullet') : b.t === 'check' ? 'checkbox' : b.text.trim() ? 'plain' : 'blank';
  a[k] = (a[k] || 0) + 1; return a;
}, {});

console.log(`older: ${older.length} lines  newer: ${newer.length} lines`);
console.log(`copied runs: ${stats.pairs} older lines matched (${stats.exact} exact, ${stats.contained} inside a longer newer line, ${stats.upgraded} newer lines upgraded to the older, longer text)`);
console.log(`older lines removed as copies: ${stats.droppedOlder} (incl. blanks inside runs) | kept: ${stats.keptOlder}`);
console.log(`merged: ${merged.blocks.length} lines ->`, counts);
console.log(`COVERAGE: ${proof.missing.length} source lines missing | ${proof.byContainment} survive inside a longer line`);
for (const m of proof.missing.slice(0, 10)) console.log('   MISSING:', JSON.stringify(m.slice(0, 80)));
const rt = [oldA.doc, oldB.doc, merged].every(roundTrips);
console.log(`round trip through coerce(): ${rt ? 'unchanged' : 'CHANGED'}`);

if (proof.missing.length || !rt) { console.error('\nNOT WRITTEN — the merge would lose text.'); process.exit(1); }

mkdirSync(outDir, { recursive: true });
const write = (title, doc) => {
  const f = join(outDir, title.replace(/[\\/:*?"<>|]/g, '').trim() + '.atlasnote.json');
  writeFileSync(f, JSON.stringify({ atlas: 'note', v: 1, title, doc }));
  console.log('wrote', f);
};
write(oldA.title, oldA.doc);
write(oldB.title, oldB.doc);
write(merged.blocks.find(b => b.text.trim()).text.trim(), merged);
