#!/usr/bin/env node
// sql-run.mjs — run one .sql file on the personal project from the Workstation.
//
//   node tools/sql-run.mjs <file.sql> [--read-only]
//
// The write half of the phone loop (note-pull.mjs is the read half). note-push.mjs writes
// a statement that rebuilds a note inside Postgres and inserts it only on an exact
// fingerprint match; this runs that file as it is on disk, so the statement never has to be
// retyped into a tool call, which is the step that made the first merge slow. Prints the
// statement's result (note-push's says `inserted` or why it refused). Never the input.
//
// Same credentials as note-pull.mjs (the Management API token Horizon keeps outside
// this repo). Supabase "personal" only; never WORK.
//
// ⚠ A note-push .sql holds private note text. Keep it outside the repo: atlas is PUBLIC.

import { query } from './note-pull.mjs';
import { insideRepo, readText } from './guard.mjs';

// Strict arguments: a mistyped --readonly must not quietly run the SQL as a write.
const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const unknown = args.filter(a => a.startsWith('--') && a !== '--read-only');
const readOnly = args.includes('--read-only');
if (unknown.length || files.length !== 1) {
  console.error('usage: node tools/sql-run.mjs <file.sql> [--read-only]' + (unknown.length ? '   (unknown: ' + unknown.join(' ') + ')' : ''));
  process.exit(2);
}
const file = files[0];
if (insideRepo(file)) {
  console.error('refusing: the .sql is inside the repo, and atlas is PUBLIC — move it out first');
  process.exit(2);
}
try {
  const rows = await query(readText(file), { readOnly });
  console.log(JSON.stringify(rows, null, 1).slice(0, 4000));
} catch (e) { console.error(e.message); process.exit(1); }
