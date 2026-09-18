// realtime.test.mjs — the Phoenix protocol, driven against a fake socket.
//
// This suite exists because every failure mode of live sync is SILENT. A public/private
// mismatch delivers nothing and errors nowhere. An sb_* key sent as an access_token is
// ignored without complaint. A dead socket on a phone keeps reporting readyState 1
// forever. None of those produce an exception to catch or a log line to read, so the
// only way to know the client is correct is to assert the exact bytes it puts on the
// wire and the exact thing it does when the replies stop coming.
//
//   PW=/path/to/playwright/index.js CHROME=/path/to/chrome \
//     node notes/test/realtime.test.mjs http://127.0.0.1:8111/notes
const pwPath = process.env.PW || 'playwright';
const pw = (await import(pwPath)).default ?? (await import(pwPath));
const { chromium } = pw;
const CHROME = process.env.CHROME || undefined;
const base = process.argv[2];
let pass = 0, fail = 0;
const ck = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const UID = '11111111-2222-3333-4444-555555555555';
const JWT = 'h.' + b64u({ sub: UID, role: 'authenticated', exp: 9e9 }) + '.s';

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e));
p.on('console', m => {
  if (m.type() !== 'error') return;
  if (/favicon|status of 40[34]/.test(m.text())) return;
  errs.push('console: ' + m.text());
});

// A fake WebSocket, installed before any app code runs. It records every frame the
// client sends and lets the test push frames back, so the protocol can be driven
// deterministically — no Supabase, no network, no timing luck.
await p.addInitScript(() => {
  const sent = [];
  const instances = [];
  window.__WS__ = { sent, instances, get last() { return instances[instances.length - 1]; } };
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closed = false;
      instances.push(this);
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 5);
    }
    send(data) { try { sent.push(JSON.parse(data)); } catch { sent.push(data); } }
    close() { this.readyState = 3; this.closed = true; }
    recv(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
  }
  window.WebSocket = FakeWS;
});

let restCalls = [];
await p.route('**/ymcewqdxtfxskyuizlqx.supabase.co/**', route => {
  const u = new URL(route.request().url());
  restCalls.push(route.request().method() + ' ' + u.pathname);
  if (u.pathname.startsWith('/auth/v1/token'))
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: JWT, refresh_token: 'r', expires_in: 3600 }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

// The clock must be installed BEFORE the page loads: it can only control timers that
// are created after it is in place, and the heartbeat interval is created during boot.
// Page time then only moves when the test says so, which is why every wait below is a
// tick() rather than a sleep.
await p.clock.install();

/** Advance PAGE timers by ms, then let promises and routed requests settle for real. */
const tick = async ms => { await p.clock.runFor(ms); await p.waitForTimeout(90); };

await p.goto(base + `/index.html#access_token=${JWT}&refresh_token=r&expires_in=3600&token_type=bearer`);
await p.waitForSelector('#app:not([hidden])', { timeout: 8000 });
await tick(50);            // the fake socket opens on a timer
await p.waitForFunction(() => window.__WS__ && window.__WS__.instances.length > 0, null, { timeout: 5000 });
await tick(50);

// ---- the connection ------------------------------------------------------
const url = await p.evaluate(() => window.__WS__.last.url);
ck(/\/realtime\/v1\/websocket\?/.test(url), 'connects to the realtime websocket endpoint: ' + url);
ck(/[?&]vsn=1\.0\.0(&|$)/.test(url), 'pins vsn=1.0.0 — object envelopes, the server default');
ck(/[?&]apikey=/.test(url), 'sends the apikey as a query param');

// ---- the join ------------------------------------------------------------
const join = await p.evaluate(() => window.__WS__.sent.find(f => f.event === 'phx_join'));
ck(!!join, 'sends phx_join');
ck(join && join.topic === `realtime:notes:${'11111111-2222-3333-4444-555555555555'}`,
   'joins the per-user topic, got: ' + (join && join.topic));

// THE SILENT ONE. Database broadcasts default to private, and a public broadcast only
// reaches public channels. Get this wrong and nothing is delivered, with no error on
// either side — the hardest possible failure to diagnose from a phone.
ck(join && join.payload && join.payload.config && join.payload.config.private === true,
   'joins with config.private:true — a mismatch is total silence, not an error');

// THE OTHER SILENT ONE. sb_* keys are ignored as an access_token because they are not
// JWTs; the join would quietly fall back to anon and auth.uid() would never match.
ck(join && typeof join.payload.access_token === 'string'
        && join.payload.access_token.split('.').length === 3,
   'sends a real JWT as access_token, not the sb_ publishable key');
ck(join && !String(join.payload.access_token).startsWith('sb_'),
   'never sends an sb_ key as access_token — it is silently ignored');

// ---- joining makes it live, and reconciles ------------------------------
restCalls = [];
await p.evaluate(() => {
  const ws = window.__WS__.last;
  const join = window.__WS__.sent.find(f => f.event === 'phx_join');
  ws.recv({ topic: join.topic, event: 'phx_reply', ref: join.ref, payload: { status: 'ok', response: {} } });
});
await tick(400);
ck(restCalls.some(c => c.startsWith('GET /rest/v1/note')),
   'a successful join reconciles immediately — the stream is at-most-once, so a rejoin must refetch');

// ---- a broadcast fetches the row, it does not trust the message ---------
restCalls = [];
await p.evaluate(() => {
  const ws = window.__WS__.last;
  const join = window.__WS__.sent.find(f => f.event === 'phx_join');
  ws.recv({ topic: join.topic, event: 'broadcast', payload: {
    type: 'broadcast', event: 'change',
    payload: { op: 'UPDATE', kind: 'note', id: 'abc-123', updated_at: '2026-09-18T20:00:00Z' } } });
});
await tick(400);
ck(restCalls.some(c => c.startsWith('GET /rest/v1/note')),
   'a broadcast triggers a pull — the payload is a pointer, never the data');

// The envelope of a database broadcast is not printed by any Supabase doc, so the
// client reads both the nested and the flat shape. Assert the flat one works too.
restCalls = [];
await p.evaluate(() => {
  const ws = window.__WS__.last;
  const join = window.__WS__.sent.find(f => f.event === 'phx_join');
  ws.recv({ topic: join.topic, event: 'broadcast',
            payload: { op: 'UPDATE', kind: 'note', id: 'def-456', updated_at: '2026-09-18T20:00:01Z' } });
});
await tick(400);
ck(restCalls.some(c => c.startsWith('GET /rest/v1/note')),
   'the flat broadcast envelope is handled too — the nested shape is unverified');

// ---- a burst is one pull, not a burst of pulls --------------------------
restCalls = [];
await p.evaluate(() => {
  const ws = window.__WS__.last;
  const join = window.__WS__.sent.find(f => f.event === 'phx_join');
  for (let i = 0; i < 8; i++) {
    ws.recv({ topic: join.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'change',
      payload: { op: 'UPDATE', kind: 'note', id: 'burst-' + i, updated_at: '2026-09-18T20:00:0' + i + 'Z' } } });
  }
});
await tick(500);
const pulls = restCalls.filter(c => c.startsWith('GET /rest/v1/note')).length;
ck(pulls === 1, `eight broadcasts coalesce into one pull, got ${pulls}`);

// ---- THE DEAD SOCKET -----------------------------------------------------
// The single most important piece in a PWA: on mobile a dead socket keeps reporting
// readyState 1 indefinitely and onclose never fires, so liveness has to be the
// client's own measurement. Heartbeat at 25s; if the previous ref is still unacked
// when the next tick comes round, close it ourselves.
//
// Driven with a controlled clock so the test does not take a minute.
const before = await p.evaluate(() => window.__WS__.instances.length);
await tick(26000);
const hb = await p.evaluate(() => window.__WS__.sent.filter(f => f.event === 'heartbeat'));
ck(hb.length >= 1, `heartbeat is sent, got ${hb.length}`);
ck(hb.length === 0 || hb[0].topic === 'phoenix',
   'the heartbeat goes to the reserved phoenix topic, got: ' + (hb[0] && hb[0].topic));
ck(hb.length === 0 || hb[0].join_ref === undefined,
   'the heartbeat carries no join_ref');

// Never ack it. The next tick must force the close rather than wait for an onclose
// event that is not coming.
await tick(26000);
const closedItself = await p.evaluate(() => window.__WS__.instances[0].closed === true
  || window.__WS__.instances[0].readyState === 3);
ck(closedItself, 'an unacked heartbeat makes the client close the socket ITSELF');
const after = await p.evaluate(() => window.__WS__.instances.length);
ck(after > before, `and reconnect afterwards (${before} -> ${after} sockets)`);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (errs.length) { console.log('\nPAGE ERRORS:'); [...new Set(errs)].slice(0, 10).forEach(e => console.log(' ', e)); }
await b.close();
process.exit(fail || errs.length ? 1 : 0);
