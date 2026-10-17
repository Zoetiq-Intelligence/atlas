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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './note-pull.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const readOnly = args.includes('--read-only');
if (!file) { console.error('usage: node tools/sql-run.mjs <file.sql> [--read-only]'); process.exit(2); }
if (resolve(file).toLowerCase().startsWith(resolve(here, '..').toLowerCase())) {
  console.error('refusing: the .sql is inside the repo, and atlas is PUBLIC — move it out first');
  process.exit(2);
}
try {
  const rows = await query(readFileSync(file, 'utf8'), { readOnly });
  console.log(JSON.stringify(rows, null, 1).slice(0, 4000));
} catch (e) { console.error(e.message); process.exit(1); }
