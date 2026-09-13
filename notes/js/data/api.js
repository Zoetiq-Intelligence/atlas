// api.js — PostgREST. user_id is never sent by the client; it defaults to
// auth.uid() server-side and RLS enforces it. A client that sets its own
// user_id is a client that can lie about it.

import { request } from '../adapters/net.js';

const REST = '/rest/v1';
// Table names are singular inside the `notes` schema: notes.note, notes.folder.
const NOTES = 'note';
const FOLDERS = 'folder';
const REP = 'return=representation';

export async function fetchNotes(since) {
  const q = new URLSearchParams({ select: '*', order: 'updated_at.desc' });
  if (since) q.set('updated_at', `gt.${since}`);
  return request(`${REST}/${NOTES}?${q}`);
}

export async function fetchFolders() {
  return request(`${REST}/${FOLDERS}?select=*&order=sort.asc`);
}

// Ids are generated on the client (crypto.randomUUID), so insert and update are
// the same call. Upsert is idempotent, which means a retried outbox item can
// never create a duplicate — that is why there is no pending-id swap anywhere.
const UPSERT = 'resolution=merge-duplicates,' + REP;

export async function upsertNote(row) {
  const rows = await request(`${REST}/${NOTES}`, { method: 'POST', body: row, prefer: UPSERT });
  return rows[0];
}

export async function upsertFolder(row) {
  const rows = await request(`${REST}/${FOLDERS}`, { method: 'POST', body: row, prefer: UPSERT });
  return rows[0];
}

export async function patchNote(id, fields) {
  const rows = await request(`${REST}/${NOTES}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: fields, prefer: REP,
  });
  return rows[0];
}

/** Soft delete. Recently Deleted is iOS Notes parity and costs one column. */
export async function trashNote(id) {
  return patchNote(id, { deleted_at: new Date().toISOString() });
}
