// backup.js — periodic snapshots of the server-side state, and revert.
//
// The snapshot is built inside Postgres (see _protocol/SETUP-BACKUP.sql), not here.
// This module never uploads note content. Backing up the local IndexedDB copy would
// back up whatever THIS device happened to hold, which may be stale or mid-sync; the
// thing worth protecting is the canonical state, so the database snapshots itself and
// the client's only job is to decide when to ask.
//
// Deliberately NOT wired into isBusy(). A reload during the RPC either lands after
// the server committed (snapshot exists) or before it (next foreground retries), so
// there is nothing a reload can destroy. See the §5.1b comment in main.js for why
// adding things to that predicate is not free.

import { request, NetError } from '../adapters/net.js';
import { kv } from '../adapters/store.js';

const REST = '/rest/v1';

export const INTERVAL_MS = 6 * 60 * 60 * 1000;      // the operator's "6 hours"
const INTERVAL_S = INTERVAL_MS / 1000;
const CHECK_MS = 15 * 60 * 1000;                    // how often a live instance looks

const LATEST = 'backupLatestAt';                    // kv: last known server snapshot

/** The SQL has not been run on this project yet. Distinct from "the network is down". */
export class NotInstalled extends Error {
  constructor() { super('The backup tables are not installed on this Supabase project yet.'); this.name = 'NotInstalled'; }
}

// PostgREST answers 404 for both a missing table (PGRST205) and a missing function
// (PGRST202). Either one means the SQL has not been run, which is a different problem
// from an outage and must not be reported as one.
function classify(e) {
  if (e instanceof NetError && e.status === 404) return new NotInstalled();
  return e;
}

export async function latestAt() {
  return (await kv.get(LATEST)) || null;
}

/**
 * Ask the server for a snapshot. The server enforces the interval too, so two devices
 * cannot both take one — whichever loses simply gets `created: false`.
 * @param {{minIntervalSeconds?: number, reason?: string}} opts
 */
export async function take({ minIntervalSeconds = INTERVAL_S, reason = 'auto' } = {}) {
  let out;
  try {
    out = await request(`${REST}/rpc/take_snapshot`, {
      method: 'POST',
      body: { p_min_interval_seconds: minIntervalSeconds, p_reason: reason },
    });
  } catch (e) { throw classify(e); }
  if (out && out.latest_at) await kv.set(LATEST, out.latest_at);
  return out;
}

/** Newest first. Metadata only — the note bodies are not fetched until you ask. */
export async function list(limit = 40) {
  try {
    return await request(
      `${REST}/snapshot?select=id,taken_at,reason,note_count,folder_count&order=taken_at.desc&limit=${limit}`);
  } catch (e) { throw classify(e); }
}

/** One snapshot including its contents — for exporting a copy off the database. */
export async function fetchOne(id) {
  try {
    const rows = await request(`${REST}/snapshot?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows && rows[0];
  } catch (e) { throw classify(e); }
}

/**
 * Replace the current state with a snapshot. Destructive by intent, reversible by
 * construction: the server takes a `pre-restore` snapshot first and soft-deletes
 * rather than dropping anything.
 */
export async function restore(id) {
  let out;
  try {
    out = await request(`${REST}/rpc/restore_snapshot`, { method: 'POST', body: { p_id: id } });
  } catch (e) { throw classify(e); }
  // The safety snapshot it just took is now the newest one.
  if (out && out.safety_snapshot && out.safety_snapshot.latest_at) {
    await kv.set(LATEST, out.safety_snapshot.latest_at);
  }
  return out;
}

/** True when six hours have passed since the last snapshot THIS device knows of. */
export async function due() {
  const last = await latestAt();
  if (!last) return true;
  const t = Date.parse(last);
  if (!isFinite(t)) return true;
  return Date.now() - t >= INTERVAL_MS;
}

/**
 * The automatic path. Cheap when not due — it does not call the server at all, so an
 * app that is open all day makes four requests, not one every fifteen minutes.
 */
export async function maybeAuto() {
  if (!(await due())) return { created: false, why: 'not_due_local', latest_at: await latestAt() };
  return take({ reason: 'auto' });
}

let listeners = [];
export function onState(fn) { listeners.push(fn); }
function emit(s) { listeners.forEach(f => { try { f(s); } catch (e) { /* a listener must not break the loop */ } }); }

let timer = null;

/**
 * "Whenever one of our instances is on and 6 hours has passed" — so the trigger is
 * the app being alive and visible, not a server-side cron. Checks at boot, whenever
 * the app is brought to the foreground (which on iOS is the only moment an installed
 * app reliably runs anything), and on a slow interval while it stays open.
 */
export function start() {
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const r = await maybeAuto();
      emit({ ok: true, ...r });
    } catch (e) {
      emit({ ok: false, notInstalled: e instanceof NotInstalled, error: e });
    }
  };
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('online', tick);
  clearInterval(timer);
  timer = setInterval(tick, CHECK_MS);
  tick();
  return tick;
}

/** Test surface and a manual escape hatch; not used by the UI. */
export function stop() { clearInterval(timer); timer = null; }
