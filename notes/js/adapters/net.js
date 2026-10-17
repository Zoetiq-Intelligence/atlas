// net.js — the only place fetch() is called.
//
// The second adapter seam from PROTOCOL.md. Auth injects a token provider at
// startup rather than net.js importing auth.js, which would be circular.

import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from '../../config.js';

let tokenProvider = null;   // async () => accessToken | null
let onAuthFailure = null;   // called when a refresh cannot recover a 401

export function configure({ getToken, onUnauthorized }) {
  tokenProvider = getToken;
  onAuthFailure = onUnauthorized;
}

export class NetError extends Error {
  constructor(status, body, url) {
    super(`${status} ${url} — ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'NetError';
    this.status = status;
    this.body = body;
  }
}

/**
 * One request path for the whole app.
 *
 * @param {string} path   absolute URL, or a path appended to SUPABASE_URL
 * @param {object} opts
 *   method, body (auto-JSON), headers, auth (default true), prefer, retryOn401,
 *   schema — the Postgres schema to address (default DB_SCHEMA, i.e. `notes`); null
 *   addresses `public`, where Horizon's shared tables (feedback, horizon_triage) live
 */
export async function request(path, opts = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    prefer,
    retryOn401 = true,
    signal,
    schema = DB_SCHEMA,
  } = opts;

  const url = path.startsWith('http') ? path : SUPABASE_URL + path;

  const h = {
    apikey: SUPABASE_ANON_KEY,
    ...headers,
  };

  // This project shares a Supabase project with XENO's other systems, so the tables
  // live in a dedicated `notes` Postgres schema rather than in `public`. PostgREST
  // selects a non-default schema by header: Accept-Profile on reads, Content-Profile
  // on writes. Both must be sent or a write silently targets `public` and 404s.
  if (schema && path.startsWith('/rest/')) {
    if (method === 'GET' || method === 'HEAD') h['Accept-Profile'] = schema;
    else h['Content-Profile'] = schema;
  }
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (prefer) h['Prefer'] = prefer;

  if (auth && tokenProvider) {
    const token = await tokenProvider();
    if (token) h['Authorization'] = `Bearer ${token}`;
  }

  // A black-holed connection (a laptop waking, a network switch) would otherwise hang
  // forever and wedge the outbox behind it. Generous, because one note can be 0.5 MB
  // going up a phone connection. A timeout is not a NetError, so callers retry it.
  const res = await fetch(url, {
    method,
    headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    signal: signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined),
  });

  // One recovery attempt. tokenProvider single-flights the refresh itself, so
  // five concurrent 401s produce one refresh, not five.
  // A refresh that failed for a TRANSIENT reason (offline, 5xx) throws, and that error
  // propagates as transient: the session is kept and the caller retries. Only a refresh
  // the server refused (null) means signed out.
  if (res.status === 401 && auth && retryOn401 && tokenProvider) {
    const fresh = await tokenProvider({ force: true });
    if (fresh) return request(path, { ...opts, retryOn401: false });
    if (onAuthFailure) onAuthFailure();
  }

  const text = await res.text();
  let parsed = text;
  if (text && (res.headers.get('content-type') || '').includes('json')) {
    try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  }

  if (!res.ok) throw new NetError(res.status, parsed, url);
  return parsed;
}

/** True when the failure is worth retrying later rather than surfacing now. */
export function isTransient(err) {
  if (!(err instanceof NetError)) return true;      // network/DNS/offline
  return err.status >= 500 || err.status === 429 || err.status === 408;
}
