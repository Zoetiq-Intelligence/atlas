# Atlas merge plan — step 1 (DRAFT, awaiting Gianni's approval)

> Drafted 2026-10-13 by Atlas Core for Atlas Master, per `ATLAS-MASTER-BRIEF.md` → *Order of work* step 1.
> **No code moves until Gianni approves this.** Every feature of the three sources, judged **keep / adapt / drop**.
>
> | Source | Read from | Complete? |
> |---|---|---|
> | **Atlas Core** (Workbench) | `Zoetiq-Intelligence/workflowpipelines` `projects/workbench/` at `eb7c3eb`, and `HANDOFF.md` | ✅ complete |
> | **Atlas Notes** | this repo: `notes/` at `896656e`, `workflow/QUEUE.md`, `workflow/projects/notes-app/*` | ⚠ drafted from the repo only. **`imports/atlas-notes-handoff.md` and `atlas-notes-messages.jsonl` landed on 2026-10-17;** reconcile §B against them. |
> | **Nexa Notes** (ideas only) | `imports/nexa-notes-ideas.md` + `nexa-notes-messages.jsonl` | ✅ **received 2026-10-17**: 64 ideas, `NN-01` to `NN-64`. Judging them in §C is still open. |
>
> Rules from the brief: **Atlas Notes wins every conflict** unless Gianni says otherwise. Nexa Notes contributes UI
> ideas only, one by one, no code merged blindly. **Nothing in Atlas is called Nexa.**

---

## 0. Conflicts to rule on before any code moves

These are where the two built sources disagree. The default (Notes wins) is stated; the cost of the default is stated
so the ruling is informed.

| # | Conflict | Atlas Core | Atlas Notes | Proposed | Why |
|---|---|---|---|---|---|
| 0.1 | **Module system** | classic `<script>`s, `WB` namespace | ES modules | **Adapt Core to ES modules** | Notes wins. Core chose classic scripts only so one folder ran from any server; Atlas always serves over http (Pages, loopback, or the iOS bundle server), so the reason is gone. The AudioWorklet stringify trick still works from a module. |
| 0.2 | **Storage adapter** | `WB.store` (localStorage) + `store.blob` (IndexedDB) | `adapters/store.js` (IndexedDB) | **Adapt Core onto Notes' `store.js`**, add a blob/namespace API if missing | One storage seam for every tool, which is what makes the iOS bundle and the App Group cache one change, not N. |
| 0.3 | **Design tokens / theme** | `tokens.css`, per-pane hue, dark + light | `base.css` tokens | **Notes' tokens are the base; Core's per-Module accent hue added on top** | Notes wins; per-Module hue is additive and is what tells tools apart in the switcher and widget. |
| 0.4 | **Tooltips + motion** | instant tooltips, 150 ms smootherstep, four-way placement avoiding the control | `ui/tooltip.js`, `ui/motion.js` (also instant, 150 ms smootherstep) | **Keep Notes' modules**; port Core's "avoid the whole control" placement if Notes lacks it | Same spec on both sides; one implementation. |
| 0.5 | **Hotkeys** | bare keys: `Space` power, `1–5`, `[ ]`, `L`, `F`, `T`, `N`, `/` | **Space-hold chord = Inputs** over the command registry | **Space = Inputs (Notes), Alt = Systems (new)**; Core's shell keys move under `Alt`; bare letters only inside a focused canvas (Slate) | The brief's "Alt = Systems, Space = Inputs" is not specified anywhere yet — see `HANDOFF.md` §4. Needs Gianni's ruling on the Alt map. |
| 0.6 | **Wheel / scroll model** | app-wide `Detent` + `Spring`, latched ownership | native scroll + `touch-action` (swipe via scroll-snap between panes) | **Keep both, by surface**: Notes' model on touch and inside Notes; Core's Detent/Spring for the PC hub's stage and rail | They solve different inputs. Core's model exists because mouse wheels on a desktop rail; Notes' because fingers on iOS. No conflict once scoped. |
| 0.7 | **Hosting / privacy** | private repo, private Pages (Enterprise), `Workbench.bat` offline | public repo, public Pages `/atlas/`, data behind RLS | **Atlas is public; the hub moves here.** Keep `Workbench.bat`-style offline launch for PC | Notes wins. Nothing in Workbench's client is secret (keys live in browser storage). The PC hub must still never depend on hosting. |
| 0.8 | **Command registry vs `TOOLS`** | `TOOLS` array + `row()`/`widget()` per module | `editor/commands.js` registry with three-way parity enforced at runtime | **Both survive, at two levels**: the **tool registry** (brief) lists tools; each tool keeps a **command registry** in Notes' shape | The parity rule (footer / selection menu / hotkey, red when missing) generalises to every tool's controls. |
| 0.9 | **Tests** | Playwright scripts run ad hoc, **not committed** | committed suite (186 tests), node + Chromium | **Notes' harness**; Core's behaviours get committed tests when they move | Horizon standard: tests silent, never on real data. |

---

## A. Atlas Core (Workbench)

### A1. Hub, shell and navigation

| Feature | Verdict | Reason |
|---|---|---|
| **Module model: Row / Widget / Pane / Full** | **keep** | It *is* the tool registry's view contract. Row → PC rail + iOS tool switcher; Widget → PC dock + (re-drawn natively) WidgetKit page; Pane → the tool's view; Full → the tool alone. |
| `TOOLS` list + `row()` / `widget(host)` per module | **adapt** → the brief's **tool registry** `{id, name, icon, hue, widget view, deep link, PC launch target}` | One list drives PC hub, iOS switcher and widget pages. Add `deepLink` (`atlas://tool/<id>`) and `launch` (own page / own Electron app). |
| Six arrangements (Panes, Dashboard, Column, Studio, Wall, Solo) + picker | **keep (PC only)** | Desktop layout for the lower monitor. Meaningless on a phone. |
| Full + real full screen (`F`, `shift F`) | **keep (PC)**; on iOS every tool is already full | |
| Left rail: hover-open with spatial hysteresis, live Rows, pins/groups dock | **keep (PC)** | |
| Pane stage: sideways travel, left-edge settle, `Detent`/`Spring` | **keep (PC)** | See 0.6. |
| Drag-reorder from headers and rail; `shift [ ]` | **keep (PC)**; order saved in the registry | |
| Per-Module accent hue | **keep** | See 0.3. |
| Two-line floating header with tickers + VU | **adapt** → hub status line fed by each tool's `row()` | Today it hard-codes Soniscape and Cadence. |
| Dark / light theme (`T`) | **keep**, on Notes' tokens | |
| Keyboard map modal (`?`) | **adapt** → generated from the registries + Alt/Space layers | |
| Launch a tool's own page or Electron app | **adapt** (new) | The brief's PC hub must open tools that live elsewhere (Gateway, Gyrodex). Today every Workbench tool is in-page. |

### A2. Hosts

| Feature | Verdict | Reason |
|---|---|---|
| Electron shell (`electron/main.js`): loopback server, fenced `<webview>` partition, plain user agent, popups to the OS browser | **keep** as the PC host | The brief's PC app. The webview fence is the permission model's first piece. |
| `Workbench.bat` (Electron → Node → PowerShell, no install) | **keep**, renamed for Atlas | The hub must never depend on a hosting plan (Pages broke twice on billing). |
| Private Pages on `workflowpipelines` + `_config.yml` + root redirect | **drop** after the move | Atlas serves from this repo's public Pages. Leave a redirect at the old URL for a while. |
| `.github/workflows/pages.yml` (dispatch-only) | **drop** | Atlas uses branch deploy from `main`. |

### A3. Tools

| Tool | Verdict | PC | iOS | Reason |
|---|---|---|---|---|
| **Soniscape** | **keep** | as is | **later**, needs a native audio session | WKWebView can run an AudioWorklet, but sound that keeps playing when locked or backgrounded needs `AVAudioSession` in the shell — a new bridge call. |
| **Cadence** | **keep** | as is | **early widget candidate** | A countdown ring is the most widget-shaped thing Atlas has. Alarms that fire while closed need native local notifications (bridge call); the web version cannot. |
| **Quarry** | **keep (PC)** / **adapt (iOS)** | Electron webviews, automation | open the search in Safari / `SFSafariViewController`; history + tree + pins kept | iOS cannot host fenced webviews that script DeepSeek. The tree and history are the portable part. |
| **Slate** v1 | **keep** | as is | iPad later | The Huion is the PC's pen. Note `workflow/projects/whiteboard/FINDINGS.md`: Canvas 2D will not scale past a few thousand strokes; a GPU renderer is the v2 path. |
| **Slate drafts** (Paper, Map, Notebook, Flipbook) | **keep as A/B options** pending Gianni's pick | | | Hooks over one core, so any can merge. |
| Slate's stroke engine → **Notes' drawing block** | **adapt** (proposal) | | | Notes' `QUEUE.md` item 9 asks for drawings with three takes A/B/C. Slate's pressure-stroke model, outline, SVG export and stabiliser are a ready "take". The forward-compat blocker in `coerce()` is cleared (2026-10-17, `7b1e64a`). |
| **Drafting board** (dashed idea panes + status/notes footer) | **adapt** → an **Ideas** Module | | | Keep "one pane per idea"; statuses could feed Horizon's tasks instead of browser storage. |
| **Scratch** (capture an idea into a pane) | **keep** inside Ideas | | | |
| Draft **Cue** (Spotify + YouTube queue) | **keep as idea** | | | Blocked on: Spotify Premium? |
| Draft **Margin** (pane view of the Notes app) | **drop** | | | Superseded: Notes *is* an Atlas Module now. |
| Draft **Chorus** (Featherless 12-lens chat + Murmur) | **keep as idea** | | | Key from Horizon → Connections, never in the repo. Build questions still open. |
| Draft **Tally** (invoicing from Cadence's day log) | **keep as idea** | | | Depends on Cadence's day log, which moves with Cadence. |
| Draft **Stash** (snippet vault), **Rosetta** (unit-aware calculator) | **keep as ideas** | | | |
| Gateway dashboard, Gyrodex | **add as Modules** (launch target or embedded) | | | Queued questions, now answerable by Atlas Master (`F:\gyrodex`, Horizon). |

### A4. Widgets (Core's `widget(host)` views)

| Widget | Verdict | Reason |
|---|---|---|
| Cadence ring + start/pause + `+5m` `+25m` | **adapt → WidgetKit page** | iOS widgets are SwiftUI, not HTML. Keep the *content* (what the ring shows, which two actions) and redraw natively from the App Group cache. Buttons become AppIntents. |
| Soniscape power + layer toggles + meters | **adapt → WidgetKit page** later | Meters cannot be live in a widget (timeline refresh, not frames); show state only. |
| Quarry box + last four searches | **adapt** | A widget cannot take text input; tap opens `atlas://tool/quarry`. |
| Slate board thumbnail | **adapt** | Snapshot image written to the App Group by the app. |
| Notes widget (pinned / recent / quick add) | **new, first** (brief) | Not in Core; Core's widget shape (header + glanceable body + ≤2 actions, per `TIERS.md` T1) is the template. |

### A5. Platform pieces

| Feature | Verdict | Reason |
|---|---|---|
| `TIERS.md` (T0 core … T5 guest) | **keep** as the design basis | It already says what the brief requires: a headless core per tool so Widget, Pane and Full share one state. Its own finding — no Workbench tool has a headless core yet — is the main refactor. |
| `defs.js` as single source of truth | **keep** | |
| Ctrl+. / ✎ feedback (Horizon F1–F14) | **add** | Workbench has none. Notes may already; reuse its implementation. |
| Versions per F8 | **add** | Workbench shows no version. |

---

## B. Atlas Notes (wins conflicts) — from the repo; reconcile with its handoff

| Feature | Verdict | Reason |
|---|---|---|
| Block document model (`jsonb` block array, `coerce()`) | **keep** | Core of the product. ✅ `coerce()` now keeps unknown block types whole and read-only (2026-10-17, `7b1e64a`), so new block types (drawings, tables) are unblocked. |
| Per-block contenteditable editor, hybrid input (native typing, intercepted structure) | **keep** | Protects iOS autocorrect, dictation, IME — matters even more in the native shell. |
| Dual panes, gutter, edge-swipe, one SPA header | **keep** | |
| Always-floating footer, flat, every control exposed | **keep** | |
| Command registry, three-way parity (footer / selection menu / hotkeys), red when a surface is missing | **keep**, and **generalise to every Module** | See 0.8. |
| Space hold-chord hotkeys (`1234 qwer asdf zxcv 5tgb`) | **keep** = the "Space = Inputs" layer | Latched double-tap mode stays unbuilt (typing risk). |
| Keyboard-up layout via `visualViewport` | **adapt for WKWebView** | The native shell gets real keyboard frames (`keyboardWillShow`); feed them to `layout.js` through the bridge instead of inferring them. Web path unchanged. |
| Safe-area insets read once into custom properties | **keep** | Same in WKWebView. |
| Device truth kit (5 taps on the build id) | **keep**, extend with native fields | Bundle id/version, OTA manifest hash, App Group status. |
| Email-code sign-in (GoTrue REST, no supabase-js) | **keep** | The installed-app storage isolation that forced the 6-digit code applies to WKWebView too. |
| Supabase personal project, `notes` schema, RLS | **keep** | Brief: personal project only. |
| Local-first outbox sync + 5 s pull + live sync (broadcast-from-database) | **keep** | |
| Snapshot backups every 6 h + restore | **keep** | Confirm `SETUP-BACKUP.sql` has been run. |
| Folders, sidebar search, Recently Deleted (soft delete) | **keep** | |
| Importer (iOS Notes export, `.atlasnote.json`, with the coverage-proof rule) and `tools/merge-notes.mjs` | **keep** | Landed in `896656e`; the "refuse unless every line survives" rule is a good Atlas-wide standard. |
| Service worker + idle-gated update + `update()` on foreground + content-hashed cache | **keep for web**; **replace on iOS** with the signed OTA loader | In the native app the bundle is local and swapped atomically by the shell; a SW inside it would be a second, competing update path. |
| `reset/` page outside the worker scope | **keep for web** | iOS equivalent: the shell's roll-back-within-10 s. |
| Hub `index.html` (deliberately not installable) | **adapt** → the Atlas PC hub's web entry | Workbench's shell moves here. |
| Open queue items (in-note + global search, fast line drag on phone, custom context menu, send-to-pane buttons/swipe, note pairing, drawings A/B/C) | **keep, unchanged in priority** | Notes' backlog is Notes' to order. Pairing (item 11) is still unconfirmed. |

---

## C. Nexa Notes (UI ideas only): **received, not yet judged**

`imports/nexa-notes-ideas.md` (64 ideas, `NN-01` to `NN-64`) and `imports/nexa-notes-messages.jsonl` landed on
2026-10-17. Next: list every idea here, one row each, with keep / adapt / drop and the A/B plan (brief step 5: each adopted idea
must be A/B-able).

---

## D. First registry entries (proposal)

| id | name | widget page | deep link | PC launch |
|---|---|---|---|---|
| `notes` | Notes | pinned / recent / quick add (**default page**) | `atlas://notes/<noteId>` | in hub |
| `cadence` | Cadence | next deadline ring, pause | `atlas://tool/cadence` | in hub |
| `soniscape` | Soniscape | playing / stop | `atlas://tool/soniscape` | in hub |
| `quarry` | Quarry | recent searches (tap to open) | `atlas://tool/quarry` | in hub (Electron webviews) |
| `slate` | Slate | board snapshot | `atlas://tool/slate` | in hub |
| `ideas` | Ideas | counts by status | `atlas://tool/ideas` | in hub |
| `gateway` | Gateway | tbd | tbd | external page / app |
| `gyrodex` | Gyrodex | tbd | tbd | external page / app |

## E. Questions for Gianni before step 2

1. Approve §0's rulings, especially **0.1 (ES modules)**, **0.5 (the Alt = Systems map)** and **0.7 (Workbench moves to
   the public repo)**.
2. Which Slate draft(s) to keep — and is Slate's engine the take for Notes' drawing block?
3. Gateway and Gyrodex: embed, or launch?
4. ~~The Nexa Notes inventory and Atlas Notes' handoff~~: both landed on 2026-10-17.
