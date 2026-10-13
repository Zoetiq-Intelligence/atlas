// merge-notes.test.mjs — the merge tool, on made-up notes only.
//   node tools/merge-notes.test.mjs
// The real notes are private; the rules they exposed are reproduced here in miniature.
import { writeFileSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('./merge-notes.mjs', import.meta.url));
let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const dir = mkdtempSync(join(tmpdir(), 'merge-test-'));
const crlf = ls => ls.join('\r\n') + '\r\n';
// older note: a copied run of 4 (one line later EXTENDED in the newer note), a lone
// repeated task that must survive in both places, and a line the newer copy dropped.
// "gym" is deliberately NOT adjacent to the copied run in the older note: blank lines are
// skipped when matching, so a line right after a run in both notes IS part of the copy.
writeFileSync(join(dir, 'old.txt'), crlf([
  'Today', '', 'decide on heat for desk', '',
  'dream', 'a podcast came up in the stream', 'attic room with friends', 'awkward three way call', '',
  'groceries', 'milk', 'granola', '', 'gym', '', 'RETURN', 'old item', '', '\tindented thought', '[ ] boxed task',
]));
writeFileSync(join(dir, 'new.txt'), crlf([
  'New Day', '', 'Atlas', 'get the scroll named', 'buy developer account', '',
  'dream', 'a podcast came up in the stream about strength in mentors', 'attic room with friends', 'awkward three way call', '',
  'gym',
]));
let out = '';
try { out = execFileSync('node', [tool, join(dir, 'old.txt'), join(dir, 'new.txt'), join(dir, 'out')], { encoding: 'utf8' }); }
catch (e) { out = (e.stdout || '') + (e.stderr || ''); }

ck(/COVERAGE: 0 source lines missing/.test(out), 'nothing is lost: ' + (out.match(/COVERAGE:.*/) || [''])[0]);
const files = readdirSync(join(dir, 'out'));
ck(files.length === 3, 'writes the two OLD notes and the merge: ' + files.join(', '));
const read = n => JSON.parse(readFileSync(join(dir, 'out', files.find(f => f.startsWith(n))), 'utf8'));
const m = read('New Day.').doc.blocks;
const texts = m.map(b => b.text);

ck(texts[0] === 'New Day', 'the newer note leads: newest at the top');
ck(texts.filter(t => t === 'attic room with friends').length === 1, 'a copied run appears once');
ck(texts.some(t => t.endsWith('about strength in mentors')) && !texts.includes('a podcast came up in the stream'),
   'an extended line keeps its longer form and the shorter copy is not repeated');
ck(texts.filter(t => t === 'gym').length === 2, 'a lone repeated task is a separate day\'s task — kept in both places');
ck(texts.includes('decide on heat for desk'), 'a line the newer copy dropped is still there');
ck(read('Today (OLD)').doc.blocks[0].text === 'Today (OLD)', 'the older note is marked OLD');
ck(read('New Day (OLD)').doc.blocks.every(b => b.t === 'p'), 'the OLD notes are verbatim, no structure added');

const kind = t => m.find(b => b.text === t);
ck(kind('get the scroll named').t === 'check', 'a task in a run becomes a checkbox');
ck(kind('milk').t === 'li' && !kind('milk').depth, 'a plain item in a run becomes a bullet');
ck(kind('groceries').t === 'p', 'a short non-task first line stays a label');
ck(kind('RETURN').t === 'p', 'a single word opening a run is a label even when it is a verb');
ck(kind('indented thought').t === 'li' && kind('indented thought').depth === 1, 'an indented line becomes a hyphen (nested bullet)');
ck(kind('boxed task').t === 'check', 'a typed [ ] becomes the checkbox itself');
ck(kind('decide on heat for desk').t === 'p', 'a line on its own stays exactly as written');

let refused = '';
try { execFileSync('node', [tool, join(dir, 'old.txt'), join(dir, 'new.txt'), fileURLToPath(new URL('../tmp-out', import.meta.url))], { encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { refused = String(e.stderr); }
ck(/PUBLIC/.test(refused), 'refuses to write private notes inside the public repo');

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
