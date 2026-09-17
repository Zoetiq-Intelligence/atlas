# Notes app — STATE

> Owned by this project's thread. Per `_protocol/COORDINATION.md`, master (`claude-a2`) **is** this project's thread for v0 — it builds directly rather than commissioning a child session. Promote to a separate session if it outgrows master's context.
> Last updated: 2026-09-17

## One-line status

**v1.5 LIVE and in daily use** on the operator's iPhone home screen and Edge on PC since 2026-09-16, signed in and syncing. 162 tests. Open work in `../../QUEUE.md`; full context in `../../HANDOFF-2026-09-17.md`.

## Previous status (2026-09-13)

**v0 skeleton built and verified in a real browser; ready to hand over.** ~1,800 lines, 32 files, zero dependencies, no build step. 26 model tests (node), 17 editor tests and 23 app tests (Chromium) all passing. Blocked only on credentials to go live. `COMMISSION.md` is written and the thread can be opened.

## Previous status (2026-09-12)

**Design settled, building v0 today.** `DESIGN.md` and `ROADMAP.md` written 2026-09-12. Document model decided (block array as `jsonb`, not HTML). Stack is now **absolute zero-dependency** — no npm, no build, no `supabase-js`. Blocked on three inputs from XENO: GitHub token, Supabase URL + anon key, and his PWA lessons from an existing app.

## Companion documents

- **`DESIGN.md`** — v0 architecture. The document model, the editor engine, Supabase over plain fetch, schema + RLS, sync, layout. Read this before writing any code.
- **`ROADMAP.md`** — v0 / drag-back / v1 / v2, and the rebuild-not-improve doctrine.

## Rung

Current: 0 · Target: 3 · Skips: **deliberate jump to rung 3.**

Justification, recorded so it can be challenged: known territory — the operator has built many Safari add-to-home-screen web apps. Supabase *buys* rung 3's capability rather than skipping it. The ladder manages risk; there's no risk here to manage.

## Stack

- Static client on **GitHub Pages, public repo**
- **Supabase** for data, behind RLS
- Target surface: Safari add-to-home-screen PWA on iOS

**Why public, not private:** private-visibility Pages gates the site behind a GitHub session cookie. That mostly works in a normal Safari tab but breaks add-to-home-screen standalone launches and service-worker fetches — meaning it tests fine and fails in use. Nothing in the client is sensitive: it's shell, data sits behind RLS, and the anon key is designed to be public. Going public removes the conflict rather than solving it.

**Escape hatch** if something ever must be private: Cloudflare Pages or Netlify deploying from a private repo — private source, public site, no auth gate.

## Scope

**In:**
- **Full parity with iOS Notes — everything it does, including tables, at least as well or better on every point.** Operator ruling, 2026-09-11. Not a subset.
- Side-by-side dual notes, quick swipe between them
- Always-floating footer: every styling and whitespace control exposed flat, nothing behind layers or menus
- Keyboard-up mobile layout: footer mid-screen above the keyboard, text being typed pinned to the top

**Out (explicitly):**
- Nothing is scoped out by choice. The only exclusions are platform-impossible — see Constraints.

## Now

Skeleton complete. Waiting on credentials to fill `config.js`, push, and install on both devices.

**Built and verified:** block document model · per-block contenteditable editor with hybrid input · caret mapping · flat two-row footer · dual panes with gutter and edge-swipe · slide-over list with folders and client-side search · magic-link auth over GoTrue REST · PostgREST upsert layer · local-first outbox sync · light and dark · manifest and icons.

**Bug found by the browser test, worth remembering:** `store.js` returned the raw `IDBRequest` rather than its `.result` for a missing key. Since a request object is truthy, "no session stored" read as "signed in" and the app skipped the sign-in gate entirely. Unit tests would not have caught it — it needed a real IndexedDB.

## Next

1. Fill `config.js` with the Supabase URL and anon key
2. Push to the `notes` repo; enable Pages by API
3. Sign in for real — confirm the magic link returns tokens in the fragment as predicted, not as `?code=`
4. Install to the iPhone home screen and to Edge on PC; verify a note typed on one appears on the other after a focus change
5. **Hand over to the project thread** using `COMMISSION.md`
6. Thread proves the engine on real iOS — autocorrect, dictation, predictive text, in standalone mode

Step 6 is the whole point of v0 and cannot be done from here.

## Blocked

Nothing. Live. Next work item is live sync — see `../../QUEUE.md`.

## Previously blocked (2026-09-13, all cleared)

On XENO. The build is done; these are what stand between it and running on his devices:

1. **GitHub token + username** — fine-grained PAT scoped to the `notes` repo. Verified this container can `git push` (git 2.43.0, `api.github.com` reachable).
2. **Supabase project URL + anon key.** Q4 resolved without him: the implicit flow is ours by construction since we never send a `code_challenge`. Nothing to configure.
3. **PWA lessons from his existing add-to-home-screen app** — `DESIGN.md` §10 and `sw.js` are deliberately unwritten pending these. A stale cached shell is the top failure mode of this stack and is not worth guessing at.

## Tried and rejected

- **Additive reader/capture layer over existing notes.** Was the original plan — treat this as rung 1, wrap the notes that already exist, don't replace. Rejected by the operator: the full replacement is a known one-shot for them, so the additive phase buys nothing but delay.
- **Private Enterprise repo.** Rejected on the auth-gate conflict above.

## Decisions

- 2026-09-11 — Jumps the ladder to rung 3; first project in build order, ahead of the Edge extension.
- 2026-09-11 — Public repo over private.
- 2026-09-11 — **Parity ruling: everything iOS Notes does, including tables, as well or better on every point.** No feature cut list. Consequence: the document model must support tables from the first schema, and the four platform-impossible items in Constraints need substitutions decided rather than discovered.
- 2026-09-12 — **Absolute zero dependencies.** No npm, no `package.json`, no bundler, no transpile, no runtime library — *including* `supabase-js`. Hand-written ES modules served raw from Pages; Supabase reached by plain `fetch` against PostgREST and GoTrue. Reason given: maximum customisability, permanently. Cost accepted and itemised in `DESIGN.md` §1.
- 2026-09-12 — **Document model: block array stored as `jsonb`, not HTML.** `contenteditable` HTML is browser output and Safari and Chrome produce different output; storing it means parsing browser quirks forever. A block array round-trips exactly and makes a v1 table a two-level recursion rather than a parser. This closes the "decide the model before anything is stored" requirement.
- 2026-09-12 — **Editor: per-block contenteditable, hybrid input.** Structural and formatting ops intercepted via `beforeinput`; plain typing left native and reconciled on `input`. Reason: fully controlled input breaks iOS autocorrect, dictation and IME — which is the normal typing path on the primary target device, not an edge case.
- 2026-09-12 — **Auth: email magic link, implicit flow**, RLS keyed on `auth.uid()`. PKCE rejected for v0: its threat model does not apply to a single-user public client, and it costs a stateful pre-step.
- 2026-09-12 — **Keyboard-up layout deferred out of v0** by XENO. ⚠️ Recorded consequence: v0 will not prove the interaction model, which this file has called the project's day-one gate since 2026-09-11. Mitigation: all positioning derives from one function in `layout.js`, so enabling it is a one-function change. Risk accepted, not eliminated.
- 2026-09-12 — **v0 is disposable; v1 is a rebuild from documents.** Fixes allowed within a version, features are not. Dragging back to design docs is a first-class transition on `ROADMAP.md`, not an emergency.
- 2026-09-13 — **Ids are generated on the client** (`crypto.randomUUID`), so insert and update are one idempotent upsert. A retried outbox item can never create a duplicate, which removes the pending-id swap dance entirely.
- 2026-09-13 — **The first block of a note renders as its title** without being a distinct block type. Keeps the model uniform and makes the denormalised `title` column exactly "first non-empty line".
- 2026-09-13 — **Pane switching conflict solved by `touch-action`, not JavaScript.** `.editor` is `pan-y` so a horizontal drag in the text belongs to selection; the edge strips and gutter are `pan-x`. Native scroll-snap then does the swipe with free momentum and no touch handlers.
- 2026-09-12 — **v0 search is client-side**, not `tsvector`. One user, hundreds of notes. Deliberate shortcut, revisited in v1.
- 2026-09-12 — **v0 conflict resolution is last-write-wins on the whole note.** Can lose an edit if the same note is edited on two devices while one is offline. Accepted for v0; per-block `id`s exist in the model specifically to fix this properly in v1.

## Constraints — the honest version of full parity

Parity is settled as a goal. What follows is not scope negotiation; it is which items a PWA can actually deliver, so the gap is known on day one rather than discovered late.

**Achievable, ordinary work:** rich text, folders and subfolders, checklists, pinning, search, sort, note links, password-free organisation, gallery/list views.

**Achievable but non-trivial — budget real time:**
- **Tables.** Explicitly named by the operator. This is the single largest piece of editor work in the project: a table model inside a rich-text document, with mobile column resize and cell navigation over a virtual keyboard. It drives the schema — a plain-text or simple-HTML note body will not survive it. Decide the document model *before* anything else is stored.
- **Attachments and images.** Needs Supabase Storage plus an upload/thumbnail path.
- **Offline editing and sync.** iOS Notes is offline-first with silent conflict resolution. A PWA can approximate this with a local store plus a sync layer, but conflict handling is a design decision, not a library call.
- **Per-note locking.** Achievable with a passphrase and client-side encryption. Not achievable with Face ID / Touch ID the way iOS does it — WebAuthn can gate access but is a different trust model.

**Not achievable from a PWA — needs a substitute, not an attempt:**
- **Share-sheet extension.** iOS does not let a web app register as a share target the way a native app does. Substitute: the Web Share Target API works only for installed PWAs with real limits on iOS, so plan for a paste-in capture flow or a Shortcut that posts to Supabase.
- **Document scanning.** No VisionKit. `getUserMedia` plus a JS edge-detect/dewarp library gets partway, and it will be visibly worse than Apple's.
- **Handwriting and Apple Pencil.** Pointer events give ink capture; they do not give PencilKit, palm rejection, or handwriting recognition/search.
- **Deep OS integration.** Siri, Spotlight indexing, widgets, Lock Screen quick note.

**Recommendation to master:** the operator's ruling stands, and most of the list is reachable. But "at least as well or better on every point" is unachievable on the four items above, by platform limit rather than effort. Get a per-item decision — substitute, drop, or reconsider the PWA — before the build starts, because the tables ruling alone already dictates the data model.

## Hosting

- **Repo: `Zoetiq-Intelligence/atlas`, app at `/notes/`.** Site: `https://zoetiq-intelligence.github.io/atlas/notes/`.
- **Public, temporarily.** Private Pages gates the site behind a login, which breaks standalone launches. When privacy is needed the swap is Cloudflare Pages or Netlify from a private repo — no client change, hosting only.
- **Electron workstation app is a stated future surface.** Cross-device sync is the invariant. Rung 3 (local companion) should be exhausted before rung 4; the adapter seams (`store.js`, `net.js`) are what make either affordable.

## Open questions

**Q3 — Was deferring the keyboard layout intended?** Raised 2026-09-12. It is the one item this file names as the day-one gate, and it was deselected from the v0 floor. Treated as deliberate; confirm.

**Q4 — Which magic-link flow is the Supabase project configured for**, implicit or PKCE? Two minutes in the dashboard. The token parser depends on it.

**Q5 — Repo name for the app**, and is the coordination repo itself on GitHub yet or still only the seed zip?

**Q1 — The four platform-impossible parity items** (share sheet, scanning, Pencil, deep OS integration) still have no per-item ruling. Open since 2026-09-11. Not a v0 blocker; **it is the v1 gate** per `ROADMAP.md`.

**Q2 — Does the keyboard layout actually work?**
This is the only genuinely hard part of the spec; everything else is ordinary app work. Footer-above-keyboard with text pinned to top fights iOS Safari specifically. Needs `visualViewport` — `100vh` lies when the keyboard is up, and standalone mode behaves differently from a browser tab. **Build this as a standalone prototype first.** If it can't be made to feel right, the whole interaction model changes, and that's day-one information.
