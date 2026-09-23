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

// Live sync opens a real WebSocket, which cannot reach Supabase from a test runner and
// logs a console error that would fail this suite. Stub it with a socket that opens and
// then says nothing: the client sends its join and waits, so there are no retries, no
// timers churning, and no noise. The PROTOCOL itself is tested for real, against a
// driveable fake, in realtime.test.mjs.
await p.addInitScript(() => {
  window.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0;
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 1); }
    send() {}
    close() { this.readyState = 3; }
  };
});

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
const ttl = await p.locator('#tabs .tab[data-pane="0"] .tt').textContent();
ck(ttl.trim() === 'Shopping list', 'header segment shows the denormalised title, got: ' + ttl);

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
await p.click('#topbar [data-act="list"]');
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

// --- the same note open in BOTH panes --------------------------------------
// Reported 2026-09-18: "even if i have the same note open on both sides of phone,
// editing one doesn't sync to the other". No network is involved in this one. Only
// the title was mirrored, so the second pane went on rendering a document that no
// longer existed — and its own next save would write that stale copy back over the
// edit. A way to lose text on a single device.
await p.setViewportSize({ width: 1280, height: 820 });
await p.waitForTimeout(250);
await p.click('.pane:nth-of-type(2) .editor .txt');     // focus pane 1
await p.waitForTimeout(150);
await p.click('#topbar .tabmenu[data-pane="1"]');       // the RIGHT pane's own list
await p.waitForTimeout(320);
await p.locator('.nrow .nmain').first().click();        // opens into that pane
await p.waitForTimeout(450);

const titlesBefore = await p.evaluate(() => [...document.querySelectorAll('.tab .tt')].map(e => e.textContent));
ck(titlesBefore[0] === titlesBefore[1],
   'the same note can be opened into both panes, got ' + JSON.stringify(titlesBefore));

await p.click('.pane:nth-of-type(1) .editor .txt');
await p.keyboard.press('End');
await p.keyboard.type(' MIRRORED');
await p.waitForTimeout(1200);
const pane1Text = await p.locator('.pane:nth-of-type(2) .editor').innerText();
ck(pane1Text.includes('MIRRORED'),
   'an edit in one pane reaches the other pane showing the same note, got: '
   + JSON.stringify(pane1Text.slice(0, 70)));

await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(250);

// --- THREE-WAY PARITY -------------------------------------------------------
// "EVERY function for content gets keyboard shortcuts, selection menu, and footer
// buttons. EVERY single one." This is the acceptance test for that sentence, and the
// red-highlight rule is its in-app twin: anything short of all three must LOOK
// unfinished without anyone running this file.
await p.click('.pane:nth-of-type(1) .editor .txt');
await p.waitForTimeout(150);

const parity = await p.evaluate(() => (window.__PARITY__ || []).map(r => ({
  id: r.cmd.id, key: r.cmd.key, footer: r.footer, menu: r.menu, hasKey: r.key,
  impl: r.impl, ok: r.ok, missing: r.missing,
})));
ck(parity.length >= 20, `every command is audited, got ${parity.length}`);
const broken = parity.filter(r => !r.ok);
ck(broken.length === 0,
   'every command has footer + selection menu + shortcut + implementation; missing: '
   + JSON.stringify(broken.map(b => b.id + ':' + b.missing.join('/'))));

// Each surface really renders them all — audited against the DOM, not a list.
const nFooter = await p.locator('#footer .fbtn').count();
const nMenu = await p.locator('#selmenu .selbtn').count();
ck(nFooter === parity.length, `the footer renders every command (${nFooter}/${parity.length})`);
ck(nMenu === parity.length, `the selection menu renders every command (${nMenu}/${parity.length})`);

// No key collisions: two commands on one chord means one of them is unreachable.
const keys = parity.map(r => r.key);
ck(new Set(keys).size === keys.length, 'no two commands share a shortcut: ' + keys.join(''));

// The tooltip must PRINT the shortcut — that is how the keymap documents itself.
const lbl = await p.locator('#footer .fbtn[data-id="bold"]').getAttribute('aria-label');
ck(/Space A/i.test(lbl || ''), 'the footer button announces its shortcut, got: ' + lbl);
ck(await p.locator('#footer .fbtn[data-id="bold"]').getAttribute('title') === null,
   'the native title is removed, or it appears a second later under ours');

// Instant, with no hover delay: the tooltip is on screen on the very next frame.
await p.locator('#footer .fbtn[data-id="bold"]').hover();
await p.waitForTimeout(60);
ck(await p.locator('#tip').isVisible(), 'the tooltip shows immediately on hover');
const tipText = await p.locator('#tip').textContent();
ck(/Bold/.test(tipText) && /Space A/i.test(tipText), 'the tooltip names the command and its key: ' + tipText);

// The red highlight has to actually be reachable, or the rule is decorative. Force a
// gap and confirm the button paints as unfinished.
const marked = await p.evaluate(async () => {
  const mod = await import('./js/editor/commands.js');
  const cmd = mod.COMMANDS.find(c => c.id === 'quote');
  const realKey = cmd.key;
  cmd.key = '';                                   // simulate a command with no shortcut
  mod.markParity(document.querySelector('#footer'), document.querySelector('#selmenu'));
  const el = document.querySelector('#footer .fbtn[data-id="quote"]');
  const out = { cls: el.classList.contains('incomplete'), missing: el.dataset.missing,
                shadow: getComputedStyle(el).boxShadow };
  cmd.key = realKey;                              // put it back
  mod.markParity(document.querySelector('#footer'), document.querySelector('#selmenu'));
  out.restored = !document.querySelector('#footer .fbtn[data-id="quote"]').classList.contains('incomplete');
  return out;
});
ck(marked.cls, 'a command missing a surface is marked incomplete');
ck(/shortcut/.test(marked.missing || ''), 'and says what it is missing: ' + marked.missing);
ck(/rgb/.test(marked.shadow) && marked.shadow !== 'none',
   'the incomplete mark is a visible highlight, got: ' + marked.shadow);
ck(marked.restored, 'and it clears again once parity is restored');

// --- the selection menu appears on SELECTION, not right-click ---------------
await p.click('.pane:nth-of-type(1) .editor .txt');
await p.keyboard.press('End');
await p.evaluate(() => {
  const t = document.querySelector('.pane .editor .txt');
  const r = document.createRange();
  r.selectNodeContents(t);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
});
await p.waitForTimeout(300);
ck(await p.locator('#selmenu').isVisible(), 'selecting text raises the selection menu');
await p.evaluate(() => { getSelection().removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
await p.waitForTimeout(250);
ck(await p.locator('#selmenu').isHidden(), 'and it goes away when the selection does');

// --- the Space chord --------------------------------------------------------
// Space is a printing character, so the whole design question is how a chord can
// exist without ever eating a space someone meant to type. Both halves are asserted:
// a deliberate hold fires the command, a fast overlap does not.
await p.click('.pane:nth-of-type(1) .editor .txt');
await p.keyboard.press('End');
await p.evaluate(() => {
  const t = document.querySelector('.pane .editor .txt');
  const r = document.createRange(); r.selectNodeContents(t);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await p.waitForTimeout(120);
await p.keyboard.down(' ');
await p.waitForTimeout(160);                 // past the 90ms dwell
await p.keyboard.press('a');                 // asdf row, position 1 = Bold
await p.keyboard.up(' ');
await p.waitForTimeout(300);
const boldOn = await p.getAttribute('#footer .fbtn[data-id="bold"]', 'aria-pressed');
ck(boldOn === 'true', `Space+A applies Bold, footer says aria-pressed=${boldOn}`);

// The other half: too fast to be a chord, so BOTH characters must type.
const beforeFast = await p.locator('.pane:nth-of-type(1) .editor .txt').first().innerText();
await p.evaluate(() => { const s = getSelection(); s.removeAllRanges(); });
await p.click('.pane:nth-of-type(1) .editor .txt');
await p.keyboard.press('End');
await p.keyboard.down(' ');
await p.keyboard.press('q');                 // would be Bulleted if it chorded
await p.keyboard.up(' ');
await p.waitForTimeout(300);
const afterFast = await p.locator('.pane:nth-of-type(1) .editor .txt').first().innerText();
ck(afterFast.length > beforeFast.length,
   `a fast space+key types instead of chording (${JSON.stringify(beforeFast.slice(-12))} -> ${JSON.stringify(afterFast.slice(-12))})`);

// --- the LAlt / Space split -------------------------------------------------
// 2026-09-23: the operator's existing PC Workflows system (AHK, FancyZones) puts ALL
// its hotkeys on LAlt. The split only works if the Space layer never touches an
// Alt-held key — so that property is asserted here rather than left as an accident
// of a guard clause that someone could "tidy" away.
//
// Alt+Space matters most: it is the Windows window menu, and PowerToys Run's default.
// It is the one place the two modifiers physically meet.
const altPassed = await p.evaluate(() => {
  const t = document.querySelector('.pane .editor .txt');
  t.focus();
  const fire = init => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    t.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const altSpace = fire({ key: ' ', code: 'Space', altKey: true });
  const altA = fire({ key: 'a', code: 'KeyA', altKey: true });
  // and nothing was left half-held by the Alt+Space press
  const stuck = fire({ key: 'a', code: 'KeyA' });
  return { altSpace, altA, stuck };
});
ck(altPassed.altSpace === false,
   'Alt+Space passes through untouched — the Windows window menu and PowerToys Run live there');
ck(altPassed.altA === false, 'an LAlt chord is never intercepted by the Space layer');
ck(altPassed.stuck === false, 'an Alt+Space press leaves no half-held Space behind');

// --- naming the destination pane -------------------------------------------
// "not one that relies on what we clicked into last" — every route into a note now
// names the pane it fills, so the same gesture means the same thing every time.
await p.setViewportSize({ width: 1280, height: 820 });
await p.waitForTimeout(250);

ck(await p.locator('#topbar .tabmenu').count() === 2, 'desktop has a list button per pane');
ck(await p.locator('#topbar .tabmenu[data-pane="1"]').isVisible(), 'the right pane has its own list button');
ck(await p.isHidden('#topbar > [data-act="list"]'), 'the single phone list button is not shown on desktop');

// open the RIGHT pane's list and tap a title: it must land on the right, regardless
// of which pane was touched last.
await p.click('.pane:nth-of-type(1) .editor .txt');       // focus the LEFT pane first
await p.waitForTimeout(150);
await p.click('#topbar .tabmenu[data-pane="1"]');
await p.waitForTimeout(320);
ck((await p.locator('#dest').textContent()).includes('right'),
   'the list says which pane it will fill');
const rowTitle = (await p.locator('.nrow .t').first().textContent()).replace(/^★ /, '');
await p.locator('.nrow .nmain').first().click();
await p.waitForTimeout(420);
const rightTab = await p.locator('.tab[data-pane="1"] .tt').textContent();
ck(rightTab === rowTitle,
   `a title tapped in the right list opens on the RIGHT (${JSON.stringify(rightTab)} vs ${JSON.stringify(rowTitle)})`);

// the per-row buttons override whatever list you are in
await p.click('#topbar .tabmenu[data-pane="1"]');
await p.waitForTimeout(320);
ck(await p.locator('.nrow').first().locator('.nsend').count() === 2,
   'every row carries both destinations');
const rowTitle2 = (await p.locator('.nrow .t').first().textContent()).replace(/^★ /, '');
await p.locator('.nrow').first().locator('.nsend[data-pane="0"]').click();
await p.waitForTimeout(420);
const leftTab = await p.locator('.tab[data-pane="0"] .tt').textContent();
ck(leftTab === rowTitle2,
   `the left button wins over the list's own pane (${JSON.stringify(leftTab)} vs ${JSON.stringify(rowTitle2)})`);

// --- swiping a row ---------------------------------------------------------
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(250);
await p.click('#topbar > [data-act="list"]');
await p.waitForTimeout(320);
const swipeRow = p.locator('.nrow').first();
const swipeTitle = (await swipeRow.locator('.t').textContent()).replace(/^★ /, '');
const rb = await swipeRow.boundingBox();
await p.mouse.move(rb.x + 40, rb.y + rb.height / 2);
await p.mouse.down();
// past the 56px threshold, in steps so the handler sees a drag rather than a jump
for (let x = 50; x <= 130; x += 20) { await p.mouse.move(rb.x + x, rb.y + rb.height / 2); await p.waitForTimeout(20); }
await p.mouse.up();
await p.waitForTimeout(500);
const swiped = await p.locator('.tab[data-pane="1"] .tt').textContent();
ck(swiped === swipeTitle,
   `swiping a row right sends it to the right pane (${JSON.stringify(swiped)} vs ${JSON.stringify(swipeTitle)})`);

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

await p.click('#topbar [data-act="list"]');
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
