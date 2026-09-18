-- Notes app — live sync. Paste into the Supabase SQL Editor and Run.
--
-- Depends on SETUP-NOTES.sql. Safe to re-run.
--
-- BROADCAST FROM THE DATABASE, not `postgres_changes`. Three reasons, in order of
-- weight, all recorded in projects/notes-app/REALTIME-FINDINGS.md:
--
--   1. postgres_changes does NOT apply RLS to DELETEs. With replica identity full,
--      deleting a row broadcasts the WHOLE ROW to every subscriber of that table.
--   2. It would need `grant select` on notes.* to `authenticated` project-wide —
--      widening exactly the surface the dedicated schema exists to narrow. A trigger
--      is security definer, so the `notes` schema needs no grants at all.
--   3. Its payload is the whole row, and past ~1 MB walrus does not drop the event,
--      it MANGLES it: fields over 64 bytes are stripped and `errors` is set. A notes
--      app with long bodies hits that cliff. We send a thin notification instead and
--      let the device fetch the row it already knows how to fetch.
--
-- Supabase's own guidance agrees: "Don't use postgres_changes for new applications."

-- ---------------------------------------------------------------- read policy
--
-- Private channels authorise ONCE, at join, against realtime.messages. RLS is already
-- enabled on that table and you cannot create tables in that schema, so this is the
-- whole authorisation story for the stream: a user may read exactly the topic named
-- after their own uid.

drop policy if exists "own notes topic" on realtime.messages;
create policy "own notes topic" on realtime.messages
for select to authenticated
using (
  realtime.topic() = 'notes:' || (select auth.uid())::text
  and realtime.messages.extension = 'broadcast'
);

-- ---------------------------------------------------------------- trigger
--
-- The payload is deliberately THIN: op, which table, the id, and the server's
-- updated_at. The device then pulls the row over PostgREST, which it already does on
-- every poll — so the stream is a latency reducer over a path that is already proven,
-- not a second way to get data in. Delivery is at-most-once; a dropped message costs
-- five seconds, not an edit.
--
-- `updated_at` is in the payload so a device can recognise its OWN echo. A database
-- broadcast always reaches the writer (broadcast.self only governs client-sent
-- messages), and without that field every save you make comes back at you as news.

create or replace function notes.broadcast_change()
returns trigger
security definer
set search_path = ''
language plpgsql as $$
declare
  v_uid uuid;
  v_id  uuid;
  v_at  timestamptz;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT; reading the wrong
  -- one raises rather than returning null, so branch instead of coalescing.
  if tg_op = 'DELETE' then
    v_uid := old.user_id; v_id := old.id; v_at := old.updated_at;
  else
    v_uid := new.user_id; v_id := new.id; v_at := new.updated_at;
  end if;

  if v_uid is null then return null; end if;

  perform realtime.send(
    jsonb_build_object(                    -- payload   (arg 1 — verified 2026-09-18)
      'op',         tg_op,
      'kind',       tg_table_name,         -- 'note' | 'folder'
      'id',         v_id,
      'updated_at', v_at
    ),
    'change',                              -- event     (arg 2)
    'notes:' || v_uid::text,               -- topic     (arg 3)
    true                                   -- private   (arg 4)
  );
  return null;
end $$;

drop trigger if exists note_broadcast   on notes.note;
drop trigger if exists folder_broadcast on notes.folder;

create trigger note_broadcast
  after insert or update or delete on notes.note
  for each row execute function notes.broadcast_change();

create trigger folder_broadcast
  after insert or update or delete on notes.folder
  for each row execute function notes.broadcast_change();

-- ---------------------------------------------------------------- check
--
-- Confirms the argument order this file depends on. Expect:
--   send             | payload jsonb, event text, topic text, private boolean DEFAULT true
select proname, pg_get_function_arguments(oid)
  from pg_proc
 where proname = 'send' and pronamespace = 'realtime'::regnamespace;
