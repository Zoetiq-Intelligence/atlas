# Atlas Master: the brief (from Horizon, 2026-10-13)

Gianni is promoting Atlas to a Master thread on the Workstation: **"Atlas Master"**, folder `F:\atlas`
(repo Zoetiq-Intelligence/atlas). Read this first, then, in order (all three handoffs landed by 2026-10-17):
1. `workflow/HANDOFF.md` (Atlas Core / Workbench handoff) and `workflow/MERGE-PLAN.md` (draft; 9 conflicts for Gianni)
2. `workflow/imports/atlas-notes-handoff.md` (Notes: what's live, data model, sign-in, 322 tests, open items) and
   `tools/note-push.mjs`
3. `workflow/imports/nexa-notes-ideas.md` (64 UI ideas)
4. Your triage history: 81 of Gianni's messages from the three old sessions are filed as `atlas` records (retro).
   Notes wins conflicts. None of Gianni's notes ever go in the repo.

Open at handoff (from Atlas Notes): import "🥤Today (OLD)" and build the merged "☀️🌞⛅️ New Day" (§6); merge in what he
added to iOS New Day since 10-13 once all three are usable (§6b); drop the leftover `notes._import_lines` (holds note
text); the backups SQL (`workflow/_protocol/SETUP-BACKUP.sql`) only after asking Gianni; next build = the style loop
(§7.3).

Older background: `workflow/HANDOFF-MASTER.md`, `RESUME.md` and the notes code.

## What Atlas becomes

**Atlas is the one app that hosts all of Gianni's Tools.** On PC it's the dashboard that opens every tool or launches
each tool's own page or Electron app (what Workbench did). On iOS it's one native app, **widget first**: Notes first,
because that's what Gianni is working on most urgently.

Three threads hold the parts. You merge them:

| Source | What it is | What you take |
|---|---|---|
| **Atlas Core** (cloud session, was "Atlas Workbench"; the thread being promoted) | Workbench: one dashboard on PC to reach every tool or launch its own page/app; Console's hotkey plans (Alt = Systems, Space = Inputs) | The hub, the launcher, the tool registry, the hotkey layer |
| **Atlas Notes** (cloud session) | The Notes app Gianni uses today: `notes/` here, v1.5, Supabase personal (`notes` schema), email-code sign-in | The product as it stands. It wins every conflict unless Gianni says otherwise |
| **Nexa Notes** (claude.ai chat; old name, before "Nexa" moved to the unit-swarm architecture) | An earlier single-file rich-text notes app (repo xenovigor/nexa) | Its UI ideas only, listed and judged one by one. No code is merged blindly |

**"Nexa" is now taken.** It names Horizon's swarm architecture. Nothing in Atlas is called Nexa any more.

## The iOS app (native; Horizon's pattern)

**Shell and updates.** A thin native shell (Swift, WKWebView) plus a **signed web bundle that updates over the air**.
The code lives on the device and changes only when Horizon publishes a new signed bundle; it never runs from the cloud.
Gyrodex Companion is the working reference: copy its loader and bridge, and read its lessons first (F:\gyrodex
`ios/companion`, `docs/companion-handoff.md`):
- download into a `.part` folder; verify every file's sha256 against an ed25519-signed manifest; swap atomically;
- `ota.ready` only after a layout check passes; otherwise roll back within 10 s;
- critical CSS inlined;
- bridge calls are additive forever;
- generic pass-through calls and every native error raised as events, so most changes never need a native build.

**Signing and hosting.** Horizon hosts and signs bundles (`F:\horizon\gate\sites_publish.py`, a `sign:` site entry
with your own key). The native build goes to apps.horizongate.io. Today that's SideStore: Gianni's last free slot is
reserved for Atlas. Soon it will be Ad-Hoc on the paid developer account (see Horizon's
`research/gateway/NATIVE-APPS-PLAN.md`).

**The widget is the front door.**
- **Swiping between tools:** WidgetKit has no swipe gestures inside one widget, so this takes two native mechanisms:
  - a **Smart Stack** of Atlas widgets, one per tool, which Gianni swipes vertically;
  - **‹ › buttons** (interactive widget, AppIntents) inside the big widget to page through tools.
- **Tapping:** opens that part of the app: `atlas://tool/<id>`, and `atlas://notes/<noteId>` for one note.
- **Notes first:** the default page is Notes (pinned or recent notes, quick add).
- **Data:** widgets read a small App Group cache that the app writes; they never fetch the network themselves.
- **App icon:** there is one too. It opens the last tool used.

**Tool registry.** One list (id, name, icon, widget view, deep link, PC launch target) drives the PC hub, the iOS app's
tool switcher and the widget pages, so adding a tool means adding one entry.

## Horizon standards (non-negotiable)

- **Universal App Protocol F1-F14:**
  - Ctrl+. / ✎ feedback goes into Supabase `feedback` (app `atlas`) and is triaged by Horizon.
  - Only Gianni's signed-in dev feedback wakes threads.
  - Every close carries a Learning (`triage.py state ... --learning --scope`).
  - Versions follow F8.
- **Repos carry code only:** no keys. Keys are filled at deploy from Horizon -> Connections.
- **Supabase:** personal project only. WORK is Formwork's alone.
- **Inventory:** every new repo, Worker, table, bucket or key gets one line for Horizon's INFRA-INVENTORY (message
  Horizon Master).
- **Pages:** live in Dash or in the app, never as claude.ai artifacts.
- **Tests:** never visible or audible, and never touch Gianni's real data.

## Order of work

1. **Inventory and merge plan** (`workflow/MERGE-PLAN.md`): every feature of the three sources, with keep / adapt /
   drop and the reason. Gianni approves before code moves.
2. **Tool registry + PC hub** (Workbench into Atlas).
3. **iOS shell** with Notes as the first bundle and a signed OTA site. Installed through SideStore's last slot.
4. **Widget:** the Notes page first, then the tool pages.
5. **Nexa Notes UI ideas** adopted one by one, each one A/B-able.
