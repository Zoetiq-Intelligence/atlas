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
// The rules (how the two notes relate, copied-run dedup, list formatting, the coverage
// proof) live in notes/js/model/merge.js, shared with the app's Merge panel.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Relative specifiers, not join(here, …): on Windows an absolute path is not a valid
// import URL ("Received protocol 'f:'").
import { newDoc } from '../notes/js/model/doc.js';
import { splitLines, textToDoc } from '../notes/js/model/import.js';
import { mergeLines as merge, toBlocks, prove, roundTrips, counts as countOf } from '../notes/js/model/merge.js';
import { insideRepo, readText } from './guard.mjs';

// ------------------------------------------------------------------ main

const [olderPath, newerPath, outDir] = process.argv.slice(2);
if (!olderPath || !newerPath || !outDir) {
  console.error('usage: node tools/merge-notes.mjs <older.txt> <newer.txt> <out-dir>');
  process.exit(2);
}
if (insideRepo(outDir)) {
  console.error('refusing: out-dir is inside the repo, and atlas is PUBLIC');
  process.exit(2);
}

const olderText = readText(olderPath);
const newerText = readText(newerPath);
const older = splitLines(olderText), newer = splitLines(newerText);

const oldA = textToDoc(olderText, { suffix: '(OLD)' });
const oldB = textToDoc(newerText, { suffix: '(OLD)' });
const { lines, stats } = merge(older, newer);
const merged = newDoc(toBlocks(lines));

const proof = prove([older, newer], merged);
const counts = countOf(merged);

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
const used = new Set();
const write = (title, doc) => {
  let name = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || 'untitled';
  for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/ -\d+$/, '') + ' -' + n;
  used.add(name.toLowerCase());
  const f = join(outDir, name + '.atlasnote.json');
  writeFileSync(f, JSON.stringify({ atlas: 'note', v: 1, title, doc }));
  console.log('wrote', f);
};
write(oldA.title, oldA.doc);
write(oldB.title, oldB.doc);
write((merged.blocks.find(b => b.text.trim())?.text || 'Merged').trim(), merged);
