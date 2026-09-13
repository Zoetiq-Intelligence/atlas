# Notes app — ROADMAP

> Owned by this project's thread. Master reads, never writes.
> Last updated: 2026-09-12

---

## Doctrine

XENO's ruling, 2026-09-12, and the reason this roadmap is shaped in versions rather than a backlog:

> "We will fix it but not improve it too much, instead doing a full rebuild for v1. We will NOT hesitate to not only refactor, but drag back down to just design documents and rebuild."

So:

- **A version is a throwaway that taught us something.** v0 exists to make the unknowns concrete, not to become v1.
- **Fixes are allowed inside a version. Features are not.** If a want arrives mid-version, it goes to the next version's design doc. No exceptions — that rule is the only thing that keeps a version finishable.
- **Rebuilds start from documents, not from code.** The deliverable that carries forward between versions is `DESIGN.md`, not the repo. The repo is evidence.
- **Dragging back to documents is a normal move.** It is on this roadmap as a first-class transition, not an emergency.

The zero-dependency ruling is what makes this affordable: there is no framework migration cost, so a rebuild is a week of writing rather than a quarter of untangling.

---

## v0 — today

**Goal: a real notes app on the iPhone home screen and in Edge on PC by tonight, with data that persists.**

Not a prototype, not a mock — a thing XENO uses tomorrow morning. Also deliberately small enough to throw away.

**In scope** (XENO's floor, 2026-09-12):

- Editor: block document model, per-block contenteditable, bold/italic/underline/strike, headings, lists, checklists
- Flat floating footer — every styling and whitespace control exposed, nothing behind a menu
- Folders, note list, client-side search, pinning
- Supabase magic-link auth, notes + folders behind RLS, local-first sync with an outbox
- Dual-pane: side-by-side on PC, scroll-snap swipe on phone
- Deployed to GitHub Pages, installed to the iPhone home screen, running standalone

**Out of v0, explicitly:**

- Tables · attachments and images · per-note locking · realtime · offline conflict resolution beyond last-write-wins · the keyboard-up layout (§9 of `DESIGN.md`)

**Done when:** a note typed on the iPhone in standalone mode appears in Edge on memeputer after a focus change, and vice versa.

### Order of work

1. Supabase: run the schema, enable RLS, confirm which magic-link flow the project uses
2. `store.js` + `net.js` + `auth.js` — sign in end to end before any UI
3. Document model + editor engine — the long pole
4. Footer, sidebar, search
5. Panes and swipe
6. Push to Pages, install on both devices, test in standalone

Steps 3 and 5 are independent of 1–2 and can be parallelised across subagents.

### What v0 is really buying

Three answers we cannot get from a document:

- Does the hand-rolled hybrid editor survive **iOS autocorrect and dictation**? (`DESIGN.md` §4 — highest-risk assumption in the project)
- Is last-write-wins sync survivable in daily two-device use, or does it lose an edit in week one?
- Does the flat footer stay usable once every control is actually on it, or does it become a wall?

---

## Drag-back — between v0 and v1

**An explicit phase, not a failure state.** Budget it.

v0 gets used for long enough to generate real complaints, then the project returns to documents:

- Rewrite `DESIGN.md` from what v0 taught, including a "tried and rejected" pass into `STATE.md`
- Settle the **tables** design properly — it is the largest single piece of editor work and it dictates the model
- Settle the **four platform-impossible parity items** (share sheet, scanning, Pencil, deep OS integration): substitute, drop, or reconsider the PWA. Open since 2026-09-11.
- Decide whether the keyboard-up layout is still the right interaction model, now that there is a real app to feel it in

**Gate on v1: no code until those four are written down.**

---

## v1 — full rebuild

Same rulings, same stack, written again from the new documents.

- **Tables** — block-containing-block-arrays, mobile column resize, cell navigation over a virtual keyboard
- **Keyboard-up layout**, properly prototyped in standalone on the real device first
- **Attachments and images** via Supabase Storage, with an upload and thumbnail path
- **Per-block sync and real conflict resolution** — the per-block `id` from v0's model finally earning its place
- **Offline-first** in the real sense, not best-effort
- Recently Deleted, note links, sort options, gallery view
- Per-note locking via passphrase and client-side encryption

---

## v2 — beyond parity

Only after v1 is in daily use.

- Whatever v1's substitutes turn out to be for the impossible four — most likely a Shortcut posting to Supabase in place of the share sheet
- Realtime, if poll-on-focus has proven insufficient rather than assumed so
- Multi-device conflict UI
- The parts of "as well or better" that mean *better*, which has not been specified yet and is the most interesting section of this roadmap

---

## Roadmap risks

| Risk | Where | Response |
|---|---|---|
| Hand-rolled editor loses to iOS autocorrect/IME | v0 §4 | Hybrid input, native typing path. **The thing v0 exists to test.** |
| Keyboard layout turns out unworkable | deferred to v1 | Whole interaction model changes. Cost of finding out late is accepted by XENO, recorded in `DESIGN.md` §9. |
| Last-write-wins loses an edit | v0 §7 | Watch for it in real use; per-block sync in v1 is the fix. |
| Stale service-worker shell | v0 §10 | ⏸ Blocked on XENO's lessons from his existing app. |
| "Full parity" never gets a per-item ruling | drag-back | Gate v1 on it. Open since 2026-09-11. |
