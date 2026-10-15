// note-push.test.mjs — synthetic data only; never the operator's notes.
//   node tools/note-push.test.mjs
import assert from 'node:assert/strict';
import { plan, rebuild, signature, codeOf, blockOf, toSql } from './note-push.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// codes round-trip for every supported type
for (const b of [{ t: 'p' }, { t: 'h1' }, { t: 'h2' }, { t: 'h3' }, { t: 'quote' }, { t: 'code' },
  { t: 'li', depth: 0 }, { t: 'li', depth: 3 }, { t: 'ol', depth: 1 },
  { t: 'check', depth: 0, done: false }, { t: 'check', depth: 2, done: true }]) {
  const back = blockOf(codeOf(b));
  ok(back.t === b.t && (back.depth || 0) === (b.depth || 0) && !!back.done === !!b.done, `code round-trip ${JSON.stringify(b)}`);
}
assert.throws(() => codeOf({ t: 'p', marks: [[0, 1, 'b']] })); n++;
assert.throws(() => codeOf({ t: 'table' })); n++;

const A = ['Day one (OLD)', 'get milk', 'call bank', '', '\tsub point', '[ ] typed box', 'notes'];
const B = ['New list', 'walk dog', 'get milk', 'call bank'];
const target = [
  { t: 'p', text: 'Merged' },                         // literal: in no source
  { t: 'p', text: 'New list' },
  { t: 'check', text: 'walk dog', done: false, depth: 0 },
  { t: 'check', text: 'get milk', done: true, depth: 0 },
  { t: 'li', text: 'call bank', depth: 0 },
  { t: 'p', text: '' },
  { t: 'li', text: 'sub point', depth: 1 },           // tab stripped
  { t: 'check', text: 'typed box', done: false, depth: 0 }, // [ ] stripped
  { t: 'p', text: 'notes' },
];
const sources = { A, B };
const segs = plan(target, sources);
const back = rebuild(segs, sources);
ok(signature(back) === signature(target), 'plan rebuilds the target exactly');
ok(segs.filter(s => s[0] === '=').reduce((k, s) => k + s[4].length, 0) <= 2, 'only unknown text travels as text');
ok(segs.some(s => s[0] === 'B' && s[1] === 0), 'continuation reuses one segment for consecutive source lines');

// no sources: a plain full push still rebuilds exactly
const solo = plan(target, {});
ok(signature(rebuild(solo, {})) === signature(target), 'literal-only plan rebuilds the target');

// signature sees every field
ok(signature(target) !== signature(target.map((b, i) => i === 3 ? { ...b, done: false } : b)), 'signature sees checked state');
ok(signature(target) !== signature(target.map((b, i) => i === 6 ? { ...b, depth: 0 } : b)), 'signature sees depth');

// SQL guards
const sql = toSql({ title: "It's", segs, sig: signature(target), count: target.length,
  user: '00000000-0000-0000-0000-000000000000', sources: { A: 'Day one (OLD)', B: '00000000-0000-0000-0000-000000000001' } });
ok(sql.includes("'It''s'"), 'title is quoted');
ok(/dup\.n = 0/.test(sql) && /chk\.sig = /.test(sql), 'insert is gated on no duplicate and the signature');
ok(sql.includes("id = '00000000-0000-0000-0000-000000000001'::uuid") && sql.includes("title = 'Day one (OLD)'"), 'sources by id or title');

console.log(`note-push: ${n} passed`);
