# Open queue — everything asked for and not yet delivered

> Master owns this file. Updated 2026-09-17.
> Ruling 2026-09-17: **keep iterating, no design-doc rebuild, until critical mass.**
> Ruling 2026-09-18: **master works directly on `main`; every push deploys.** The
> successor session can push (handoff §3.1 resolved), so a feature branch only adds a
> merge step between a fix and the operator's phone. Consequence accepted and stated:
> a bad push reaches the device, so the full suite runs before every push.
> Operator's exact wording is preserved where the wording carries the requirement.

| # | Item | Status | Notes |
|---|---|---|---|
| 0 | **Backups every 6h + revert** | **built 2026-09-18; needs the SQL run** | Asked for 09-18. Server-side snapshots via `notes.take_snapshot`, `notes.restore_snapshot`. Client asks; Postgres builds the snapshot. SQL in `_protocol/SETUP-BACKUP.sql` — **not yet run on the project**, so the feature is inert until it is. |
| 1 | **Live sync, sub-1s** | designed, researched, **not built** | Broadcast-from-database, not `postgres_changes`. Full wire protocol in `projects/notes-app/REALTIME-FINDINGS.md`. Reasoning in `HANDOFF-2026-09-17.md` §6. |
| 1b | **One SPA header** | **built 2026-09-18** | Replaced both per-pane headers. Title segments are sized to the divider's fraction so each sits above its pane, and double as the pane switcher; list / sync / new note are global and live there once. |
| 1c | **Same note in both panes mirrors** | **fixed 2026-09-18** | Was a data-loss bug, not a display one: only the title mirrored, so the second pane's next save wrote its stale doc back over the edit. No network involved. |
| 1d | **A visible app now pulls** | **fixed 2026-09-18** | `pull()` ran only on foreground/`online`, and the 20s interval flushed writes without ever reading. Two devices both open never saw each other. Now polls at 5s AND reports which ids changed, because writing to IndexedDB is not the same as reaching the screen — nothing re-read the store. This is the floor under live sync, not a substitute for it. |
| 2 | **Search** — "within note that's open, and then global" | not started | Only the sidebar filters today, client-side. |
| 3 | **Drag-and-drop line reordering** — "in a way that is fast on phone" | not started | |
| 4 | **Footer restructure** | not started | "every single thing that we can do should be in the footer somehow, minimize the number of layers and always indicate on a button how many things are within it in a subtle way somehow". Plus new styles, plus deciding what is static and what scrolls. |
| 5 | **Hotkeys, Spacebar as modifier** | designed, accepted in principle | Key groups: `1234` `qwer` `asdf` `zxcv` `5tgb`. Proposal below. |
| 6 | **Custom context menu** | ruled, not built | **Windows: suppress the native menu.** **iOS: supplement rather than replace, spaced to avoid colliding with the system callout.** |
| 7 | **Tooltips on every button, instant** | not started | No hover delay. |
| 8 | **150ms smootherstep transitions everywhere** | **built 2026-09-18** | Tooltip fades, scrolling transport, all animations. Smootherstep is `6t⁵ − 15t⁴ + 10t³`; in CSS use `linear()` with sampled points, or a `cubic-bezier` approximation. |

---

## ⚠ 2026-09-18 — items 4, 5, 6 and 7 are ONE feature, not four

Operator, verbatim:

> what im not seeing is the three-way parity between footer buttons, selection menu
> (not right click; just when we select), and hotkeys (shown as instant tooltips in the
> footer) for EVERY function we can do to control inputs.

This is a scope ruling, and it changes the architecture rather than the backlog order.
Footer buttons, the selection menu and the keymap are three **surfaces over one command
registry** — not three features that happen to overlap. Every input-control command is
declared once with its id, label, icon, key, and applicability predicate; each surface
renders from that list. Parity then holds *by construction*, and the failure mode being
complained about — a thing you can do in one place and not another — becomes
unrepresentable rather than a thing to keep checking.

Consequences worth stating before it is built:

- The footer tooltip shows the command's key, so the keymap documents itself and item 7
  (instant tooltips) is a property of the registry rather than separate work.
- The selection menu is **selection-triggered, not right-click** — it appears when text
  is selected. Item 6's ruling still holds for the *context* menu (suppress the native
  one on Windows, supplement on iOS); this is a different surface from that one.
- A command with no key still appears in all three surfaces; a key with no command is a
  build error the registry can catch.
- "EVERY function we can do to control inputs" is the acceptance test, so the registry
  needs a completeness assertion, not a spot check.

## Item 9 — drawings, v1, three takes A/B/C

Asked 2026-09-18: *"can we put in a V1 of being able to insert drawings? I want 3
different takes that I can A/B/C test inline (without breakign the rest of the app/notes
data!) and then we will iterate."*

**⚠ BLOCKER, found before any code: the document model currently destroys what it does
not recognise.** `doc.js coerce()` does two things that make a drawing block unsafe today:

1. `.filter(b => b && typeof b.text === 'string')` — a block with no `text` is **dropped**.
2. It rebuilds each block from a fixed field list, so **any field it does not know about
   is discarded**, and an unknown `t` is rewritten to `'p'`.

So a drawing inserted today would survive only until any build opened the note — including
the current one. **Forward-compatibility must land, deploy, and reach BOTH devices before
the first drawing block is ever created**, or a device still running an older build will
silently strip drawings out of notes it syncs. That makes the stale-build problem a data
hazard, not a cosmetic one.

Plan: one `draw` block type carrying `{variant: 'a'|'b'|'c', data}`, so all three takes
share a single schema and A/B/C is a per-drawing choice, inline, with no branching in the
storage layer. Proposed takes — raster canvas, vector stroke list, pressure-width ribbon —
to be confirmed when the work starts.

## Item 5 — the Spacebar scheme, as proposed and accepted in principle

**The hard part:** space is a printing character, and at speed keystrokes overlap. Type
"a b" quickly and space-down/b-down interleave, so naive chording fires a command
instead of typing a space — which feels like data loss in a notes app.

**Build both, sharing one keymap:**

- **Hold-chord, for speed.** Space-down does not insert. If another key arrives *and*
  space has been held past a dwell threshold (~90ms) *and* no other key was already
  down, it is a chord. Otherwise it is a space, inserted on keyup — imperceptible for a
  single character.
- **Double-tap space = latched command mode**, for the same keys. Robust and
  discoverable; exits on action, Escape, or timeout.

**Rows map to categories, which is what makes 19 keys memorable:**

| Row | Category |
|---|---|
| `1234` | Block type — title / heading / subheading / body |
| `qwer` | Lists — bullet / numbered / checklist / quote |
| `asdf` | Inline — bold / italic / underline / strike |
| `zxcv` | Structure — outdent / indent / code / (spare) |
| `5tgb` | Actions — search / reorder / move / more |

All left-hand, right thumb on space. Category is the row; item is the position.

Mobile has no chord, so the same 19 actions must be complete in the footer and the
custom context menu.

---

## Item 6 — the cost that needs deciding before building

Suppressing the native context menu on **iOS** also kills the system selection callout —
copy, paste, select-all, look-up, and the selection handles. The 09-17 ruling avoids this
by supplementing rather than replacing. **Windows has no equivalent cost**, so full
suppression there is settled.

---

## Owed but not asked for

- **Q1, open since 2026-09-11.** The four platform-impossible parity items — share sheet, document scanning, Apple Pencil, deep OS integration — still have no per-item ruling. `ROADMAP.md` makes this the v1 gate.
- **Q3.** The keyboard-up layout was deferred from v0 and then largely delivered in v1.5 via `visualViewport`. Nobody has confirmed whether it now meets the original spec — footer mid-screen above the keyboard, active text pinned to the top. **Needs the device; only the operator can answer.**
- **The device truth kit has never been run.** Five taps on the build id in the sidebar. No report has ever been pasted back. `ONESHOT-WEBAPP.md` §0 says no layout claim should be trusted without one, and every layout claim in this project is currently Chromium's opinion.
- **`BOARD.md` is fiction on one row.** The attached project doc describes "Omicron Alpha" as a shipped MV3 extension with a gateway, Supabase schema, dashboard and 27 passing tests, while the board still lists the Edge extension as *"not started."* Either that project moved far past what the board records, or it is a fifth project the board has never heard of. **Raised 2026-09-13; never answered. Ask again.**
