-- Notes app — snapshot backups and revert. Paste into the Supabase SQL Editor and Run.
--
-- Depends on SETUP-NOTES.sql having already been run (it creates the `notes` schema).
-- Safe to re-run: every statement is idempotent.
--
-- WHY THE SNAPSHOT IS BUILT SERVER-SIDE. The obvious client design — read the local
-- IndexedDB copy and POST it up — backs up whatever that ONE device happened to have,
-- which may be stale or mid-sync. The snapshot has to be taken from the canonical
-- state, so it is taken inside Postgres and the client sends no data at all. The
-- client's only job is to decide when to ask.
--
-- WHY security invoker RATHER THAN definer. These functions read and write the
-- caller's own rows and nothing else, so RLS doing the filtering is both sufficient
-- and safer than a definer function that has to re-implement the same check correctly.
-- A definer function here would be a second copy of the security model.

-- ---------------------------------------------------------------- table

create table if not exists notes.snapshot (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  taken_at     timestamptz not null default now(),
  reason       text not null default 'auto',   -- auto | manual | pre-restore
  note_count   int  not null default 0,
  folder_count int  not null default 0,
  notes        jsonb not null default '[]'::jsonb,
  folders      jsonb not null default '[]'::jsonb
);

alter table notes.snapshot enable row level security;

drop policy if exists "own snapshots" on notes.snapshot;
create policy "own snapshots" on notes.snapshot for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists snapshot_user_taken on notes.snapshot (user_id, taken_at desc);

-- SETUP-NOTES.sql granted on "all tables in schema notes", which applies only to the
-- tables that existed WHEN IT RAN. A new table gets nothing from it. Without this the
-- table exists, RLS is correct, and PostgREST still returns 404.
grant select, insert, update, delete on notes.snapshot to authenticated;

-- ---------------------------------------------------------------- take

-- Returns jsonb rather than a row so the client gets one shape whether or not a
-- snapshot was actually created. `latest_at` is always the truth about when the last
-- backup happened, so a device that has never backed up learns it from the decline.
create or replace function notes.take_snapshot(
  p_min_interval_seconds int  default 21600,   -- 6 hours; 0 = take one unconditionally
  p_reason               text default 'auto'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_last    timestamptz;
  v_id      uuid;
  v_notes   jsonb;
  v_folders jsonb;
  v_nc      int;
  v_fc      int;
  v_now     timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Two devices waking at the same moment would both read "due" and both insert.
  -- The duplicate would be harmless, but the lock is one line and removes the race.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select max(taken_at) into v_last from notes.snapshot where user_id = v_uid;

  if p_min_interval_seconds > 0
     and v_last is not null
     and v_last > v_now - make_interval(secs => p_min_interval_seconds) then
    return jsonb_build_object(
      'created',     false,
      'why',         'not_due',
      'latest_at',   v_last,
      'next_due_at', v_last + make_interval(secs => p_min_interval_seconds)
    );
  end if;

  -- Soft-deleted notes are included deliberately: a snapshot is a picture of the
  -- state, and Recently Deleted is part of the state.
  select coalesce(jsonb_agg(to_jsonb(n) order by n.updated_at), '[]'::jsonb), count(*)
    into v_notes, v_nc
    from notes.note n where n.user_id = v_uid;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.sort), '[]'::jsonb), count(*)
    into v_folders, v_fc
    from notes.folder f where f.user_id = v_uid;

  insert into notes.snapshot (user_id, taken_at, reason, note_count, folder_count, notes, folders)
  values (v_uid, v_now, p_reason, v_nc, v_fc, v_notes, v_folders)
  returning id into v_id;

  -- Keep the newest 40 — about ten days at one every six hours.
  delete from notes.snapshot s
   where s.user_id = v_uid
     and s.id not in (
       select id from notes.snapshot
        where user_id = v_uid
        order by taken_at desc
        limit 40
     );

  return jsonb_build_object(
    'created',     true,
    'id',          v_id,
    'taken_at',    v_now,
    'latest_at',   v_now,
    'reason',      p_reason,
    'notes',       v_nc,
    'folders',     v_fc,
    'next_due_at', v_now + make_interval(secs => greatest(p_min_interval_seconds, 1))
  );
end $$;

-- ---------------------------------------------------------------- restore

-- NOTHING IS EVER HARD-DELETED HERE. A note that exists now but is absent from the
-- snapshot is soft-deleted with the same `deleted_at` column the app already uses for
-- Recently Deleted, so a restore is reversible on its own terms even without the
-- safety snapshot below. Two independent ways back, deliberately.
--
-- Folders present now but absent from the snapshot are LEFT ALONE. notes.note
-- references notes.folder with `on delete set null`, so removing a folder would
-- silently detach notes that the snapshot says belong to it — a worse outcome than an
-- extra empty folder.
create or replace function notes.restore_snapshot(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_snap     notes.snapshot%rowtype;
  v_safety   jsonb;
  v_notes    int := 0;
  v_folders  int := 0;
  v_trashed  int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_snap from notes.snapshot where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'snapshot % not found', p_id using errcode = 'P0002';
  end if;

  -- A restore is itself undoable. 0 = ignore the interval; this one always happens.
  v_safety := notes.take_snapshot(0, 'pre-restore');

  -- Folders first: notes reference them.
  insert into notes.folder (id, user_id, name, parent_id, sort, created_at)
  select (f->>'id')::uuid, v_uid, coalesce(f->>'name', ''),
         nullif(f->>'parent_id', '')::uuid,
         coalesce((f->>'sort')::int, 0),
         coalesce((f->>'created_at')::timestamptz, now())
    from jsonb_array_elements(v_snap.folders) f
  on conflict (id) do update
    set name = excluded.name, parent_id = excluded.parent_id, sort = excluded.sort;
  get diagnostics v_folders = row_count;

  insert into notes.note (id, user_id, folder_id, title, doc, pinned, created_at, deleted_at)
  select (n->>'id')::uuid, v_uid,
         nullif(n->>'folder_id', '')::uuid,
         coalesce(n->>'title', ''),
         coalesce(n->'doc', '{"v":1,"blocks":[]}'::jsonb),
         coalesce((n->>'pinned')::boolean, false),
         coalesce((n->>'created_at')::timestamptz, now()),
         nullif(n->>'deleted_at', '')::timestamptz
    from jsonb_array_elements(v_snap.notes) n
  on conflict (id) do update
    set folder_id  = excluded.folder_id,
        title      = excluded.title,
        doc        = excluded.doc,
        pinned     = excluded.pinned,
        deleted_at = excluded.deleted_at;
  get diagnostics v_notes = row_count;

  update notes.note
     set deleted_at = now()
   where user_id = v_uid
     and deleted_at is null
     and id not in (select (n->>'id')::uuid from jsonb_array_elements(v_snap.notes) n);
  get diagnostics v_trashed = row_count;

  -- note_touch sets updated_at = now() on every UPDATE, so every restored row is
  -- newer than whatever each device holds. The existing last-write-wins pull then
  -- carries the restore to both devices with no extra machinery.
  return jsonb_build_object(
    'restored_notes',   v_notes,
    'restored_folders', v_folders,
    'trashed_notes',    v_trashed,
    'from',             v_snap.taken_at,
    'safety_snapshot',  v_safety
  );
end $$;

grant execute on function notes.take_snapshot(int, text) to authenticated;
grant execute on function notes.restore_snapshot(uuid) to authenticated;

-- PostgREST caches the schema. Without this the table and both functions exist and
-- the API still answers 404 until the next time it happens to reload.
notify pgrst, 'reload schema';
