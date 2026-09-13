# Notes app — DESIGN

> Owned by this project's thread. Master reads, never writes.
> Status: **v0 design, settled enough to build.** Sections marked ⏸ are held open.
> Last updated: 2026-09-12

---

## Rulings this design obeys

Settled by XENO, 2026-09-12. Listed first because every decision below is downstream of them.

1. **Absolute zero dependencies.** No npm, no `package.json`, no bundler, no transpile step, no runtime library — *including* `supabase-js`. Hand-written ES modules served raw. What is in the repo is byte-for-byte what runs in the browser.
2. **Maximum customisability.** Every layer is ours, so every layer can be changed. This is the reason for #1, not a side effect of it.
3. **v0 is disposable.** We fix v0; we do not improve it. v1 is a **full rebuild from documents**, and dragging the project back down to design docs is an expected move, not a failure.
4. **v0 feature floor:** editor + flat floating footer, Supabase sync + folders + search, dual-pane swipe.
5. **Auth:** email magic link, single user, RLS keyed on `auth.uid()`.
6. **Deferred from v0 by XENO:** keyboard-up layout. ⚠️ See §9 — this is the project's flagged critical path and it is deferred, not cancelled. The layout engine is built to accept it without a rewrite.

**Explicitly v1, not v0:** tables, attachments/images, offline conflict resolution, per-note locking, realtime.

---

## 1. What zero-dependency actually costs

Written plainly so it is a chosen cost, not a discovered one.

| We hand-write | Instead of | Rough size |
|---|---|---|
| Rich-text editing engine | TipTap / Lexical | ~700–900 lines |
| Auth token lifecycle (magic link, hash parse, refresh, expiry) | `supabase-js` | ~120 lines |
| PostgREST request layer | `supabase-js` | ~80 lines |
| IndexedDB wrapper | `idb` / `dexie` | ~70 lines |
| Sync outbox | any sync lib | ~150 lines |

**What we get:** no supply chain, no version churn, no framework fighting us on the exact thing (keyboard/footer behaviour) that this app exists to get right, and a codebase small enough to hold entirely in one session's context.

**What we lose in v0, honestly:** realtime subscriptions (Supabase Realtime is a Phoenix-channel WebSocket protocol — hand-rolling it is a v1 decision, not a v0 one), and anything free from a library's accumulated browser bug fixes. §5 and §6 say how we cover the gaps.

---

## 2. Repo shape

Two repos. Do not conflate them.

- **`workflowpipelines`** — coordination. May be private.
- **`notes`** (name TBD) — the app. **Must be public**, per the Pages/add-to-home-screen ruling already in `STATE.md`.

```
notes/
├── index.html          entry, ~40 lines, no logic
├── manifest.webmanifest
├── sw.js               ⏸ pending XENO's lessons
├── config.js           SUPABASE_URL + anon key (public by design)
├── css/
│   ├── base.css        reset, tokens, type scale
│   ├── layout.css      panes, footer, responsive
│   └── editor.css      block styling
├── js/
│   ├── main.js         wiring only
│   ├── adapters/
│   │   ├── store.js    get/set/all — IndexedDB behind it
│   │   └── net.js      one request() — everything HTTP goes through here
│   ├── model/
│   │   ├── doc.js      block document: create, split, merge, mark
│   │   └── schema.js   block type definitions
│   ├── editor/
│   │   ├── render.js   model → DOM
│   │   ├── input.js    beforeinput/input → model
│   │   └── caret.js    DOM Range ↔ (blockId, offset)
│   ├── ui/
│   │   ├── panes.js    dual pane + swipe
│   │   ├── footer.js   the flat control bar
│   │   ├── sidebar.js  folders, list, search
│   │   └── layout.js   viewport math — the keyboard seam (§9)
│   └── data/
│       ├── auth.js     magic link + token lifecycle
│       ├── api.js      PostgREST calls
│       └── sync.js     local-first outbox
└── icons/
```

**Adapter-shaped, per `PROTOCOL.md`:** all storage behind `store.get/set`, all network behind one `request()`. Two files are the seam to every future platform — extension, local companion, native shell.

**No file imports another file's internals.** `main.js` wires; modules do not reach sideways. This is what makes "drag it back down and rebuild" cheap in v1.

---

## 3. The document model — the decision everything else depends on

**Not HTML. A block array, stored as `jsonb`.**

```json
{
  "v": 1,
  "blocks": [
    { "id": "k3f9", "t": "h1",    "text": "Groceries" },
    { "id": "k3fa", "t": "p",     "text": "for saturday", "marks": [[4,12,"i"]] },
    { "id": "k3fb", "t": "check", "text": "oat milk", "done": false },
    { "id": "k3fc", "t": "li",    "text": "bread", "depth": 0 }
  ]
}
```

- `t` — block type: `p h1 h2 h3 li ol check quote code hr`. **v1 adds `table`**, whose cells each hold a block array. The shape already accommodates it.
- `marks` — `[start, end, type]` triples over the block's own text. Types: `b i u s code link`. Link carries a fourth element, the href.
- `id` — stable per block. Makes sync per-block rather than per-note in v1.

**Why not HTML in a text column.** `contenteditable` HTML is whatever the browser decided to produce, and Safari and Chrome decide differently. You would be storing browser output and then parsing it back, forever, with the normalisation bugs baked into your data. A block array is deterministic: it round-trips exactly, diffs cleanly, searches with a `text` join, and renders identically everywhere because *we* render it.

**Why this survives the tables ruling.** `STATE.md` is correct that tables dictate the schema and must be settled first. A table as a block containing block arrays is a two-level recursion of a model we already have. A table inside serialised HTML is a parser.

---

## 4. The editor engine — hybrid controlled input

This is the highest-risk code in the project and the part most likely to be got wrong, so the strategy is stated explicitly.

**Each block is its own `contenteditable="true"` element.** Never one large contenteditable wrapping everything.

Reason: the whole nightmare of hand-rolled editors is the browser deciding how to restructure your DOM on Enter, Backspace-at-boundary, and list nesting. Per-block, the browser's blast radius is one block's inline content, and *we* own every structural operation.

**The hybrid rule — this is the part that matters:**

- **Let the browser handle plain typing inside a block.** Do not `preventDefault()` on `insertText` or `insertCompositionText`. Read the block's text back on the `input` event and reconcile marks by offset.
- **Intercept structural and formatting operations** via `beforeinput` + `preventDefault()`: `insertParagraph` (split block), `deleteContentBackward` at offset 0 (merge with previous), `deleteContentForward` at end, `insertFromPaste`, `formatBold`/`formatItalic`/`formatUnderline`.

**Why hybrid rather than fully controlled.** Fully intercepting `insertText` is the clean-looking design and it breaks iOS: autocorrect, predictive text, dictation, and IME composition all go through composition events that fight `preventDefault`. On the primary target device that is not an edge case, it is the normal typing path. Letting text land natively and reconciling afterward costs a reconciliation function and buys a keyboard that behaves like the system keyboard.

**Caret** is stored as `(blockId, offset)` in the model, never as a DOM Range. `caret.js` maps both directions by walking text nodes. Every re-render restores from the model. This one discipline eliminates the entire class of "cursor jumped to the start" bugs.

**Undo:** our own stack of model snapshots, coalescing keystrokes within ~500ms. Native `document.execCommand` undo is unusable once we mutate the model ourselves — do not attempt to share it.

---

## 5. Supabase without `supabase-js`

Everything is plain `fetch` through `net.js`. Two headers do all the work: `apikey: <anon>` always, and `Authorization: Bearer <access_token>` once signed in.

### Auth — magic link

```
POST {SUPABASE_URL}/auth/v1/otp
  apikey: <anon>
  { "email": "...", "create_user": true }
```

The emailed link returns to our `emailRedirectTo` URL. **Two flows exist and the project must be configured for one — verify in the dashboard before writing the parser:**

- **Implicit:** tokens arrive in the URL *hash* — `#access_token=…&refresh_token=…&expires_in=3600`. Simpler; parse the hash, clear it with `history.replaceState`, store both tokens.
- **PKCE:** a `?code=` lands instead and is exchanged at `/auth/v1/token?grant_type=pkce`. More moving parts, requires storing a verifier before sending.

**v0 uses implicit.** One user, public client, no third-party redirect chain — PKCE's threat model does not apply here, and it costs a stateful pre-step. Record this as a deliberate choice to revisit if the app ever gains other users.

Refresh, on 401 or ~60s before `expires_at`:

```
POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token
  apikey: <anon>
  { "refresh_token": "..." }
```

Tokens live in IndexedDB, not `localStorage` — same origin, but it keeps one storage story and survives larger payloads. **Single-flight the refresh**: concurrent 401s must await one refresh promise, not fire five.

### Data — PostgREST

```
GET    /rest/v1/notes?select=*&order=updated_at.desc
POST   /rest/v1/notes        Prefer: return=representation
PATCH  /rest/v1/notes?id=eq.<uuid>
POST   /rest/v1/notes        Prefer: resolution=merge-duplicates  (upsert)
```

`user_id` is **never sent by the client.** It is defaulted server-side to `auth.uid()` and enforced by RLS. A client that sets its own `user_id` is a client that can lie about it.

---

## 6. Schema and RLS

```sql
create table folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  parent_id   uuid references folders on delete cascade,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

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

alter table folders enable row level security;
alter table notes   enable row level security;

create policy "own folders" on folders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes" on notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index notes_user_updated on notes (user_id, updated_at desc);
create index notes_folder       on notes (folder_id);
```

- **`title` is denormalised** from the first block, so the note list renders without parsing every `doc`.
- **`deleted_at`, not `DELETE`** — a Recently Deleted folder is iOS Notes parity and costs one column.
- **`updated_at`** is maintained by a trigger, not the client. A client clock is not a clock.

**Search in v0 is client-side.** One user, hundreds of notes — pull them, filter in memory, instant, no network. v1 moves to a `tsvector` column with a GIN index when the corpus makes that wrong. Recorded as a deliberate v0 shortcut.

---

## 7. Sync — local-first, outbox

The app **never blocks on the network.** Ever.

1. Edit mutates the in-memory model.
2. Debounced ~400ms → write to IndexedDB. This write is the one that must not fail; the UI trusts it.
3. Append the note id to an outbox set.
4. A flusher drains the outbox: `PATCH` changed notes, retry with backoff, drop from the outbox only on a 2xx.
5. On load and on `visibilitychange` → visible: `GET` notes where `updated_at > lastPulledAt`, merge, re-render.

**Conflict in v0: last-write-wins on the whole note, by `updated_at`.** Stated plainly because it can lose an edit if the same note is edited on both devices while one is offline. Acceptable for one user on two devices in v0; it is exactly what the per-block `id` in §3 exists to fix properly in v1.

Poll-on-focus substitutes for Realtime. On a phone you return to the app and it is current, which covers the actual use.

---

## 8. Layout

**Dual pane, zero JS for the swipe.** A flex row with two `width:100%` children inside `scroll-snap-type: x mandatory`. Native momentum, native rubber-banding, native everything — the swipe costs no library and no touch handlers. A media query at the desktop breakpoint swaps to `grid-template-columns: 1fr 1fr` and turns snapping off, so PC gets true side-by-side and phone gets swipe from one stylesheet.

**The footer is flat by construction.** Every styling and whitespace control is a direct child of one scrollable control strip. No menus, no popovers, no disclosure. If a control needs a submenu, the control is wrong. Horizontal overflow scrolls; it does not collapse into a "more" button.

**All positioning derives from one function** in `layout.js` that returns `{top, height, keyboardHeight}`. In v0 it reads `window.innerHeight` and reports `keyboardHeight: 0`. §9 is the swap.

---

## 9. ⚠️ The keyboard seam — deferred, not designed away

`STATE.md` calls footer-above-keyboard with text pinned to top **the only genuinely hard part of the spec** and says to prototype it before anything else. XENO deferred it out of the v0 floor on 2026-09-12.

**Recorded consequence:** v0 will not prove the interaction model. That risk is accepted, not eliminated. If the model turns out not to work, it invalidates the footer design, and v1 is where that is discovered.

**What v0 does to keep the door open:** every element's position comes from the single `layout.js` function above. Turning the keyboard behaviour on is a change to *one function* — read `window.visualViewport.height/offsetTop`, subscribe to its `resize` and `scroll` events, report a real `keyboardHeight` — plus a scroll-into-view rule that pins the active block to the top of the visible band. No other file changes.

Facts to carry into that work: `100vh` lies when the keyboard is up; standalone (home-screen) mode behaves differently from a Safari tab; `visualViewport` is the only honest source. Prototype it against the real device, in standalone, not in a tab.

---

## 10. ⏸ PWA, Pages, service worker

**Held open pending XENO's lessons from his existing add-to-home-screen app.** Nothing here is decided; these are the questions that section will answer.

- Service worker caching strategy, and specifically **how the app updates without serving a stale shell forever** — the #1 failure mode of this stack.
- `manifest.webmanifest`: `display: standalone`, icon set, splash handling.
- iOS meta tags (`apple-mobile-web-app-capable`, status bar style) and which ones still matter.
- Safe-area insets, `viewport-fit=cover`.

**One gotcha to record now regardless:** GitHub Pages serves a project repo at `username.github.io/notes/`, not the domain root. **Every path must be relative** — `./js/main.js`, `"start_url": "./"`, `"scope": "./"`, service worker registered from the same directory. One absolute `/js/main.js` and the app 404s only in production, only on Pages. Avoided entirely by a custom domain if XENO wants one.

---

## 11. Open questions

1. **Was deferring the keyboard layout intended?** (§9) It is the one item the project's own state file names as the day-one gate.
2. **Repo name and the GitHub token.** This session can `git push` directly (verified: `git` present, `api.github.com` reachable). A fine-grained PAT scoped to the notes repo removes XENO from the fix loop entirely.
3. **Which magic-link flow is the Supabase project configured for** — implicit or PKCE? (§5) Two minutes in the dashboard; the parser depends on it.
4. **The four platform-impossible parity items** (share sheet, scanning, Pencil, deep OS integration) still have no per-item ruling. Not a v0 blocker. It is a v1 blocker, and `STATE.md` has been flagging it since 2026-09-11.
