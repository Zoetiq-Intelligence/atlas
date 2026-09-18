// realtime.js — the Phoenix channels protocol, hand-written. No supabase-js.
//
// This is a NOTIFICATION CHANNEL, never a data channel. A message says "note X moved
// at time T"; the device then fetches the row over the same PostgREST path it already
// uses on every poll. That is deliberate:
//
//   Delivery is AT-MOST-ONCE. Messages are lost to network drops and to tenant rate
//   limits. A stream that carried the data would make a lost message a lost edit. A
//   stream that carries a pointer makes a lost message cost five seconds, because the
//   poll underneath it still runs. The poll is the floor and stays after this lands.
//
// Everything here is from projects/notes-app/REALTIME-FINDINGS.md, which was written
// from the protocol spec and the realtime-js/auth-js sources rather than from memory.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

const VSN = '1.0.0';            // object envelopes; the server default, and what realtime-js ships
const HEARTBEAT_MS = 25_000;    // spec: "at least every 25 seconds"
const AUTH_TICK_MS = 30_000;    // auth-js AUTO_REFRESH_TICK_DURATION_MS
const BACKOFF = [1000, 2000, 5000, 10000];   // realtime-js RECONNECT_INTERVALS

let ws = null;
let ref = 0;
let joinRef = null;
let tries = 0;
let timers = { hb: null, auth: null, retry: null };
let pendingHeartbeatRef = null;
let lastToken = null;
let stopped = true;
let joined = false;

let cfg = { getToken: async () => null, userId: () => null, onChange: () => {}, onState: () => {} };

const nextRef = () => String(++ref);
const topicFor = uid => `notes:${uid}`;

function send(obj) {
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
}

function setState(s, detail) { try { cfg.onState(s, detail); } catch { /* never break the socket */ } }

// ---------------------------------------------------------------- lifecycle

function clearTimers() {
  clearInterval(timers.hb); clearInterval(timers.auth); clearTimeout(timers.retry);
  timers = { hb: null, auth: null, retry: null };
}

/**
 * Force-close and schedule a retry. Called for every abnormal condition, including
 * the one the browser will never tell us about — see the heartbeat.
 */
function dropAndRetry(why) {
  joined = false;
  pendingHeartbeatRef = null;
  clearTimers();
  if (ws) {
    try { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); } catch { /* already gone */ }
    ws = null;
  }
  setState('off', why);
  if (stopped) return;
  // Jitter, because the SDK does not add any and two devices waking together would
  // otherwise retry in lockstep forever.
  const base = BACKOFF[Math.min(tries, BACKOFF.length - 1)];
  const wait = base + Math.random() * base * 0.3;
  tries++;
  timers.retry = setTimeout(connect, wait);
}

/** Codes the server tells us not to retry. Retrying these is how you get rate-limited. */
const FATAL = /MalformedJWT|JwtSignatureError|Unauthorized|TenantNotFound|RealtimeDisabled|TopicNameRequired/;

async function connect() {
  if (stopped || (ws && ws.readyState <= 1)) return;

  const uid = cfg.userId();
  const token = await cfg.getToken().catch(() => null);
  // A private channel needs a real user JWT. The publishable key is fine as the apikey
  // query param but is SILENTLY IGNORED as an access_token — it is not a JWT — so
  // without this we would join as anon and hear nothing, with no error anywhere.
  if (!uid || !token) { setState('off', 'no session'); return; }
  lastToken = token;

  const url = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket`
    + `?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=${VSN}`;

  try { ws = new WebSocket(url); } catch { return dropAndRetry('construct failed'); }

  ws.onopen = () => {
    joinRef = nextRef();
    send({
      topic: `realtime:${topicFor(uid)}`,
      event: 'phx_join',
      // private:true is NOT optional. Database broadcasts default to private, and
      // "a public broadcast only reaches public channels" — a mismatch is TOTAL
      // SILENCE with no error on either side.
      payload: { config: { broadcast: { self: false }, private: true }, access_token: token },
      ref: joinRef,
      join_ref: joinRef,
    });

    // THE SINGLE MOST IMPORTANT PIECE IN A PWA. On mobile a dead socket stays
    // readyState === 1 indefinitely — the phone sleeps, the connection is gone, and
    // onclose never fires. So liveness is OUR measurement, not the browser's: hold the
    // outstanding heartbeat ref, and if the next tick comes round with the previous one
    // still unacked, close it ourselves rather than waiting for an event that is not
    // coming.
    timers.hb = setInterval(() => {
      if (pendingHeartbeatRef !== null) return dropAndRetry('heartbeat timeout');
      pendingHeartbeatRef = nextRef();
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: pendingHeartbeatRef });
    }, HEARTBEAT_MS);

    // "If a new JWT is never received on the Channel, the client will be disconnected
    // when the JWT expires." Push only when it actually changed, as realtime-js does.
    timers.auth = setInterval(async () => {
      const fresh = await cfg.getToken().catch(() => null);
      if (!fresh || fresh === lastToken || !joined) return;
      lastToken = fresh;
      send({ topic: `realtime:${topicFor(uid)}`, event: 'access_token',
             payload: { access_token: fresh }, ref: nextRef(), join_ref: joinRef });
    }, AUTH_TICK_MS);
  };

  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.topic === 'phoenix' && msg.event === 'phx_reply') { pendingHeartbeatRef = null; return; }

    if (msg.event === 'phx_reply' && msg.ref === joinRef) {
      if (msg.payload && msg.payload.status === 'ok') {
        joined = true; tries = 0; setState('live');
      } else {
        const reason = (msg.payload && msg.payload.response && msg.payload.response.reason) || 'join failed';
        if (FATAL.test(reason)) { stop(); setState('off', reason); return; }
        dropAndRetry(reason);
      }
      return;
    }

    if (msg.event === 'phx_error' || msg.event === 'phx_close') return dropAndRetry(msg.event);

    if (msg.event === 'system') {
      const m = (msg.payload && (msg.payload.message || msg.payload.status)) || '';
      // A channel-level system error is always followed by phx_close; an expired token
      // needs a refresh before the rejoin, or we just fail again at the same place.
      if (/expired/i.test(m)) { lastToken = null; return dropAndRetry('token expired'); }
      return;
    }

    if (msg.event === 'broadcast') {
      // ⚠ The envelope of a database broadcast is NOT printed by any Supabase page we
      // could find (REALTIME-FINDINGS "could not verify"). The observed shape nests our
      // jsonb under payload.payload; older/other shapes put it at payload. Read both
      // rather than build logic on an unverified one — the cost is one `||`.
      const p = (msg.payload && msg.payload.payload) || msg.payload || {};
      if (!p.id) return;
      try { cfg.onChange(p); } catch { /* a listener must not kill the socket */ }
    }
  };

  ws.onerror = () => { /* onclose follows; dropAndRetry there, so we do not double-fire */ };
  ws.onclose = () => dropAndRetry('closed');
}

// ---------------------------------------------------------------- public

/**
 * @param {{getToken:function, userId:function, onChange:function, onState:function}} opts
 */
export function start(opts) {
  cfg = { ...cfg, ...opts };
  stopped = false;
  tries = 0;
  connect();

  // A backgrounded phone's socket is usually dead on return, and the browser will not
  // say so. Treat every foreground as suspect: if it is not OPEN, rebuild it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    if (!ws || ws.readyState > 1) { tries = 0; connect(); }
  });
  window.addEventListener('online', () => { if (!stopped) { tries = 0; connect(); } });
}

export function stop() {
  stopped = true;
  clearTimers();
  if (ws) { try { ws.onclose = null; ws.close(); } catch { /* already gone */ } ws = null; }
  joined = false;
}

/** Test and diagnostics surface. */
export const status = () => ({
  joined,
  readyState: ws ? ws.readyState : -1,
  pendingHeartbeat: pendingHeartbeatRef !== null,
});
