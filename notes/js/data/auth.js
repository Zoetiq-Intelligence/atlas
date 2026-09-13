// auth.js — magic link over GoTrue's REST API. No supabase-js.
//
// Flow is IMPLICIT by construction, not by configuration: GoTrue chooses PKCE
// only when the client sends a code_challenge. We never send one, so /verify
// redirects with tokens in the URL fragment. See SETUP.md.

import { request } from '../adapters/net.js';
import { kv } from '../adapters/store.js';

const KEY = 'session';
const SKEW_MS = 60_000;          // refresh this long before actual expiry

let session = null;
let refreshing = null;           // single-flight: five concurrent 401s -> one refresh

function decodeSub(jwt) {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p.padEnd(p.length + (4 - p.length % 4) % 4, '='))).sub || null;
  } catch { return null; }
}

function shape(raw) {
  if (!raw || !raw.access_token) return null;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: raw.expires_at ? raw.expires_at * 1000 : Date.now() + (raw.expires_in || 3600) * 1000,
    email: raw.user?.email || raw.email || null,
    user_id: raw.user?.id || decodeSub(raw.access_token),
  };
}

async function persist(s) { session = s; await (s ? kv.set(KEY, s) : kv.del(KEY)); }

export async function restore() {
  session = (await kv.get(KEY)) || null;
  return session;
}

/** Tokens arrive in the fragment. Read them, store them, scrub the URL. */
export async function consumeRedirect() {
  const h = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!h) return false;
  const p = new URLSearchParams(h);
  if (p.get('error_description')) {
    history.replaceState(null, '', location.pathname + location.search);
    throw new Error(p.get('error_description'));
  }
  const at = p.get('access_token');
  if (!at) return false;
  await persist(shape({
    access_token: at,
    refresh_token: p.get('refresh_token'),
    expires_in: Number(p.get('expires_in')) || 3600,
  }));
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

/**
 * Send the sign-in email. One call produces BOTH a link and a code, provided
 * the Magic Link template contains {{ .Token }} as well as {{ .ConfirmationURL }}.
 *
 * Both are needed because iOS gives a home-screen web app storage completely
 * separate from Safari — session, cookies, localStorage and the service worker
 * are all isolated. A magic link always opens in Safari, so tapping it signs in
 * the browser and leaves the installed app logged out, forever. The code is the
 * only path that works inside the installed app.
 *
 * Link is for desktop. Code is for the iPhone. See DEPLOY.md.
 */
export async function sendLoginEmail(email) {
  const redirect = location.origin + location.pathname;
  await request(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST',
    auth: false,
    body: { email, create_user: true },
  });
}

/** Exchange a 6-digit code for a session. The installed-app sign-in path. */
export async function verifyCode(email, token) {
  const raw = await request('/auth/v1/verify', {
    method: 'POST',
    auth: false,
    body: { email, token: String(token).trim(), type: 'email' },
  });
  const s = shape(raw);
  if (!s) throw new Error('That code did not return a session.');
  await persist(s);
  return s;
}

async function doRefresh() {
  if (!session?.refresh_token) return null;
  try {
    const raw = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      auth: false,
      body: { refresh_token: session.refresh_token },
    });
    await persist(shape(raw));
    return session?.access_token || null;
  } catch (e) {
    if (e.status === 400 || e.status === 401) await persist(null);   // truly dead
    return null;
  }
}

/** The token provider handed to net.js. */
export async function getToken(opts = {}) {
  if (!session) return null;
  const stale = Date.now() > session.expires_at - SKEW_MS;
  if (!opts.force && !stale) return session.access_token;
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

export function current() { return session; }
export function signedIn() { return !!session; }
export async function signOut() { await persist(null); }
