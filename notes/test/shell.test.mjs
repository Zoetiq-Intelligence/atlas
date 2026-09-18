// shell.test.mjs — the lexical guards. GUIDE §3.1, §2.x, §8.x.
//
// These exist because the regressions they catch are LOCALLY CORRECT and raise no
// error: a stray env() read, a frame-height on the root chain, a manifest on the hub.
// Nothing at runtime and nothing in a DOM test without a layout engine notices them.
// The only detectable signature is lexical, so a grep is the only guard that can fire
// before the regression reaches a device.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = join(APP, '..');
const read = p => readFileSync(p, 'utf8');
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const css  = ['base', 'layout', 'editor'].map(f => read(join(APP, 'css', f + '.css'))).join('\n');
const cssNoComments = stripComments(css);
const html = read(join(APP, 'index.html'));
const htmlNoComments = stripComments(html);
const hub  = stripComments(read(join(ATLAS, 'index.html')));
const manifest = JSON.parse(read(join(APP, 'manifest.webmanifest')));
const sw = stripComments(read(join(APP, 'sw.js')));

// GUIDE §3.1 — all four insets, defined exactly once each. Two forbids landscape.
const direct = cssNoComments.match(/env\(safe-area-inset-[a-z]+/g) || [];
ck(direct.length === 4, `env(safe-area-inset-*) must appear exactly 4 times, found ${direct.length}`);
for (const side of ['top', 'right', 'bottom', 'left']) {
  ck(new RegExp(`--sa-${side}:\\s*env\\(safe-area-inset-${side}`).test(cssNoComments), `--sa-${side} defined from env()`);
}

// GUIDE §2.3 — never size the root chain from the frame; fixed children clip away.
ck(!/height:\s*var\(--(vp|frame)-h/.test(cssNoComments), 'no frame-height sizing on the root chain');
ck(/html,\s*body\s*\{[^}]*position:\s*fixed/.test(cssNoComments.replace(/\s+/g, ' ')) ||
   /position:\s*fixed/.test(cssNoComments.split('html, body')[1] || ''), 'html/body are pinned');
ck(/#app\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/.test(cssNoComments.replace(/\s+/g, ' ')), '#app is position:fixed; inset:0');

// GUIDE §2.1 / §2.4 / §2.5
// Comments are stripped FIRST — this file's own explanatory comments name every
// forbidden string, and an unstripped grep fires on them. That is the exact false
// positive that gets a guard disabled, after which it protects nothing.
ck(/content="black"/.test(htmlNoComments) && !/black-translucent/.test(htmlNoComments),
   'status bar is black, not black-translucent');
ck(/viewport-fit=cover/.test(htmlNoComments), 'viewport-fit=cover present');
ck(!/height=device-height/.test(htmlNoComments), 'no height=device-height');
ck(!/maximum-scale|user-scalable/.test(htmlNoComments), 'no zoom lock');
ck(/name="mobile-web-app-capable"/.test(htmlNoComments) && /name="apple-mobile-web-app-capable"/.test(htmlNoComments), 'both capable metas');
ck(/format-detection/.test(htmlNoComments), 'format-detection present');

// GUIDE §7.8 — hadController captured synchronously, before any deferred script.
const headCapture = htmlNoComments.indexOf('__HAD_CONTROLLER__');
const firstModule = htmlNoComments.indexOf('<script type="module"');
ck(headCapture > -1 && (firstModule === -1 || headCapture < firstModule),
   'hadController is captured before any module script');

// GUIDE §2.7 — the hub must not be installable.
ck(!/rel="manifest"/.test(hub), 'hub has no manifest link');
ck(!/mobile-web-app-capable/i.test(hub), 'hub has no capable meta');

// GUIDE §8.1 — relative scope and start_url; two spellings are two identities.
ck(manifest.scope === './', 'manifest scope is "./"');
ck(manifest.start_url === './', 'manifest start_url is "./"');

// GUIDE §8.2 — every path relative; Pages serves at /atlas/notes/, not the root.
const absolute = [...htmlNoComments.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map(m => m[1]);
ck(absolute.length === 0, 'no root-absolute paths in the shell: ' + absolute.join(', '));

// GUIDE §8.6 — assert on published bytes, and only on attributes the browser fetches,
// with comments stripped, or the test fires on a placeholder in a label and gets
// disabled by its first false positive.
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.') || e === 'test' || e === 'node_modules') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.html', '.css', '.js'].includes(extname(e))) out.push(p);
  }
  return out;
}
for (const f of walk(ATLAS)) {
  const body = stripComments(read(f));
  const ext = [...body.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  ck(ext.length === 0, `${f.replace(ATLAS, '')} fetches third-party: ${ext.join(', ')}`);
}

// GUIDE §7 — the worker's own invariants.
ck(/notes-[0-9a-f]{12}/.test(sw), 'cache name is a 12-hex content hash');
ck(!/install[\s\S]{0,400}skipWaiting/.test(sw), 'sw does NOT skipWaiting() in install');
ck(/SKIP_WAITING/.test(sw), 'sw takes over only when the page asks');
ck(/url\.origin\s*!==\s*self\.location\.origin/.test(sw), 'sw bails on cross-origin before respondWith');
ck(/AbortController/.test(sw), 'network timeout actually aborts the request');
ck(/PRECACHED\.has/.test(sw), 'precached URLs served from the precache unconditionally');

// GUIDE §8.3
try { statSync(join(ATLAS, '.nojekyll')); pass++; }
catch { fail++; console.log('  FAIL: .nojekyll missing'); }

// GUIDE §7.12 — the reset page must be outside the app's scope.
try { statSync(join(ATLAS, 'reset', 'index.html')); pass++; }
catch { fail++; console.log('  FAIL: reset page missing'); }

// --- the backup SQL keeps its central promise ------------------------------
// restore_snapshot is the one function in this project that can destroy a day's work.
// Its whole safety argument is that it soft-deletes via the same `deleted_at` column
// the app already uses, and hard-deletes NOTHING. That is a property of the text, so a
// grep is exactly the right guard — and the SQL is pasted into a dashboard by hand, so
// no runtime test will ever cover it.
const backupSql = read(join(ATLAS, 'workflow', '_protocol', 'SETUP-BACKUP.sql'));
const sqlNoComments = backupSql.replace(/^\s*--.*$/gm, '');

const restoreBody = sqlNoComments.slice(sqlNoComments.indexOf('function notes.restore_snapshot'));
ck(!/delete\s+from\s+notes\.note\b/i.test(restoreBody),
   'restore_snapshot must never hard-delete a note — it soft-deletes via deleted_at');
ck(!/delete\s+from\s+notes\.folder\b/i.test(restoreBody),
   'restore_snapshot must never delete a folder — on delete set null would detach notes');
ck(/set deleted_at = now\(\)/.test(restoreBody),
   'restore_snapshot soft-deletes what the snapshot does not contain');
ck(/take_snapshot\(0, 'pre-restore'\)/.test(restoreBody),
   'restore_snapshot takes a safety snapshot first, so a restore is itself undoable');

// SETUP-NOTES.sql granted on "all tables in schema notes", which covers only the
// tables that existed when it ran. A new table gets nothing, and the symptom is a 404
// that looks exactly like the schema not being exposed.
ck(/grant[\s\S]*?on notes\.snapshot to authenticated/i.test(sqlNoComments),
   'the snapshot table grants explicitly — it inherits nothing from SETUP-NOTES.sql');
ck(/enable row level security/i.test(sqlNoComments) && /create policy "own snapshots"/i.test(sqlNoComments),
   'the snapshot table has RLS enabled and an owner policy');
ck(/notify pgrst, 'reload schema'/.test(sqlNoComments),
   'the SQL reloads the PostgREST schema cache, or the new function 404s until it does');

// The automatic path must never pass 0 — that would snapshot on every single check.
// Strip LINE comments too, not just block comments. This file's own history is the
// argument: the guards once fired on the explanatory comments that named every
// forbidden string. backup.js has a comment saying it stays out of isBusy() — which
// is precisely the string this asserts is absent from the code.
const stripLine = t => t.replace(/(^|[^:])\/\/.*$/gm, '$1');
const backupJs = stripLine(stripComments(read(join(APP, 'js', 'data', 'backup.js'))));
ck(/INTERVAL_MS = 6 \* 60 \* 60 \* 1000/.test(backupJs), 'the automatic interval is six hours');
ck(!/isBusy/.test(backupJs), 'backup.js stays out of the idle gate — see main.js §5.1b');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
