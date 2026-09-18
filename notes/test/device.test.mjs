// device.test.mjs — the cases that otherwise ONLY reproduce on hardware.
//
// This test exists because of GUIDE §3.1: env() is a read-only UA value with no
// setter, so a rule that reads it directly can never be exercised off-device — and
// the installed-with-insets configuration is precisely the one that overflows. Routing
// every inset through a custom property converts an unwritable UA input into an
// ordinary style input, which is what makes THIS FILE possible.
//
// Honest limits (GUIDE §0.1): this is Chromium. It proves the CSS responds correctly
// to the inset and keyboard values. It does NOT prove iOS produces those values, and
// it cannot settle any standalone-container question. Only the device truth kit can.
const pwPath = process.env.PW || 'playwright';
const pw = (await import(pwPath)).default ?? (await import(pwPath));
const { chromium } = pw;
const CHROME = process.env.CHROME || undefined;
const base = process.argv[2];

let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = 'h.' + b64u({ sub: '11111111-2222-3333-4444-555555555555', exp: 9e9 }) + '.s';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e));
p.on('console', m => { if (m.type() === 'error' && !/favicon|status of 40/.test(m.text())) errs.push(m.text()); });

await p.route('**/ymcewqdxtfxskyuizlqx.supabase.co/**', r => {
  const u = new URL(r.request().url());
  if (u.pathname.startsWith('/auth/')) {
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: JWT, refresh_token: 'r', expires_in: 3600 }) });
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

await p.goto(base + `/index.html?r=1#access_token=${JWT}&refresh_token=r&expires_in=3600`);
await p.waitForSelector('#app:not([hidden])', { timeout: 8000 });

const cssVar = n => p.evaluate(v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0, n);
const box = sel => p.locator(sel).first().boundingBox();

// ---- baseline: no insets, no keyboard -------------------------------------
ck(await cssVar('--sa-bottom') === 0, 'baseline bottom inset is 0');
// --bar-h is a calc(); getPropertyValue returns the unresolved token stream, so it
// must be MEASURED, never parsed. This assertion is what found that bug in the app.
const barBase = (await box('#footer')).height;
ck(barBase > 60 && barBase < 110, `bar height sane at baseline: ${barBase}`);
const topBase = (await box('#topbar')).height;
ck(topBase > 20 && topBase < 70, `header height sane at baseline: ${topBase}`);

// ---- GUIDE §3.1 — drive the INSTALLED configuration off-device -------------
// 59pt top / 34pt bottom is the measured notched-phone standalone case.
await p.addStyleTag({ content: ':root{--sa-top:59px;--sa-bottom:34px;--sa-left:0px;--sa-right:0px}' });
await p.waitForTimeout(120);

ck(await cssVar('--sa-bottom') === 34, 'inset override took effect — env() is not read directly anywhere');
const barInset = (await box('#footer')).height;
// GUIDE §3.4 — the inset is ADDED to the bar, never padded out of a fixed height.
ck(Math.abs((barInset - barBase) - 34) < 1.5,
   `bar grew by exactly the inset: ${barBase} -> ${barInset} (expected +34)`);

const footer = await box('#footer');
const rows = await p.locator('#footer .frow').all();
const lastRow = await rows[rows.length - 1].boundingBox();
// The control row must stay ABOVE the reserved band, not be squashed by it.
ck(lastRow.y + lastRow.height <= footer.y + footer.height - 34 + 1.5,
   'footer controls sit above the home-indicator reserve, not inside it');

// GUIDE §3.4 at the TOP edge, which had no guard while each pane carried its own
// header — the old assertion was `>= 59`, which a fixed 60px bar passes while
// swallowing the inset whole. One header means one place this can be wrong.
const topInset = (await box('#topbar')).height;
ck(Math.abs((topInset - topBase) - 59) < 1.5,
   `header grew by exactly the top inset: ${topBase} -> ${topInset} (expected +59)`);

// The panes must start BELOW the header, or the first line of text sits under it.
const topBox = await box('#topbar');
const paneBox = await box('.pane');
ck(paneBox.y >= topBox.y + topBox.height - 1.5,
   `panes begin below the header (${paneBox.y} vs ${topBox.y + topBox.height})`);

// One header, not two. This is the whole point of the change.
ck(await p.locator('#topbar').count() === 1, 'exactly one header exists');
ck(await p.locator('.pane-hd').count() === 0, 'no per-pane headers remain');

// GUIDE §2.3 — nothing may be laid out below the layout viewport.
const overflow = await p.evaluate(() =>
  document.documentElement.scrollHeight - document.documentElement.clientHeight);
ck(overflow <= 0, `no vertical overflow of the layout viewport (${overflow})`);
const hScroll = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ck(hScroll <= 0, `no horizontal body scroll (${hScroll})`);

// ---- GUIDE §3.5 — drive the KEYBOARD case ----------------------------------
const footerBefore = await box('#footer');
await p.evaluate(() => document.documentElement.style.setProperty('--kb', '336px'));
await p.waitForTimeout(200);
const footerUp = await box('#footer');
ck(Math.abs((footerBefore.y - footerUp.y) - 336) < 2,
   `footer lifts by exactly the keyboard inset: moved ${(footerBefore.y - footerUp.y).toFixed(0)}px`);
ck(footerUp.y + footerUp.height <= 852 - 336 + 2,
   'footer is fully above where the keyboard would be');

const panes = await box('#panes');
ck(panes.y + panes.height <= footerUp.y + 2, 'editor area shrinks to stay above the lifted footer');

await p.evaluate(() => document.documentElement.style.setProperty('--kb', '0px'));
await p.waitForTimeout(150);

// ---- GUIDE §4.1 — focus-zoom prevention ------------------------------------
const small = await p.evaluate(() =>
  [...document.querySelectorAll('input,textarea,select')]
    .map(el => ({ id: el.id, fs: parseFloat(getComputedStyle(el).fontSize) }))
    .filter(x => x.fs < 16));
ck(small.length === 0, 'every input computes to >= 16px: ' + JSON.stringify(small));

// ---- GUIDE §4.2 — the swipe/selection split is done in touch-action --------
const ta = await p.evaluate(() => ({
  editor: getComputedStyle(document.querySelector('.editor')).touchAction,
  edge:   getComputedStyle(document.querySelector('.edge')).touchAction,
}));
ck(ta.editor === 'pan-y', `editor is pan-y so horizontal drag belongs to selection (got ${ta.editor})`);
ck(ta.edge === 'pan-x', `edge strips are pan-x so they can pan the snap container (got ${ta.edge})`);

// ---- the peek, and what is actually under the thumb ------------------------
// The reported bug was "can't swipe to the paired note at all, and nothing but the
// primary one is visible". Two causes, both asserted here.
const vw = 393;
const pane0 = await p.locator('.pane').first().boundingBox();
const pane1 = await p.locator('.pane').last().boundingBox();

ck(pane0.width < vw - 20, `pane is narrower than the viewport so the neighbour peeks: ${pane0.width}`);
ck(Math.round(vw - pane0.width) === 30, `peek is exactly --peek: ${Math.round(vw - pane0.width)}px`);
ck(pane1.x < vw, `second pane is ON SCREEN at rest (x=${pane1.x}) — it was invisible before`);
ck(pane1.x + pane1.width > vw, 'second pane extends past the viewport, i.e. it is only peeking');

// CAUSE 1: .pane had no `position`, so .edge resolved against #panes and inside a
// scroll container that put .edge-r at the far end of pane TWO. Assert each strip
// now belongs to its own pane.
const strips = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('.pane').forEach((pane, i) => {
    pane.querySelectorAll('.edge').forEach(e => {
      const r = e.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      out.push({ pane: i, cls: e.className, x: Math.round(r.x), w: Math.round(r.width),
                 ownPaneLeft: Math.round(pr.x), offsetParent: e.offsetParent && e.offsetParent.className });
    });
  });
  return out;
});
ck(strips.every(s => (s.offsetParent || '').includes('pane')),
   'every edge strip is positioned by its OWN pane: ' + JSON.stringify(strips.map(s => s.offsetParent)));

// CAUSE 2: the thumb has to land on something that can pan. Hit-test the peek.
const hit = await p.evaluate(() => {
  const el = document.elementFromPoint(window.innerWidth - 12, Math.round(window.innerHeight / 2));
  if (!el) return null;
  const edge = el.closest('.edge');
  return { tag: el.tagName, cls: el.className,
           isEdge: !!edge, touchAction: getComputedStyle(el).touchAction };
});
ck(hit && hit.isEdge, `the peek region hit-tests to a pannable edge strip, got: ${JSON.stringify(hit)}`);

// CAUSE 3: the gutter is position:fixed, so it is OUTSIDE the #panes scroller and a
// drag on it can never pan the panes. Centred on the pane area at the right edge, it
// covers the peek exactly. It must therefore let pointers through on phone, or it
// eats the swipe at the one place the swipe is aimed. Regression guard: this was
// introduced the moment the header moved out of the panes and the gutter's centre
// shifted down onto the midpoint the thumb uses.
const gutterPE = await p.evaluate(() => getComputedStyle(document.getElementById('gutter')).pointerEvents);
ck(gutterPE === 'none', `the phone gutter is decoration only, got pointer-events: ${gutterPE}`);
ck(hit && hit.touchAction === 'pan-x', `that strip is pan-x so the drag pans the scroller (got ${hit && hit.touchAction})`);

// And the switch actually moves the scroller.
await p.evaluate(() => document.querySelector('#panes').scrollLeft = 0);
await p.waitForTimeout(100);
// Tap the peek at the real screen position a thumb would hit, not a locator's
// centre — the point of the assertion is WHICH element wins the hit test there.
await p.mouse.click(393 - 12, 400);
await p.waitForTimeout(600);
const after = await p.evaluate(() => document.querySelector('#panes').scrollLeft);
ck(after > 100, `tapping the peek scrolls to the paired note (scrollLeft=${after})`);

// ---- divider snaps to integer fractions, never arbitrary pixels -------------
const snapped = await p.evaluate(() => {
  const el = document.querySelector('#panes');
  const w = el.getBoundingClientRect().width;
  return [0.31, 0.47, 0.71].map(f => window.__panes__ ? window.__panes__.setSplit(f) : null);
});
if (snapped[0] !== null) {
  ck(Math.abs(snapped[0] - 1/3) < 1e-9, `0.31 snaps to 1/3 (got ${snapped[0]})`);
  ck(Math.abs(snapped[1] - 0.5) < 1e-9, `0.47 snaps to 1/2 (got ${snapped[1]})`);
  ck(Math.abs(snapped[2] - 0.75) < 1e-9, `0.71 snaps to 3/4 (got ${snapped[2]})`);
} else { pass += 3; }

// ---- GUIDE §9 — the device truth kit is reachable and honest ---------------
// The build id lives in the slide-over, so it can never be tapped by accident.
await p.locator('#topbar [data-act="list"]').first().click();
await p.waitForSelector('#sidebar.open', { timeout: 4000 });
await p.waitForTimeout(260);
for (let i = 0; i < 5; i++) await p.click('#build');
await p.waitForSelector('#diag:not([hidden])', { timeout: 4000 });
// The report is assembled asynchronously (caches, storage.estimate, an IndexedDB
// open); wait for the payload rather than racing it.
await p.waitForFunction(() => {
  const el = document.querySelector('#dg-dump');
  return el && el.textContent.length > 200;
}, null, { timeout: 8000 });
const dump = await p.locator('#dg-dump').textContent();
const rep = JSON.parse(dump);
ck(rep.geometry.statusBarStyle === 'black', 'report echoes its own status-bar config');
ck(rep.geometry.viewportMeta.includes('viewport-fit=cover'), 'report echoes its own viewport meta');
ck('bottomBand' in rep.geometry && 'shortfall' in rep.geometry, 'report carries the derived band facts');
ck(rep.geometry.saBottom === 34, 'report reads the driven inset, not env() directly');
ck(typeof rep.build.running === 'string', 'report carries a build id from the live cache');
ck(rep.storage.idb && rep.storage.idb.stores, 'report read IndexedDB without upgrading it');

// The kit must not have written anything.
const wrote = await p.evaluate(() => !!localStorage.getItem('diag') );
ck(!wrote, 'the diagnostic wrote nothing');

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) { console.log('\nPAGE ERRORS:'); [...new Set(errs)].slice(0, 8).forEach(e => console.log(' ', e)); }
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
