#!/usr/bin/env node
// note-push.mjs — one SQL call per note.
//
//   node tools/note-push.mjs <note.atlasnote.json|.txt> <out.sql> --user <uuid> [K=<source file>@<note id|title>]...
//
// Writes ONE statement that creates the note in Supabase (schema notes). Run it with
// the Supabase connector's execute_sql: one call, seconds, any size of note.
//
// Built 2026-10-15 for the operator: "we will need to build a better process for you
// directly editing notes FAST" — after pushing one 1,970-line note took seven
// hand-verified chunks.
//
// WHY IT IS SMALL. Every character Claude sends has to be typed out by Claude; that,
// not Supabase, was the slow part. So text that is ALREADY in the database is never
// sent again. Name the notes it came from as sources, and each line becomes a
// reference: "source K, lines 38–5584" plus one letter per line for its type. Only text
// found in no source travels as text. The first use — a 7,544-line merge of two notes
// already stored — came to 5 KB instead of 600 KB.
//
// WHY IT IS SAFE. The statement rebuilds the note inside Postgres, fingerprints every
// block (type, text, depth, checked) and inserts ONLY if that fingerprint equals the
// one computed here from the file. Anything else — a source edited since, a source
// missing or ambiguous, a note with that title already live — inserts nothing and the
// result says why. Running it twice never makes a duplicate.
//
// ⚠ The .sql contains the operator's private notes. Never write it inside the repo:
// atlas is PUBLIC. Same for the input files.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { insideRepo, readText } from './guard.mjs';

// ------------------------------------------------------------------ encoding

// One letter per block. List types carry depth 0–3 in the letter; marks are not
// encoded, so a note with inline formatting is refused rather than flattened.
const PLAIN = { p: 'p', h1: 't', h2: 'h', h3: 's', quote: 'q', code: 'k' };
const LISTS = { li: 'A', ol: 'E', check: 'I' };         // + depth; done check: 'M' + depth
const UNPLAIN = Object.fromEntries(Object.entries(PLAIN).map(([t, c]) => [c, t]));

export function codeOf(b) {
  if (b.marks && b.marks.length) throw new Error('block has inline marks — not supported, refused');
  if (PLAIN[b.t]) return PLAIN[b.t];
  if (!LISTS[b.t]) throw new Error(`block type "${b.t}" not supported, refused`);
  const d = b.depth || 0;
  if (d > 3) throw new Error('list depth above 3 not supported, refused');
  const base = b.t === 'check' && b.done ? 'M' : LISTS[b.t];
  return String.fromCharCode(base.charCodeAt(0) + d);
}

export function blockOf(code) {
  if (UNPLAIN[code]) return { t: UNPLAIN[code] };
  const n = code.charCodeAt(0) - 65;                       // A..P
  const t = ['li', 'ol', 'check', 'check'][n >> 2], depth = n & 3;
  return t === 'check' ? { t, depth, done: n >= 12 } : { t, depth };
}

// How a target line may be derived from a source line. Index = xform id.
const CHECK = /^\s*\[( |x|X)\]\s*/;
export const XFORMS = [s => s, s => s.replace(/^\t+/, ''), s => s.replace(CHECK, '')];
const XFORMS_SQL = [
  `t`,
  `regexp_replace(t, E'^\\t+', '')`,
  `regexp_replace(t, '^[[:space:]]*\\[( |x|X)\\][[:space:]]*', '')`,
];

const rle = s => s.replace(/(.)\1*/g, m => m.length + m[0]);
const unrle = s => s.replace(/(\d+)(\D)/g, (_, n, c) => c.repeat(+n));

/**
 * Express `target` (blocks) as segments over `sources` ({key: string[]}).
 * Segment: [src, start, codesRLE, xform] for references, ['=', 0, codesRLE, 0, texts[]]
 * for literal text. Prefers continuing the previous segment, then any exact source line.
 */
export function plan(target, sources) {
  const index = {};                                         // xform -> text -> [key, i]
  XFORMS.forEach((f, x) => {
    const m = index[x] = new Map();
    for (const [k, lines] of Object.entries(sources)) lines.forEach((l, i) => {
      const t = f(l); if (t.trim() && !m.has(t)) m.set(t, [k, i]);
    });
  });
  const segs = [];
  for (const b of target) {
    const code = codeOf(b), text = b.text || '';
    const last = segs[segs.length - 1];
    if (last && last[0] !== '=') {
      const next = last[1] + unrle(last[2]).length;
      if (sources[last[0]][next] !== undefined && XFORMS[last[3]](sources[last[0]][next]) === text) {
        last[2] = rle(unrle(last[2]) + code); continue;
      }
    }
    let hit = null;
    if (text.trim()) for (let x = 0; x < XFORMS.length && !hit; x++) {
      const r = index[x].get(text); if (r) hit = [...r, x];
    }
    if (hit) { segs.push([hit[0], hit[1], rle(code), hit[2]]); continue; }
    if (last && last[0] === '=') { last[2] = rle(unrle(last[2]) + code); last[4].push(text); continue; }
    segs.push(['=', 0, rle(code), 0, [text]]);
  }
  return segs;
}

/** The decoder, in JS: what the SQL does, used to prove a plan before it is written. */
export function rebuild(segs, sources) {
  const out = [];
  for (const [src, start, codes, x, texts] of segs) {
    [...unrle(codes)].forEach((c, j) => out.push({
      ...blockOf(c), text: src === '=' ? texts[j] : XFORMS[x](sources[src][start + j]),
    }));
  }
  return out;
}

export const signature = blocks => createHash('md5').update(blocks.map(b =>
  [b.t, b.text || '', LISTS[b.t] ? (b.depth || 0) : 0, b.done ? 1 : 0].join('|')).join('\n'), 'utf8').digest('hex');

// ------------------------------------------------------------------ SQL

const q = s => `'${String(s).replace(/'/g, "''")}'`;

export function toSql({ title, segs, sig, count, user, sources }) {
  const payload = JSON.stringify(segs);
  let tag = 'np'; while (payload.includes(`$${tag}$`)) tag += 'x';
  const src = Object.entries(sources).map(([k, ref]) => {
    const where = /^[0-9a-f-]{36}$/i.test(ref) ? `id = ${q(ref)}::uuid` : `title = ${q(ref)}`;
    return `select ${q(k)} k, id from notes.note where user_id = ${q(user)}::uuid and deleted_at is null and ${where}`;
  });
  const want = Object.keys(sources).length;
  return `with
srcs as (${src.length ? src.join('\nunion all ') : `select null::text k, null::uuid id where false`}),
lines as (select s.k, (o.ord - 1)::int i, x->>'text' t
            from srcs s join notes.note n on n.id = s.id, jsonb_array_elements(n.doc->'blocks') with ordinality o(x, ord)
           where (select count(*) from srcs) = ${want} and (select count(distinct k) from srcs) = ${want}),
segs as (select e->>0 src, (e->>1)::int st, e->>2 codes, (e->>3)::int x, e->4 texts, so
           from jsonb_array_elements($${tag}$${payload}$${tag}$::jsonb) with ordinality q(e, so)),
cs as (select src, st, x, texts, so, string_agg(repeat(m[2], m[1]::int), '' order by mo) c
         from segs, regexp_matches(codes, '(\\d+)(\\D)', 'g') with ordinality r(m, mo) group by src, st, x, texts, so),
ln as (select cs.*, j, substr(c, j, 1) code from cs, generate_series(1, length(c)) j),
b as (select row_number() over (order by so, j) k, code,
             case when src = '=' then texts->>(j - 1)
                  else case x ${XFORMS_SQL.map((e, i) => `when ${i} then ${e}`).join(' ')} end end text
        from ln left join lines on lines.k = ln.src and lines.i = ln.st + ln.j - 1),
bt as (select k, text,
              case code ${Object.entries(UNPLAIN).map(([c, t]) => `when ${q(c)} then ${q(t)}`).join(' ')}
                        else (array['li','ol','check','check'])[((ascii(code) - 65) >> 2) + 1] end t,
              case when ascii(code) between 65 and 80 then (ascii(code) - 65) & 3 else 0 end depth,
              ascii(code) between 77 and 80 done,
              ascii(code) between 65 and 80 list
         from b),
chk as (select count(*) n, count(text) have,
               md5(string_agg(t || '|' || text || '|' || depth || '|' || (case when done then 1 else 0 end), E'\\n' order by k)) sig
          from bt),
doc as (select jsonb_build_object('v', 1, 'blocks', jsonb_agg(
               jsonb_build_object('id', 'np' || to_hex(k::int) || substr(md5(random()::text), 1, 4), 't', t, 'text', text, 'marks', '[]'::jsonb)
               || case when list then jsonb_build_object('depth', depth) else '{}'::jsonb end
               || case when t = 'check' then jsonb_build_object('done', done) else '{}'::jsonb end
               order by k)) d from bt),
dup as (select count(*) n from notes.note where user_id = ${q(user)}::uuid and title = ${q(title)} and deleted_at is null),
ins as (insert into notes.note (user_id, title, doc, pinned, folder_id, deleted_at)
        select ${q(user)}::uuid, ${q(title)}, doc.d, false, null, null from doc, chk, dup
         where chk.n = ${count} and chk.have = ${count} and chk.sig = ${q(sig)} and dup.n = 0
        returning id)
select case when (select count(*) from ins) = 1 then 'inserted'
            when (select n from dup) > 0 then 'refused: a live note already has this title'
            when (select count(*) from srcs) <> ${want} then 'refused: sources missing or ambiguous'
            else 'refused: rebuilt note differs from the file' end as result,
       (select id from ins) id, ${q(title)} title, chk.n blocks, chk.have, chk.sig = ${q(sig)} sig_ok
  from chk;
`;
}

// ------------------------------------------------------------------ main

function readNote(path) {
  const raw = readText(path);
  if (/\.json$/i.test(path)) {
    const j = JSON.parse(raw);
    return { title: j.title, blocks: j.doc.blocks };
  }
  const t = raw.replace(/\r\n?/g, '\n');
  const lines = (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n');
  return { title: (lines.find(l => l.trim()) || '').trim().slice(0, 120), blocks: lines.map(text => ({ t: 'p', text })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ui = args.indexOf('--user');
  const user = ui >= 0 ? args.splice(ui, 2)[1] : '';
  const [file, out, ...srcArgs] = args;
  if (!file || !out || !/^[0-9a-f-]{36}$/i.test(user)) {
    console.error('usage: node tools/note-push.mjs <note.atlasnote.json|.txt> <out.sql> --user <uuid> [K=<source file>@<note id|title>]...');
    process.exit(2);
  }
  if (insideRepo(out)) {
    console.error('refusing: out.sql is inside the repo, and atlas is PUBLIC');
    process.exit(2);
  }
  const note = readNote(file);
  const sources = {}, refs = {};
  for (const a of srcArgs) {
    const m = a.match(/^(\w+)=(.+?)@(.+)$/);
    if (!m) { console.error('bad source:', a); process.exit(2); }
    if (m[1] in sources) { console.error('source key used twice:', m[1]); process.exit(2); }
    sources[m[1]] = readNote(m[2]).blocks.map(b => b.text || '');
    refs[m[1]] = m[3];
  }
  const segs = plan(note.blocks, sources);
  const back = rebuild(segs, sources);
  const sig = signature(note.blocks);
  if (signature(back) !== sig) { console.error('NOT WRITTEN — the plan does not rebuild the note.'); process.exit(1); }
  const sql = toSql({ title: note.title, segs, sig, count: note.blocks.length, user, sources: refs });
  writeFileSync(out, sql);
  const lit = segs.filter(s => s[0] === '=').reduce((n, s) => n + s[4].length, 0);
  console.log(`${note.title}: ${note.blocks.length} blocks, ${segs.length} segments, ${lit} literal lines, ${sql.length.toLocaleString()} chars of SQL -> ${out}`);
}
