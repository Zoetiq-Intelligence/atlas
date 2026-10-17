#!/usr/bin/env node
// note-pull.mjs — bring stored notes to the Workstation as files, for the merge tools.
//
//   node tools/note-pull.mjs <out-dir> <note id>...
//
// Writes, per note, "<title>.txt" (its plain text, the shape merge-notes.mjs reads) and
// "<title>.atlasnote.json" (the full doc, the shape note-push.mjs takes as a source), then
// prints one line per note: id, title, line count, and the md5 of its text. Never the text.
//
// Built 2026-10-17 for the phone loop: the operator sends a request from the app's Claude
// panel naming notes by id; Atlas Master pulls them here, runs merge-notes.mjs and
// note-push.mjs, and the result syncs back to the phone. The text goes from Supabase to
// disk and back without passing through the chat, which is what kept the first
// merge to seven hand-verified chunks.
//
// Reads through the Supabase Management API (read_only query) with the token Horizon keeps
// in LocalGen's git-ignored gateway_state/supabase_mgmt.json (field access_token); override
// the path with ATLAS_SUPABASE_MGMT. Not the service key: service_role has no grant on the
// `notes` schema, and adding one is the operator's call. The token is never in this repo.
//
// ⚠ Output is the operator's private notes. Never write it inside the repo: atlas is
// PUBLIC. An out-dir inside it is refused.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { coerce, plainText } from '../notes/js/model/doc.js';
import { insideRepo } from './guard.mjs';

export const PROJECT = 'ymcewqdxtfxskyuizlqx';      // Supabase "personal"; never WORK
const CONF = process.env.ATLAS_SUPABASE_MGMT || 'F:/marital/generation/LocalGen/gateway_state/supabase_mgmt.json';

/** Run SQL on the personal project through the Management API. */
export async function query(sql, { readOnly = true } = {}) {
  let token;
  try { token = JSON.parse(readFileSync(CONF, 'utf8')).access_token; }
  catch (e) { throw new Error(`cannot read ${CONF}: ${e.message}`); }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(120000),   // a hung request must not hang the tool
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 500)}`);
  return JSON.parse(body);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const fileName = title => {
  const s = String(title || 'untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'untitled';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? '_' + s : s;
};

/** One note row → the two files' contents. Exported for the test. */
export function toFiles(row) {
  const doc = coerce(row.doc);
  const text = plainText(doc);
  return {
    txt: text,
    json: JSON.stringify({ atlas: 'note', v: 1, title: row.title, doc }),
    lines: doc.blocks.length,
    md5: createHash('md5').update(text).digest('hex'),
  };
}

async function main() {
  const [outDir, ...given] = process.argv.slice(2);
  const ids = [...new Set(given)];
  if (!outDir || !ids.length) {
    console.error('usage: node tools/note-pull.mjs <out-dir> <note id>...');
    process.exit(2);
  }
  if (insideRepo(outDir)) {
    console.error('refusing: out-dir is inside the repo, and atlas is PUBLIC');
    process.exit(2);
  }
  const bad = ids.filter(i => !UUID.test(i));
  if (bad.length) { console.error('not note ids: ' + bad.join(' ')); process.exit(2); }

  // ids are validated as UUIDs above, so inlining them cannot inject anything
  let rows;
  try {
    rows = await query(`select id::text, title, doc, updated_at, deleted_at from notes.note
                        where id in (${ids.map(i => `'${i}'`).join(',')})`);
  } catch (e) { console.error(e.message); process.exit(1); }

  mkdirSync(outDir, { recursive: true });
  const used = new Set();              // two notes with one title must not overwrite each other
  for (const id of ids) {
    const row = rows.find(r => r.id === id);
    if (!row) { console.log(`${id}  MISSING`); continue; }
    let name = fileName(row.title);
    if (used.has(name.toLowerCase())) name += ' ' + id.slice(0, 8);
    used.add(name.toLowerCase());
    const f = toFiles(row), base = join(outDir, name);
    writeFileSync(base + '.txt', f.txt);
    writeFileSync(base + '.atlasnote.json', f.json);
    console.log(`${id}  ${row.title}  ${f.lines} lines  md5 ${f.md5}  -> ${name}${row.deleted_at ? '  (in Recently Deleted)' : ''}`);
  }
  if (rows.length < ids.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
