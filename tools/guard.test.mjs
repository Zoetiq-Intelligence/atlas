// guard.test.mjs — the public-repo guard every note tool shares, and the tools' refusals.
//   node tools/guard.test.mjs
// Nothing is written anywhere: every run below is refused before it touches a file.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, insideRepo } from './guard.mjs';

let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };
const tool = n => fileURLToPath(new URL('./' + n, import.meta.url));
const run = (n, args) => { try { execFileSync('node', [tool(n), ...args], { encoding: 'utf8', stdio: 'pipe' }); return ''; }
                           catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

ck(insideRepo(join(REPO, 'tmp-out')), 'a folder in the repo is inside it');
ck(insideRepo(REPO), 'the repo itself is inside it');
const flipped = REPO[0] === REPO[0].toLowerCase() ? REPO[0].toUpperCase() + REPO.slice(1) : REPO[0].toLowerCase() + REPO.slice(1);
ck(insideRepo(join(flipped, 'x')), 'a different-case path to the repo is still inside it (Windows)');
ck(!insideRepo(REPO + '-private'), 'a sibling folder whose name starts the same is not inside it');

const low = join(flipped, 'zz-guard-test');
ck(/PUBLIC/.test(run('merge-notes.mjs', ['a.txt', 'b.txt', low])), 'merge-notes refuses a different-case repo path');
ck(/PUBLIC/.test(run('note-push.mjs', ['a.json', join(low, 'x.sql'), '--user', '00000000-0000-0000-0000-000000000000'])),
   'note-push refuses a different-case repo path');
ck(/PUBLIC/.test(run('sql-run.mjs', [join(low, 'x.sql')])), 'sql-run refuses a .sql inside the repo');
ck(/unknown: --readonly/.test(run('sql-run.mjs', ['x.sql', '--readonly'])), 'sql-run refuses a mistyped flag instead of running a write');

console.log(`\nguard: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
