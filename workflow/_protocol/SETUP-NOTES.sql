-- Notes app schema. Paste into Supabase SQL Editor and Run.
--
-- Lives in its own `notes` schema rather than `public`, because this Supabase project
-- is shared with other systems. After running this you MUST add `notes` to
-- Settings -> API -> Exposed schemas (keeping whatever is already listed), or
-- PostgREST cannot see it at all.

create schema if not exists notes;
grant usage on schema notes to anon, authenticated;

create table if not exists notes.folder (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  parent_id  uuid references notes.folder on delete cascade,
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes.note (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id  uuid references notes.folder on delete set null,
  title      text not null default '',
  doc        jsonb not null default '{"v":1,"blocks":[]}'::jsonb,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The client never sends user_id; it is defaulted server-side to auth.uid() and
-- enforced here. A client that sets its own user_id is a client that can lie about it.
alter table notes.folder enable row level security;
alter table notes.note   enable row level security;

drop policy if exists "own folders" on notes.folder;
drop policy if exists "own notes"   on notes.note;
create policy "own folders" on notes.folder for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes" on notes.note for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at is maintained by the server. A client clock is not a clock, and v0 sync
-- resolves conflicts by comparing this column.
create or replace function notes.touch() returns trigger
  language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists folder_touch on notes.folder;
drop trigger if exists note_touch   on notes.note;
create trigger folder_touch before update on notes.folder
  for each row execute function notes.touch();
create trigger note_touch before update on notes.note
  for each row execute function notes.touch();

create index if not exists note_user_updated on notes.note (user_id, updated_at desc);
create index if not exists note_folder       on notes.note (folder_id);
create index if not exists folder_user       on notes.folder (user_id, sort);

grant all on all tables    in schema notes to anon, authenticated;
grant all on all sequences in schema notes to anon, authenticated;
