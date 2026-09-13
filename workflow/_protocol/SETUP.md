# Setup — shared services

> Master owns everything in this file. Project threads **never** create accounts, repos, projects or credentials.
> Owned by master. Last updated: 2026-09-12

A commissioned thread inherits a working environment: a repo it can push to, a database with a schema already applied, and auth already configured. It does its application and nothing else.

---

## Part 1 — GitHub

### 1.1 Create the app repo

<https://github.com/new>

- **Name:** `notes`
- **Visibility: Public** — required. Private Pages gates the site behind a session cookie, which breaks add-to-home-screen standalone launches. Settled 2026-09-11.
- **Do not** add a README, `.gitignore`, or licence. Leave it completely empty — master pushes a full tree and an initialised repo causes a conflict on the first push.

### 1.2 Create the coordination repo

<https://github.com/new>

- **Name:** `workflowpipelines`
- **Visibility: Private is fine.** It is docs and coordination, not a website. Two repos, different rules — do not conflate them.
- Again: completely empty.

### 1.3 Create a fine-grained token

<https://github.com/settings/personal-access-tokens/new>

- **Token name:** `claude-master-cloud`
- **Expiration:** 90 days. Short enough to matter, long enough not to be a chore.
- **Repository access:** *Only select repositories* → select **both** `notes` and `workflowpipelines`
- **Permissions → Repository permissions:**

| Permission | Set to | Why |
|---|---|---|
| **Contents** | Read and write | push code. Without this nothing works. |
| **Pages** | Read and write | lets master enable and configure Pages by API instead of you clicking |
| **Workflows** | Read and write | only if a Pages build action is ever added. Safe to include. |
| Metadata | Read-only | auto-selected, mandatory |

Everything else: **No access.** Do not use a classic token — classic tokens cannot be scoped to individual repos.

- Generate, then copy the `github_pat_…` string. **It is shown once.**

### 1.4 Hand over

Paste into chat: the token, and your **GitHub username** (needed for the Pages URL, `https://<username>.github.io/notes/`).

⚠️ Pasting a token into a chat means it lives in the transcript. It is scoped to two repos and expires in 90 days, which is the point of a fine-grained token. **Revoke it at <https://github.com/settings/personal-access-tokens> when the project stops needing it**, or sooner if anything feels wrong. Master will not print it back.

---

## Part 2 — Supabase

### 2.1 Create the project

<https://supabase.com/dashboard> → **New project**

- **Name:** `notes`
- **Region:** closest to you — `East US (North Virginia)` from the US east coast
- **Database password:** generate one and save it in your password manager. **Master never needs it** — everything here goes through the REST API with the anon key, never a direct Postgres connection.

Provisioning takes ~2 minutes.

### 2.2 Apply the schema

**SQL Editor** → **New query** → paste all of this → **Run**.

```sql
-- folders ---------------------------------------------------------------
create table folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  parent_id   uuid references folders on delete cascade,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- notes -----------------------------------------------------------------
create table notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id   uuid references folders on delete set null,
  title       text not null default '',
  doc         jsonb not null default '{"v":1,"blocks":[]}'::jsonb,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- row level security ----------------------------------------------------
alter table folders enable row level security;
alter table notes   enable row level security;

create policy "own folders" on folders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own notes" on notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at is maintained by the server, never the client --------------
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger folders_touch before update on folders
  for each row execute function touch_updated_at();

create trigger notes_touch before update on notes
  for each row execute function touch_updated_at();

-- indexes ---------------------------------------------------------------
create index notes_user_updated on notes (user_id, updated_at desc);
create index notes_folder       on notes (folder_id);
create index folders_user       on folders (user_id, sort);
```

Expect `Success. No rows returned.` If you get `relation already exists`, the script was run twice — harmless, but tell master.

### 2.3 Configure auth URLs

**Authentication → URL Configuration**

- **Site URL:** `https://<username>.github.io/notes/`
- **Redirect URLs** — add both:
  - `https://<username>.github.io/notes/**`
  - `http://localhost:8000/**`

The second is for local testing. **Both need the trailing `/**`** or the magic link bounces with `redirect_to is not allowed`.

**Authentication → Sign In / Providers → Email:** confirm **Email** is enabled. That is the default; magic link needs nothing else turned on.

### 2.4 Copy the credentials

**Project Settings → API Keys**

- **Project URL** — `https://xxxxxxxx.supabase.co`
- **anon / public key** — a long `eyJ…` JWT, or an `sb_publishable_…` string on newer projects. Either is fine; both go in the `apikey` header.

**This key is public by design.** It goes in `config.js` in a public repo on purpose. It grants nothing on its own — RLS is what protects the data, and §2.2 just enabled it. The key that must never leave the dashboard is the **service_role** key. Do not copy that one anywhere.

### 2.5 Hand over

Paste into chat: Project URL and anon key.

---

## Resolved while writing this

**Q4 — implicit vs PKCE — is answered, and it is not a dashboard setting.** GoTrue chooses the flow from what the *client* sends: include `code_challenge` on `/auth/v1/otp` and you get PKCE; omit it and `/auth/v1/verify` redirects with tokens in the URL fragment. We hand-roll the client and simply will not send a challenge, so we get implicit by construction. No configuration needed. Verify empirically on the first real login — if tokens arrive as `?code=` instead of `#access_token=`, this note is wrong and the parser changes.

---

## Known gotchas

- **Auth email rate limit.** Supabase's built-in SMTP allows only a handful of auth emails per hour on the free tier. Testing login repeatedly will silently stop sending. It is not a bug in the app. Custom SMTP lifts it if it becomes a real obstacle.
- **Pages serves at a subpath** — `username.github.io/notes/`, not the domain root. Every path in the app must be relative. One absolute `/js/main.js` and the app 404s *only* in production. Already recorded in `DESIGN.md` §10.
- **Pages needs a branch before it can be enabled.** Master pushes `main` first, then turns Pages on by API. Do not go looking for the setting in an empty repo.
- **First Pages deploy takes a few minutes.** Subsequent pushes are usually under a minute.

---

## Credential ledger

What master holds, what it is for, and how to revoke it. Keep this current — it is the thing you read when you want to shut access off.

| Credential | Scope | Revoke at |
|---|---|---|
| GitHub fine-grained PAT | `notes` + `workflowpipelines`, contents + pages | <https://github.com/settings/personal-access-tokens> |
| Supabase anon key | public by design, RLS-gated | rotate in Project Settings → API Keys |
| Supabase DB password | held by XENO only, master never sees it | — |
| Supabase service_role key | **never leaves the dashboard** | — |
