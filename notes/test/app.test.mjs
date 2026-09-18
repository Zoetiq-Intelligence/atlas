// Browser tests. Not a project dependency — nothing here ships to the client.
// Needs playwright available somewhere on the machine:
//   PW=$(node -e "console.log(require.resolve('playwright'))") \
//   CHROME=/path/to/chrome node test/editor.test.mjs http://127.0.0.1:8111
const pwPath = process.env.PW || 'playwright';
const pw = (await import(pwPath)).default ?? (await import(pwPath));
const { chromium } = pw;
const CHROME = process.env.CHROME || undefined;
const base = process.argv[2];
let pass=0, fail=0;
const ck=(c,m)=>{ c?pass++:(fail++,console.log('  FAIL:',m)); };

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = 'h.' + b64u({ sub: '11111111-2222-3333-4444-555555555555', exp: 9e9 }) + '.s';

const notes = [];
const folders = [{ id: 'f1', name: 'Work', sort: 0 }];

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
// Declared up here because the console filter below closes over it: the
// "backend not installed" test deliberately provokes 404s, and those must not be
// counted as page errors — while every OTHER unexpected 404 still is.
let snapshotMode = 'ok';     // 'ok' | 'missing' — 'missing' = the SQL was never run
const errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e));
p.on('console', m=>{ if(m.type()!=='error') return;
  if(/favicon|status of 403/.test(m.text())) return;
  if(snapshotMode==='missing' && /status of 404/.test(m.text())) return;   // provoked on purpose
  errs.push('console: '+m.text()); });

let restCalls = [];
let profileHeaders = [];
let snapshots = [];          // newest first, like the real order=taken_at.desc
let rpcCalls = [];
await p.route('**/ymcewqdxtfxskyuizlqx.supabase.co/**', async route => {
  const u = new URL(route.request().url());
  const m = route.request().method();
  restCalls.push(m + ' ' + u.pathname);
  if (u.pathname.startsWith('/rest/')) {
    const h = route.request().headers();
    profileHeaders.push({ m, accept: h['accept-profile'] || null, content: h['content-profile'] || null });
  }
  if (u.pathname.startsWith('/auth/v1/otp'))
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  if (u.pathname.startsWith('/auth/v1/verify')) {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.token !== '424242')
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"msg":"bad otp"}' });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: JWT, refresh_token: 'r3', expires_in: 3600 }) });
  }
  if (u.pathname.startsWith('/auth/v1/token'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: JWT, refresh_token: 'r2', expires_in: 3600 }) });
  if (u.pathname === '/rest/v1/folder')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(folders) });
  if (u.pathname === '/rest/v1/note') {
    if (m === 'POST') {
      const row = JSON.parse(route.request().postData() || '{}');
      row.updated_at = new Date().toISOString();
      const i = notes.findIndex(n => n.id === row.id);
      i >= 0 ? notes[i] = row : notes.push(row);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes) });
  }
  // ---- backups ----------------------------------------------------------
  if (u.pathname === '/rest/v1/rpc/take_snapshot') {
    const body = JSON.parse(route.request().postData() || '{}');
    rpcCalls.push({ fn: 'take_snapshot', body });
    if (snapshotMode === 'missing')
      return route.fulfill({ status: 404, contentType: 'application/json',
        body: '{"code":"PGRST202","message":"Could not find the function"}' });
    const last = snapshots[0];
    const minS = body.p_min_interval_seconds;
    // The server owns the interval too, so two devices cannot both take one.
    if (minS > 0 && last && Date.now() - Date.parse(last.taken_at) < minS * 1000)
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ created: false, why: 'not_due', latest_at: last.taken_at }) });
    const row = { id: 'snap-' + (snapshots.length + 1), taken_at: new Date().toISOString(),
                  reason: body.p_reason || 'auto', note_count: notes.length,
                  folder_count: folders.length, notes, folders };
    snapshots.unshift(row);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ created: true, id: row.id, taken_at: row.taken_at,
                             latest_at: row.taken_at, reason: row.reason,
                             notes: row.note_count, folders: row.folder_count }) });
  }
  if (u.pathname === '/rest/v1/rpc/restore_snapshot') {
    rpcCalls.push({ fn: 'restore_snapshot', body: JSON.parse(route.request().postData() || '{}') });
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ restored_notes: 3, restored_folders: 1, trashed_notes: 1,
                             from: snapshots[0] && snapshots[0].taken_at,
                             safety_snapshot: { created: true, latest_at: new Date().toISOString() } }) });
  }
  if (u.pathname === '/rest/v1/snapshot') {
    if (snapshotMode === 'missing')
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST205"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshots) });
  }

  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

// --- gate renders when signed out ----------------------------------------
await p.goto(base + '/index.html');
await p.waitForSelector('#gate:not([hidden])', { timeout: 5000 });
ck(await p.isVisible('#gate'), 'sign-in gate shows when signed out');
ck(await p.isHidden('#app'), 'app hidden when signed out');

// --- sending a magic link -------------------------------------------------
await p.fill('#email', 'xenovigor@gmail.com');
await p.click('#f-email .go');
await p.waitForFunction(() => document.querySelector('#gate .msg').textContent.includes('Check your email'), null, { timeout: 5000 });
ck(restCalls.some(c => c.startsWith('POST /auth/v1/otp')), 'login email POSTed to /auth/v1/otp');
ck(await p.isVisible('#f-code'), 'code entry appears after sending');
ck(await p.isHidden('#f-email'), 'email form hides');

// --- a wrong code is rejected, and does not sign you in ------------------
await p.fill('#code', '111111');
await p.click('#f-code .go');
await p.waitForFunction(() => document.querySelector('#gate .msg').textContent.includes('wrong'), null, { timeout: 5000 });
ck(await p.isVisible('#gate'), 'wrong code leaves you at the gate');

// --- the right code signs you in, WITHOUT any redirect ------------------
// This is the path the installed iPhone app must use: iOS gives a home-screen
// web app storage separate from Safari, so a magic link can never sign it in.
await p.fill('#code', '424242');
await p.click('#f-code .go');
await p.waitForSelector('#app:not([hidden])', { timeout: 8000 });
ck(await p.isHidden('#gate'), 'code sign-in reached the app with no redirect');
await p.evaluate(() => indexedDB.deleteDatabase('notes'));

// --- the magic-link return: tokens in the fragment (implicit flow) --------
await p.goto(base + `/index.html?r=1#access_token=${JWT}&refresh_token=r1&expires_in=3600&token_type=bearer`);
await p.waitForSelector('#app:not([hidden])', { timeout: 8000 });
ck(true, 'app booted after magic-link return');
ck(await p.evaluate(() => location.hash) === '', 'URL fragment scrubbed after consuming tokens');

// --- panes and footer -----------------------------------------------------
ck(await p.locator('.pane').count() === 2, 'two panes exist');
ck(await p.locator('#footer .frow').count() === 2, 'footer has exactly two rows');
const btns = await p.locator('#footer .fbtn').count();
ck(btns >= 18, 'footer has the full flat control set, got ' + btns);
ck(await p.isVisible('#gutter'), 'gutter handle visible');

// --- typing into pane 0 creates and saves a note -------------------------
await p.click('.pane:nth-of-type(1) .editor .txt');
await p.keyboard.type('Shopping list');
await p.keyboard.press('Enter');
await p.keyboard.type('oat milk');
await p.waitForTimeout(1400);
ck(await p.locator('.pane:nth-of-type(1) .row').count() === 2, 'two blocks in pane 0');
const ttl = await p.locator('.pane:nth-of-type(1) .ttl').textContent();
ck(ttl.trim() === 'Shopping list', 'pane header shows denormalised title, got: ' + ttl);

// --- footer applies a block type -----------------------------------------
await p.click('#footer .fbtn[data-k="block"][data-v="check"]');
await p.waitForTimeout(150);
ck(await p.locator('.pane:nth-of-type(1) .row[data-t="check"]').count() === 1, 'footer created a checklist block');

// --- it reached the stub server ------------------------------------------
await p.evaluate(() => window.dispatchEvent(new Event('online')));
await p.waitForTimeout(900);
ck(notes.length >= 1, 'note upserted to the server, count=' + notes.length);
ck(notes.some(n => n.title === 'Shopping list'), 'server row carries the title');
ck(notes.every(n => !('user_id' in n)), 'client never sends user_id — RLS defaults it');

// The tables live in a dedicated `notes` Postgres schema, not `public`. PostgREST
// reaches it only by header, and a write missing Content-Profile silently targets
// public and 404s.
const reads = profileHeaders.filter(h => h.m === 'GET');
const writes = profileHeaders.filter(h => h.m !== 'GET');
ck(reads.length > 0 && reads.every(h => h.accept === 'notes'), 'every read sends Accept-Profile: notes');
ck(writes.length > 0 && writes.every(h => h.content === 'notes'), 'every write sends Content-Profile: notes');

// --- the idle gate must actually open ---------------------------------------
// REGRESSION GUARD. The first isBusy() counted "caret is inside the editor" as busy.
// A notes app focuses its editor at boot, so busy() was true forever, the handover
// never fired, and the app could never update itself — a fix would be live on the
// server and never reach the device. An app that can never report itself idle can
// never take a new build.
await p.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
await p.click('.pane:nth-of-type(1) .editor .txt');       // caret deliberately IN the text
await p.waitForTimeout(1700);                              // past the typing grace window
const busyWithCaret = await p.evaluate(() => window.UPDATE && window.UPDATE.isBusy());
ck(busyWithCaret === false, `idle with the caret parked in the editor (got ${busyWithCaret})`);

await p.keyboard.type('x');
const busyTyping = await p.evaluate(() => window.UPDATE.isBusy());
ck(busyTyping === true, 'busy immediately after a keystroke — never reload mid-sentence');

await p.waitForTimeout(1800);
const busyAfter = await p.evaluate(() => window.UPDATE.isBusy());
ck(busyAfter === false, `idle again once typing stops (got ${busyAfter})`);

await p.evaluate(() => {
  const t = document.querySelector('.row .txt');
  const r = document.createRange(); r.selectNodeContents(t);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const busySel = await p.evaluate(() => window.UPDATE.isBusy());
ck(busySel === true, 'busy while a selection is live — a reload would destroy it');
await p.evaluate(() => getSelection().removeAllRanges());

// --- sidebar --------------------------------------------------------------
await p.click('.pane:nth-of-type(1) [data-act="list"]');
await p.waitForTimeout(320);
ck(await p.isVisible('#sidebar'), 'slide-over list opens');
ck(await p.locator('#folders button').count() >= 2, 'folders rendered from server');
ck(await p.locator('.nrow').count() >= 1, 'note list has rows');
await p.fill('#search', 'zzzzz');
await p.waitForTimeout(120);
ck(await p.locator('#list .empty').count() === 1, 'search filters to empty');
await p.fill('#search', 'oat');
await p.waitForTimeout(120);
ck(await p.locator('.nrow').count() >= 1, 'search matches body text, not just title');
await p.mouse.click(378, 500);   // the visible sliver beside the slide-over
await p.waitForTimeout(300);

// --- backups ---------------------------------------------------------------
// The operator's requirement: a snapshot whenever an instance is on and six hours
// have passed, with a way back. The snapshot is built server-side, so these tests
// assert the CLIENT's two jobs — asking at the right moments, and never destroying
// anything on one tap.
const takes = rpcCalls.filter(c => c.fn === 'take_snapshot');
ck(takes.length >= 1, 'a snapshot is requested at boot, got ' + takes.length);
ck(snapshots.length === 1,
   'a second instance inside six hours does NOT take a duplicate, got ' + snapshots.length);
ck(takes.every(c => c.body.p_min_interval_seconds === 21600),
   'the automatic path asks with the six-hour interval, never 0');

// A backup RPC that reached `public` instead of `notes` would 404 forever. The
// profile-header assertions above cover every /rest/ call, these included.
const rpcWrites = profileHeaders.filter(h => h.m === 'POST');
ck(rpcWrites.length > 0 && rpcWrites.every(h => h.content === 'notes'),
   'the backup RPCs carry Content-Profile: notes like every other write');

await p.click('.pane:nth-of-type(1) [data-act="list"]');
await p.waitForTimeout(320);
await p.click('#backups');
await p.waitForSelector('#backups-panel:not([hidden])', { timeout: 4000 });
await p.waitForTimeout(250);
ck(await p.locator('#bk-list .bk-row').count() === 1, 'the panel lists the snapshot');
ck((await p.locator('#bk-status').textContent()).includes('next due'),
   'the panel says when the next backup is due');

// "Back up now" must mean now — the interval is the automatic path's rule, not a
// rule about the button.
await p.click('#bk-now');
await p.waitForTimeout(600);
const manual = rpcCalls.filter(c => c.fn === 'take_snapshot').pop();
ck(manual.body.p_min_interval_seconds === 0, 'Back up now ignores the six-hour interval');
ck(manual.body.p_reason === 'manual', 'a manual snapshot is labelled manual');
ck(snapshots.length === 2, 'Back up now actually created one, got ' + snapshots.length);

// The SQL not being installed is a DIFFERENT failure from the network being down,
// and must say so — otherwise the one state where there are no backups at all looks
// like a transient blip.
snapshotMode = 'missing';
await p.click('#bk-close');
await p.click('#backups');
await p.waitForTimeout(400);
const msg = await p.locator('#bk-status').textContent();
ck(/not set up|SETUP-BACKUP/.test(msg), 'an uninstalled backend says so plainly, got: ' + msg);
snapshotMode = 'ok';
await p.click('#bk-close');

// One tap must never restore. This is a data-loss button in a list of similar-looking
// dates, so the first tap only arms it.
await p.click('#backups');
await p.waitForTimeout(400);
await p.locator('#bk-list .bk-row button').nth(1).click();
await p.waitForTimeout(250);
ck(rpcCalls.filter(c => c.fn === 'restore_snapshot').length === 0,
   'one tap does NOT restore — it only arms the button');
ck((await p.locator('#bk-list .bk-row button').nth(1).textContent()).includes('again'),
   'the armed button says what the next tap will do');
await p.locator('#bk-list .bk-row button').nth(1).click();
await p.waitForTimeout(900);
ck(rpcCalls.filter(c => c.fn === 'restore_snapshot').length === 1, 'the second tap restores');
await p.waitForTimeout(800);   // onRestored pulls and reloads

await p.screenshot({ path: 'shot-phone.png' });

// --- desktop --------------------------------------------------------------
await p.setViewportSize({ width: 1280, height: 820 });
await p.waitForTimeout(250);
const w0 = await p.locator('.pane').first().boundingBox();
const w1 = await p.locator('.pane').last().boundingBox();
ck(Math.abs(w0.width - w1.width) < 30, 'desktop shows two equal panes side by side');
ck(w0.x < w1.x && w1.x > 400, 'panes are genuinely side by side, not stacked');
await p.screenshot({ path: 'shot-desktop.png' });

// --- dark mode ------------------------------------------------------------
await p.emulateMedia({ colorScheme: 'dark' });
await p.waitForTimeout(150);
const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
ck(bg === 'rgb(28, 28, 30)', 'dark theme applies, body bg = ' + bg);
await p.screenshot({ path: 'shot-dark.png' });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (errs.length) { console.log('\nPAGE ERRORS:'); [...new Set(errs)].slice(0,10).forEach(e=>console.log(' ', e)); }
await b.close();
process.exit(fail || errs.length ? 1 : 0);
