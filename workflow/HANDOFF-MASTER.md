# Master Handoff

> For the Claude Code session that takes over as **master thread**.
> Written 2026-09-11 from a Cowork chat thread that did the initial triage.
> This is the distillation. `TRANSCRIPT.md` is the verbatim source conversation — read it too; they are not redundant.

---

## Your job

Three things, in this order of permanence:

1. **Run the serial conversation** with the operator — triage, re-scoping, deciding what happens next.
2. **Own the universal project board** (`BOARD.md` at repo root). This is the durable state of everything.
3. **Own the per-project handoffs** (`projects/*/STATE.md`), and communicate with each project's own Code session.

The originating thread could only do 1 and 2. It had no `ListAgents` or `SendMessage`. You do — that's why the master role moved to Claude Code.

---

## The repo model

```
workflowpipelines/
├── BOARD.md              ← universal board. Master owns. Single source of truth.
├── HANDOFF-MASTER.md     ← this file
├── TRANSCRIPT.md         ← verbatim source conversation
├── _protocol/
│   ├── PROTOCOL.md       ← rules every thread follows
│   └── STATE-TEMPLATE.md ← copy this when a project starts
└── projects/
    ├── notes-app/STATE.md
    ├── edge-extension/STATE.md
    ├── fancyzones/STATE.md
    └── training-suite/STATE.md
```

Every project thread works in its own folder and **constantly writes its state to that folder's `STATE.md`**. Files are the coordination channel, not messages. Files survive context loss, compaction, session death, and reboots. Messages don't.

Cross-session messaging is a *latency reducer* on top of this, never the record. Cross-session messaging carries a piece of text one Claude writes to another, never conversation history or files. If it matters, it goes in a file first.

---

## Everything decided in the originating conversation

Presented as reasoning, not just conclusions, so you can overturn any of it if the reasoning stops holding.

### The original raw dump

The operator's starting list, verbatim in substance:

- Immediately usable projects
- additive/mod → sidepane → whole panel → A/B replacement suite
- "FIX WINDOWS TASKBAR SUCKS. make way easier, use fancy zones" (2 features: taskbar vfx, zones)
- iOS Notes / Atlas Notes replacement
- Edge improvements extension
- Claude TOS-compliant improvements (queueable messages, universal standards easily editable applying to all chats, design docs/kanbans)
- First-shot learning/training suite — language, English and Spanish

Stated intent: build the **additive/zeroth phase** only — stuff that can be done instantly and improves things immediately.

### The ladder, and how it changed

Operator proposed: Tampermonkey → extension sidepane → own extension page → Electron/custom browser.

Three corrections were made:

1. **Gap between userscript and extension.** Not a smooth upgrade — a rewrite of the plumbing. Tampermonkey gives `GM_setValue`, `GM_xmlhttpRequest`, free cross-origin, no build step, one file. A native extension means manifest, background service worker, `chrome.storage`, message passing, CSP, host permissions. Feature logic survives; everything around it doesn't. **Mitigation: write the userscript adapter-shaped from day one** — logic in plain modules, storage behind `store.get/set`, fetch behind one `request()`. Then porting is swapping two adapters.
2. **Sidepane → own page is barely a step.** Same extension context, same APIs, different surface. Collapsed into one rung: "extension with N surfaces."
3. **Extension → Electron is not a rung, it's a different ladder.** It surrenders in-page context — the DOM and logged-in session that make the whole plan work. **A rung was inserted before it:** extension + local companion (small localhost server/CLI). That's where filesystem, real persistence, sync, and long-running work live without abandoning page context. Most Electron temptation is satisfied here at a fraction of the cost.

Final ladder:

1. Userscript, written adapter-shaped
2. Extension, any number of surfaces
3. **Extension + local companion**
4. Standalone app — only if the app *is* the product

**Rung-3 tell:** if the thing is fundamentally *files*, it wants a local companion. If it lives in a page's DOM and session, it stops at rung 2.

### Zeroth-phase rule

Nothing gets replaced, nothing gets uninstalled. Everything runs alongside the thing it will eventually eat.

### Per-project triage

**Notes app — jumped the ladder, now first.** Originally parked with an additive reframe ("reader/capture layer over existing notes, blocked on the extension"). The operator overruled: they've built many Safari add-to-home-screen web apps before, so it's known territory, and Supabase supplies rung 3's capability. Accepted, with the reasoning recorded: **the ladder is a risk-management tool; it doesn't apply where there's no risk.** Supabase is a *bought* rung 3, not a skipped one.

**Public vs private repo.** Operator initially wanted a private Enterprise GitHub Pages site. Flagged: private-visibility Pages gates the site behind a GitHub session cookie, which conflicts with add-to-home-screen standalone launches and service-worker fetches — fails *after* testing fine in a normal Safari tab. Also flagged that nothing in the client is actually sensitive: it's shell, data sits behind Supabase RLS, and the anon key is designed to be public. **Operator agreed: public.** Escape hatch if that ever changes: Cloudflare Pages or Netlify from a private repo — private source, public site, no auth gate.

**Edge extension — the substrate, not a feature.** One extension that is a sidepane plus a place to drop modules. Every later browser-side idea becomes a module inside it instead of a new project. Was originally first; now second.

**Claude QoL — first module of the extension.** The prize is "universal standards I edit in one place, applied to all chats." TOS-safe design: local prompt-fragment library injected client-side into the composer *before the operator hits send*. Queueing is a local outbox that pastes the next message when they're ready. **Hard line: human in the loop on every send. The moment it fires on a timer, it isn't compliant.** Design docs/kanbans were cut from this project — a different project wearing its coat.

**FancyZones — don't build.** PowerToys already is this. Zeroth phase is a tuned layout set plus a shortcut scheme. An afternoon of config. Save the build budget.

**Taskbar vfx — parked, honestly.** Windows fights this; real mods need injection or a replacement shell, the opposite of additive. Additive reframe: a **hotkey-summoned overlay launcher bar** floating above the taskbar you stop looking at. A genuine project, not a quick one.

**Training suite — not software yet.** Zeroth phase is a prompt pack and card deck usable today. Gate: use the manual version for two weeks before writing code, so the build targets real pain.

### Notes app spec as given

- Feature parity with iOS Notes
- **Side-by-side dual notes** with quick swipe between them
- **Always-floating footer**: every styling and whitespace control exposed flat, nothing behind layers or menus
- **Keyboard-up layout (mobile):** footer sits mid-screen above the keyboard; the text being typed pins to the top of the screen
- Stack: static client on public GitHub Pages + Supabase

Two open flags raised and **not yet resolved by the operator** — get these answered:

1. **"Parity with iOS Notes" is undefined and it's the project's biggest risk.** The visible parts are a weekend: rich text, folders, checklists, pinning, search. The parts that took Apple years: scanning, handwriting/Pencil, table blocks, collaboration, per-note locking, attachment handling, and the share-sheet extension which **cannot be built from a PWA at all**. If parity silently includes those, this stops being one-shot. Ask for three or four things they actually use daily and call that parity. It changes the data model, so settle it before building.
2. **The keyboard layout is the genuinely hard part.** Everything else is ordinary app work; footer-above-keyboard with text pinned to top fights iOS Safari specifically. Needs `visualViewport` — `100vh` lies when the keyboard is up, and standalone mode behaves differently from a tab. **Prototype this layout alone, before any Supabase wiring.** If it can't be made to feel right, the entire interaction model changes and that's worth knowing on day one.

### Capability findings (verified, not recalled)

- **Cross-session messaging is real.** Tools are `ListAgents` and `SendMessage`. Requires Claude Code v2.1.224+ on macOS/Linux including WSL 2; **native Windows requires v2.1.234+**. The operator is on Windows — check `claude --version`. Messaging is on with nothing to enable when a session qualifies.
- **It is Code-session ↔ Code-session only.** A Cowork/chat thread has neither tool. This is why the master role lives in Claude Code.
- **"All cloud" has a wrinkle.** Claude Code on the web runs in Anthropic's sandbox — a fresh container per session. Cross-session messaging is built around a local socket (`CLAUDE_CODE_MESSAGING_SOCKET`, restricted to the OS user). Reaching sessions on other machines or the web goes through Remote Control, which is a **synchronization layer, not cloud computing** — the session runs on the local machine and browser/mobile are windows into it. So "everything in the cloud" and "sessions message each other" pull against each other. **Verify the topology before building workflow on it.** The file-based protocol in this repo is deliberately immune to how that resolves.

### Format decisions

- The board is markdown and stays portable. Markdown has no native columns; an HTML `<table>` with `valign`/`width` attributes (not inline `style=`, which sanitizers strip) gives a two-column dashboard block, with blank lines inside each `<td>` so markdown still parses within. Used once at the top of `BOARD.md` and nowhere else — HTML makes the source meaningfully worse to hand-edit, which is the real cost.
- Convention established by the operator: **conversation is transitory, the markdown is permanent.** Anything settled in chat gets written to a file or it didn't happen.

---

## First actions for you

1. Read `TRANSCRIPT.md`, `_protocol/PROTOCOL.md`, and `BOARD.md`.
2. Notes app: parity is **settled as full parity, tables included** — no cut list. What's still open is substitutes for the four platform-impossible items, and agreement to prototype the keyboard layout before any Supabase wiring. Read that project's Constraints section first.
3. Confirm `claude --version` ≥ 2.1.234 if cross-session messaging on Windows is wanted.
4. Open the notes-app session. It is the first build.
