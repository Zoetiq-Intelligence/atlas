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
const errs=[];
p.on('pageerror', e=>errs.push('pageerror: '+e));
p.on('console', m=>{ if(m.type()==='error' && !/favicon|status of 403/.test(m.text())) errs.push('console: '+m.text()); });

let restCalls = [];
let profileHeaders = [];
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
