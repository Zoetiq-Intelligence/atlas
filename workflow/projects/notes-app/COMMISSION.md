# Notes app — COMMISSION

> Written by master (`claude-a2`) 2026-09-13, per `_protocol/COORDINATION.md`.
> Committed **before** the thread opens. This is the handoff; the conversation
> that opens the thread is not.

---

## You are the notes-app project thread

You own `projects/notes-app/STATE.md` from the moment you accept this. Master
stops writing it. You never edit `BOARD.md` or `_protocol/*` — you raise to
master instead.

**Read in this order:** `_protocol/PROTOCOL.md`, `_protocol/COORDINATION.md`,
this file, then `DESIGN.md`, `ROADMAP.md`, `STATE.md`. Then the app repo.

## What you inherit — already working, not a shopping list

Master built the bootstrap, which is the part that was cheapest to do once by
whoever held the whole design. You inherit something that runs.

- **The app repo**, ~1,800 lines across 32 files, zero dependencies, no build step.
- **The document model** (`js/model/doc.js`) — block array as `jsonb`, never HTML.
  26 passing node tests.
- **The editor engine** (`js/editor/`) — per-block contenteditable with hybrid
  input. 17 passing Chromium tests covering typing, Enter, mid-text split,
  Backspace-at-boundary merge, bold, mark reconciliation, checklist toggle,
  demote-before-merge, undo and cross-block arrow navigation.
- **Auth, sync and API** over plain fetch. 23 passing Chromium tests including the
  real magic-link return path.
- **UI** — dual panes, gutter + edge-swipe switching, flat two-row footer,
  slide-over list with folders and search, light and dark.
- **Supabase** with the schema applied and RLS on, and **GitHub** with Pages
  configured. Master holds the credentials; see `_protocol/SETUP.md`.

You should not need to create an account, a repo, a database or a token. **If you
do, the commission was incomplete — raise it to master rather than provisioning
anything yourself.**

## Your job

**Prove the engine.** That is what v0 exists for. Three questions no document can
answer, in priority order:

1. **Does the hybrid input layer survive iOS autocorrect, dictation and
   predictive text on a real iPhone?** This is the single highest-risk assumption
   in the project. It passes in Chromium; Chromium is not the target. Test it in
   standalone mode on the home screen, not in a Safari tab.
2. **Is last-write-wins survivable in daily two-device use**, or does it lose an
   edit in week one?
3. **Does the flat footer stay usable** now that every control is actually on it,
   or is it a wall?

Then: use it daily, fix what breaks, and **write down what you learn** — the
"Tried and rejected" section of `STATE.md` is the most valuable thing you produce,
because it is what stops the v1 rebuild repeating your week.

## Rules specific to this project

- **Fixes, not features.** v0 is disposable. A want that arrives mid-version goes
  into the v1 design document, not into v0. This rule is the only thing that makes
  a version finishable.
- **Do not refactor v0 into v1.** `ROADMAP.md` has an explicit drag-back phase:
  the project returns to documents and is rebuilt. That is the plan, not a failure.
- **Zero dependencies is absolute.** No npm, no bundler, no library, including
  `supabase-js`. If you find yourself wanting one, that is a finding to record and
  raise, not a decision to make.
- **Three seams must stay clean**, because they are what make the rebuild cheap:
  `adapters/store.js`, `adapters/net.js`, and `ui/layout.js`. Nothing else may
  touch IndexedDB, `fetch`, or viewport math.

## Escalate to master when

Scope changes · a rung is skipped · another project is affected · the project
should be parked · you need infrastructure or a credential · the zero-dependency
ruling is in question.

You own scope **inside** this brief — sequencing, what to fix first, what to cut
from v0. You do not rule on scope **of** the brief. Master writes the outcome to
`BOARD.md`, you write it to `STATE.md`. Both, or it did not happen.

## Known open, inherited

- **Q3 — was deferring the keyboard-up layout intended?** Unanswered. `ui/layout.js`
  is built so enabling it is a one-function change, but v0 will not prove the
  interaction model and that risk is accepted rather than removed.
- **Q1 — the four platform-impossible parity items** (share sheet, scanning,
  Pencil, deep OS integration) have no per-item ruling. Open since 2026-09-11.
  Not a v0 blocker; it is the **v1 gate**.
- **The service worker and PWA update strategy** is unwritten, pending XENO's
  lessons from his existing add-to-home-screen app. `DESIGN.md` §10 is the stub.
  Do not invent one before those arrive — a stale cached shell is the top failure
  mode of this stack.
