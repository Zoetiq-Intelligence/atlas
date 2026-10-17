// claude.js — send a request to the Atlas Master thread, read its replies back.
//
// Operator, 2026-10-17: "we need the ability to do the import and merge w/ Claude all
// on the phone … since only I'm using it we can have it send stuff to this thread".
//
// No new server. This is Horizon's existing loop (LocalGen research/protocols/
// ASK-PROTOCOL.md): a row in public.feedback, signed with the operator's own JWT and
// dev=true, is what the Dispatcher wakes the thread for. The thread answers with
// `triage.py reply`, Horizon mirrors the record into public.horizon_triage, and this
// module reads it back by the ask_id it chose. Both tables live in `public`, not in
// `notes`, hence `schema: null`.
//
// RLS on feedback is INSERT-only (no SELECT policy), so the insert must ask for
// return=minimal: return=representation would fail the whole insert.
//
// ⚠ Tests must never reach the real feedback table: a test row becomes a real record
// and wakes a real thread. app.test.mjs fakes every request to the Supabase host.

import { request } from '../adapters/net.js';
import { APP_VERSION } from '../../config.js';

const MAX = 8000;              // RLS: length(text) <= 8000
const KINDS = new Set(['request', 'question']);

/**
 * @param {{text: string, notes?: {id: string, title: string}[], kind?: string,
 *          build?: string, email?: string}} r
 * @returns {Promise<string>} the ask_id the reply will carry
 */
export async function send({ text, notes = [], kind = 'request', build = '', email = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Nothing to send');
  const ask_id = crypto.randomUUID();
  // Note ids travel in the text, not in context: Horizon keeps only ask_id / note_id /
  // console_note from context (each ≤120 chars), and the thread reads the full text.
  const trailer = notes.length
    ? '\n\n— notes —\n' + notes.map(n => `${n.id}  ${n.title || '(untitled)'}`).join('\n')
    : '';
  const full = (body + trailer).slice(0, MAX);
  await request('/rest/v1/feedback', {
    method: 'POST',
    schema: null,
    prefer: 'return=minimal',
    body: [{
      app: 'atlas', surface: 'atlas',
      kind: KINDS.has(kind) ? kind : 'request',
      text: full, dev: true,
      page: 'notes', component: 'claude-panel',
      client_version: APP_VERSION, build, reporter: email || null,
      context: { ask_id, ...(notes[0] ? { note_id: notes[0].id } : {}) },
    }],
  });
  return ask_id;
}

const COLS = 'id,t,updated,state,verbatim,reply,ref,fields';

/** The operator's requests from this app, newest first. */
export async function history(limit = 30) {
  const q = new URLSearchParams({ select: COLS, app: 'eq.atlas', order: 't.desc', limit: String(limit) });
  q.append('ref->>kind', 'in.(request,question)');
  q.append('ref->>ask_id', 'not.is.null');
  return request(`/rest/v1/horizon_triage?${q}`, { schema: null });
}

/** One request by the ask_id send() returned; null until Horizon has filed it. */
export async function byAsk(askId) {
  const q = new URLSearchParams({ select: COLS, app: 'eq.atlas', limit: '1' });
  q.append('ref->>ask_id', `eq.${askId}`);
  const rows = await request(`/rest/v1/horizon_triage?${q}`, { schema: null });
  return rows[0] || null;
}

/** Done when the thread closed it with a reply; anything else is still moving. */
export const settled = row => !!row && !!row.reply && ['done', 'partly', 'dropped', 'superseded'].includes(row.state);
