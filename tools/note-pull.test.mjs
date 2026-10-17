// note-pull.test.mjs — the pull tool, offline, on made-up notes only.
//   node tools/note-pull.test.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toFiles, fileName } from './note-pull.mjs';

const tool = fileURLToPath(new URL('./note-pull.mjs', import.meta.url));
let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const row = { id: 'x', title: 'New Day (OLD)', doc: { v: 1, blocks: [
  { id: 'a', t: 'p', text: 'New Day (OLD)', marks: [] },
  { id: 'b', t: 'p', text: '', marks: [] },
  { id: 'c', t: 'check', text: 'call the school', marks: [], done: true },
  { id: 'd', t: 'p', text: '\tindented', marks: [] },
] } };
const f = toFiles(row);
ck(f.txt === 'New Day (OLD)\n\ncall the school\n\tindented', 'the .txt is the note\'s plain text, tabs and blanks intact');
ck(f.lines === 4, 'it counts blocks as lines');
ck(/^[0-9a-f]{32}$/.test(f.md5), 'it fingerprints the text');
const j = JSON.parse(f.json);
ck(j.atlas === 'note' && j.title === 'New Day (OLD)' && j.doc.blocks[2].done === true,
   'the .atlasnote.json keeps structure, the shape note-push.mjs takes as a source');
ck(fileName('a/b:c?') === 'abc' && fileName('') === 'untitled', 'file names are made safe');

const run = args => { try { execFileSync('node', [tool, ...args], { encoding: 'utf8', stdio: 'pipe' }); return ''; }
                      catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
ck(/PUBLIC/.test(run([fileURLToPath(new URL('../tmp-pull', import.meta.url)), '00000000-0000-0000-0000-000000000000'])),
   'refuses to write private notes inside the public repo');
ck(/not note ids/.test(run([process.env.TEMP || '/tmp', 'nope'])), 'refuses anything that is not a note id, before any request');

console.log(`\nnote-pull: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
