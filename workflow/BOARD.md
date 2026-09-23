# Project Board

> Master thread owns this file. Project threads read it and raise changes to master; they never edit it.
> Per-project detail lives in `projects/*/STATE.md`.

> Permanent record. Chat is transitory; this file is the state.
> Last updated: 2026-09-23 · Master: successor cloud session (has GitHub write access)
> Coordination topology: see `_protocol/COORDINATION.md` — it supersedes the capability findings in `HANDOFF-MASTER.md`.

---

<table>
<tr>
<td valign="top" width="50%">

### Build order

1. Edge extension shell
2. Claude standards-injector
3. FancyZones config
4. Training pack (manual)

</td>
<td valign="top" width="50%">

### The ladder

1. Userscript
2. Extension
3. + local companion
4. Standalone app

</td>
</tr>
</table>

---

## Operating Rules

**The ladder** (nothing skips a rung):

1. **Userscript** (Tampermonkey) — written adapter-shaped, see below
2. **Extension** — any number of surfaces (sidepane, full page, popup)
3. **Extension + local companion** — localhost server/CLI for filesystem, persistence, long-running work
4. **Standalone app** — only if the app *is* the product

**Adapter-shaped rule:** from day one, logic lives in plain modules. All storage behind `store.get/set`. All network behind one `request()`. Porting userscript → extension then means swapping two adapters, not untangling everything.

**Zeroth-phase rule:** nothing gets replaced, nothing gets uninstalled. Everything runs alongside the thing it will eventually eat.

**Rung-3 tell:** if the thing is fundamentally *files*, it wants a local companion. If it lives in a web page's DOM and session, it stops at rung 2.

**Electron warning:** rung 4 is a different ladder, not a step. It trades away in-page context — the thing that makes this whole plan work.

---

## Active

### 5. Notes app — **BUILD FIRST, AHEAD OF #1**
Skips the ladder deliberately: known territory (done many Safari add-to-home-screen web apps before), and Supabase *buys* rung 3 rather than skipping it.

- **Stack:** static client on GitHub Pages (**public repo**) + Supabase
- **Public, not private** — client is shell only, data sits behind RLS, anon key is designed to be public. Private Pages gates the site behind a GitHub session cookie, which breaks add-to-home-screen standalone launches. Going public removes the problem entirely.
- Escape hatch if anything ever needs to be private: Cloudflare Pages / Netlify from a private repo — private source, public site, no auth gate.

**Scope:**
- **Full parity with iOS Notes, tables included** — as well or better on every point. Four items are platform-impossible from a PWA (share sheet, scanning, Pencil, deep OS integration); substitutes needed. See `projects/notes-app/STATE.md`.
- **Side-by-side dual notes** with quick swipe between them
- **Always-floating footer**: every styling / whitespace control exposed flat, nothing behind layers or menus
- **Keyboard-up layout (mobile):** footer sits mid-screen above the keyboard; the text being typed pins to the top of the screen — ⚠️ **deferred out of v0**, see below

**v0 — shipping today.** Design settled 2026-09-12: `projects/notes-app/DESIGN.md` and `ROADMAP.md`.

- **Absolute zero dependencies** — no npm, no build, no bundler, no `supabase-js`. Hand-written ES modules; Supabase by plain `fetch`.
- **Document model decided:** block array as `jsonb`, not HTML. Closes the "decide before anything is stored" gate; a v1 table is a recursion of this model rather than a parser.
- **v0 floor:** editor + flat floating footer · Supabase sync, folders, search · dual-pane swipe. Tables, attachments, locking, realtime are v1.
- ⚠️ **Keyboard-up layout deferred by the operator.** Consequence recorded: v0 will not prove the interaction model, which `STATE.md` has called the day-one gate since 2026-09-11. Mitigated by routing all positioning through one function, so enabling it is a one-function change. Risk accepted, not eliminated.
- **v0 is disposable. v1 is a rebuild from documents**, not a refactor of v0.

**v1.5 — LIVE since 2026-09-16.** Installed on the operator's iPhone home screen and in Edge on PC, signed in, syncing. `https://zoetiq-intelligence.github.io/atlas/notes/`

- Built against `_protocol/ONESHOT-WEBAPP.md`, the working guide derived from the operator's 181-lesson iOS field document. 162 tests.
- The keyboard-up layout, deferred from v0, is largely delivered via `visualViewport`. **Unconfirmed against the original spec — needs the device.**
- Sign-in on the phone is an **OTP code, not a magic link**: iOS gives a home-screen app storage separate from Safari, so a link signs in the browser and leaves the installed app locked out forever. The Magic Link email template must keep `{{ .Token }}`.
- ⚠ **2026-09-17: the app could not update itself for four days.** `isBusy()` counted the caret being in the editor as busy, and a notes app focuses its editor at boot. Fixed, with four regression assertions. See `HANDOFF-2026-09-17.md` §5.1b.

- **2026-09-18 — snapshot backups added.** Every six hours while an instance is open, plus a manual button and a revert UI in the sidebar. **Inert until `_protocol/SETUP-BACKUP.sql` is run on the Supabase project.**
- Status: **live and in daily use. Open work is tracked in `QUEUE.md`.**

---

## Active

### 1. Edge extension shell
Not a feature, a substrate. One extension that is a sidepane + a place to drop modules. Every later browser-side idea becomes a module inside it rather than a new project.

- Rung: 1 → 2
- Where: Claude Code (real repo, manifest, build step)
- Status: not started

### 2. Claude standards-injector — **FIRST MODULE OF #1**
The prize is "universal standards I edit in one place, applied to all chats."

- TOS-safe design: local prompt-fragment library, injected client-side into the composer **before I hit send**
- Queueing: local outbox that pastes the next message when I'm ready
- **Hard line:** human in the loop on every send. The moment it fires on a timer, it isn't compliant.
- Ends at rung 2, probably forever
- Status: not started

### 3. FancyZones config
Don't build. PowerToys already is this. Zeroth phase = tuned layout set + shortcut scheme, one afternoon.

- Where: separate Cowork thread (artifact, not code)
- Status: not started

### 4. Training suite — manual version
First-shot learning/training, English + Spanish. Zeroth phase is **not software**: a prompt pack + card deck usable today.

- Gate: use the manual version two weeks before writing any code, so the build targets real pain
- Where: separate Cowork thread (artifact, not code)
- Status: not started

---

### 6. Whiteboard — infinite canvas
Raised 2026-09-13. Whiteboarding, mindmapping, diagramming for tablets and graphics displays, stylus and mouse. **v0 is whiteboarding only.**

- **v0 bounds (operator ruling):** zoom 1/64x–64x, ~1,000,000 pages wide, simultaneous users
- **Settled by research before any build:** those bounds need 2.56e11 of dynamic range; float64 gives 9.0e15 — a **35,184x margin**. No exotic coordinate machinery is justified at v0.
- **The one hard requirement:** float32 is short of v0's needs by **15,259x**, and f32 is the permanent ceiling on both WebGL2 and WebGPU (WGSL has no f64; the spec issue has been open and unscheduled since 2022, blocked partly because Metal lacks native float64). **World coordinates can never reach the GPU.** Camera-relative rebasing in float64 on the CPU is mandatory from the first commit, not an optimisation.
- **Truly-infinite is deferred but costs nothing to preserve.** The renderer only ever sees camera-relative deltas, so absolute coordinates are a storage concern. One function — `worldToCamera()` — is the entire seam. Build it and nested frames, tile-local integers, shaders and 3D all stay reachable without a rewrite.
- **Concurrent ink needs no conflict resolution.** Strokes are immutable once drawn, so the stroke set is a grow-only set — trivially a CRDT. Erase is an LWW tombstone, z-order a fractional index. No CRDT library is justified. Figma, tldraw and Excalidraw all avoid real CRDTs the same way: a centralised ordering point.
- For calibration, v0's 4096:1 zoom range is **wider than every shipping competitor** — tldraw 160:1, Excalidraw 300:1, Miro 400:1. Nobody ships truly infinite; Figma states in writing that its canvas is bounded.
- Full research with citations and non-verifications: `projects/whiteboard/FINDINGS.md`

- Rung: 0 → 2 · **The ladder applies here.** Unlike the notes app this is not known territory.
- Status: not started. **Blocked on master for build order** — it must not jump the notes app — **and for the zero-dependency ruling**, which is the single largest scope lever on the project.

---

### 7. Hotkey atlas — the LAlt / Space split
Raised 2026-09-23, verbatim:

> btw we will be integrating another system that controls my PC Workflows (with things
> like Fancyzones, AHK, etc.) that I already have - all of its hotkeys are using LAlt.
> so we will need a general hotkey interface that lets us see what Windows uses, what
> other apps already use, then helps us understand our LAlt vs. Spacebar split.

**Proposed principle: the modifier IS the scope.**
- **LAlt = global.** Windows, zones, apps, workflows. Hooked system-wide by AHK, so it
  works everywhere and the browser never sees it.
- **Space = local.** Content only, only inside an editing surface of our own apps, only
  with no other modifier held.

Held to that, the two cannot collide by construction, and the atlas's job becomes making
that visible and catching the exceptions — rather than refereeing every key by hand.

**Already true in the notes app, and now tested:** the Space layer bails on any Alt-held
key before it looks at Space, so an LAlt chord is never intercepted. Verified the test
fails when that guard is removed.

**The one place the two modifiers physically meet: Alt+Space.** Windows' window menu,
and PowerToys Run's default activation — and FancyZones ships inside PowerToys. ⚠ From
knowledge, NOT measured on memeputer; the PowerToys defaults have moved between releases.
Read it from his actual PowerToys settings before relying on it.

**Owner: master, not a project.** COORDINATION.md T0.5 — a keymap claimed by several
projects is a shared resource, so no project may own it. Each layer has exactly one
source: the Space layer is READ from `notes/js/editor/commands.js`, never copied into the
atlas, or the two drift the way the footer and keymap did before 2026-09-19.

**Layers:** Windows reserved → other apps (Edge, PowerToys) → LAlt (the AHK system) →
Space (ours).

**Blocked on:** the LAlt layer's actual contents — his AHK script(s) and PowerToys
keyboard settings. ⚠ **`atlas` is a PUBLIC repo.** Scripts are pasted into chat, and only
the extracted hotkey table gets committed; never the scripts themselves, which can carry
paths and personal detail.

- Status: not started. Recorded so the Space layer is designed against it from now on.

---

## Parked

### Taskbar vfx
Windows fights this. Real mods need injection or a replacement shell — the opposite of additive.
Additive reframe: **hotkey-summoned overlay launcher bar** floating above the taskbar you stop looking at. A genuine project, not a quick one.

### Notes replacement
**Promoted to Active #5.** Original plan (reader/capture layer over existing notes, blocked on the extension) dropped — going straight to full replacement, since the Safari PWA + Supabase path is known territory.

### Design docs / kanbans
Split out of the Claude project — it was a different project wearing that one's coat. Un-scoped.

---

## Decisions Log

- **A/B replacement suite** (additive → sidepane → whole panel → replacement) confirmed as the spine for all projects.
- Sidepane and "own extension page" collapsed into one rung — same context, same APIs, different surface. Will likely want both anyway.
- Inserted rung 3 (local companion). Most things that tempt toward Electron are satisfied here at a fraction of the cost.
- Claude project scope cut: kanbans/design docs removed.
- **Notes app jumps the ladder** and becomes the first build. The ladder is a risk-management tool; it doesn't apply where there's no risk. Supabase is a *bought* rung 3, not a skipped one.
- **Public repo over private.** Private Pages auth gate conflicts with add-to-home-screen standalone context. Nothing in the client is sensitive, so the conflict is avoidable rather than solvable. (Applies to the *app* repo. The coordination repo may be private — they are two repos, do not conflate them.)
- **2026-09-12 — Master moves to the cloud, reversing the handoff.** The handoff put master in Claude Code because Cowork threads supposedly lacked `ListAgents`/`SendMessage`. Verified false: this Cowork session has both. Master lives here because it is always-on, holds the device bridge, browser automation and fan-out at once, and survives the PC sleeping. Full reasoning and the verified topology in `_protocol/COORDINATION.md`.
- **2026-09-12 — GitHub is the coordination bus, not messaging.** Verified: peer messaging is scoped to a single machine, and a cloud session's machine is its own container — so local Claude Code on memeputer is *not* reachable from here, and cloud-to-cloud messaging is one-way. The repo is the only channel that works across every topology. This promotes the existing "files are permanent" rule from preference to load-bearing.
- **2026-09-12 — Absolute zero dependencies for the notes app.** No npm, no build step, no runtime library including `supabase-js`. Reason: maximum customisability, permanently, and a codebase small enough to hold in one session's context. Cost itemised in `DESIGN.md` §1 rather than discovered later.
- **2026-09-13 — One repo: `Zoetiq-Intelligence/atlas`.** All one-shots and all workflow work live here. Notes app serves from `/notes/`, so the site is `https://zoetiq-intelligence.github.io/atlas/notes/`.
- **2026-09-13 — `atlas` is PUBLIC, and that is temporary.** Forced by Pages: a private repo's site sits behind a GitHub login gate, and that gate breaks add-to-home-screen standalone launches. ⚠️ **Consequence to account for: everything in this repo is publicly readable — board, transcripts, design docs, and the Omicron Alpha architecture notes including its pricing and plan details.** Escape hatch when privacy is needed: **Cloudflare Pages or Netlify deploying from a private repo** — private source, public site, no auth gate. Nothing about the app has to change; it is a hosting swap. Revisit before anything genuinely sensitive is committed.
- **2026-09-13 — An Electron workstation app is a stated destination**, with cross-device sync as the invariant across every surface. Recorded as intent, not yet scoped. ⚠️ Note the tension with the existing Electron warning above: rung 4 trades away in-page context. That warning was written about *augmenting* a browser, where the loss is fatal. A notes app is different — it is its own product, and `BOARD.md`'s own rule says rung 4 is legitimate when the app *is* the product. **But rung 3 (local companion) should be exhausted first** — it delivers filesystem access and long-running work while the client stays a web app on every device. Decide with a real need in hand, not in advance.
- **2026-09-18 — Master pushes directly to `main`; every push deploys.** The proxy block in `HANDOFF-2026-09-17.md` §3.1 is resolved — this session was created with `atlas` attached and push is verified. Operator's call. The cost is that a broken push reaches his daily-driver app with no staging step, so the full test suite is a precondition of every push, not a nicety.
- **2026-09-18 — Backups are server-side snapshots, taken by the client's clock.** A `notes.snapshot` table plus `take_snapshot` / `restore_snapshot` functions; the client decides *when* and Postgres decides *what*. Rejected: uploading the device's local IndexedDB copy — it would back up whatever one device happened to hold, which may be stale or mid-sync, and the thing worth protecting is the canonical state. Restore never hard-deletes: absent notes are soft-deleted through the existing `deleted_at` column and a `pre-restore` snapshot is always taken first, so a restore is itself undoable by two independent routes.
- **2026-09-12 — Versioned rebuilds over incremental improvement.** Fixes allowed inside a version; features go to the next version's design doc. Rebuilds start from documents, not code. "Drag back to design docs" is a scheduled phase on the roadmap, not a failure.

---

## Thread Assignments

Revised 2026-09-12 per `_protocol/COORDINATION.md`.

| Work | Venue | Why |
|---|---|---|
| Triage, board, handoffs, commissioning | **This cloud session** (`claude-a2`) | always-on; holds every bridge at once |
| Notes app | **This cloud session**, building directly | static files + REST; no local machine needed |
| Edge extension + Claude module | **Local Claude Code** on memeputer | needs unpacked-extension loading in real Edge |
| FancyZones layouts | **Local Claude Code** on memeputer | it is configuration of that machine |
| Training prompt pack | New Cowork thread (artifact, not code) | unchanged |
| Whiteboard | **unassigned** — build order not yet ruled | see W1/W2 in its `STATE.md` |

Local Claude Code is a **peer, not a child** — there is no messaging link to it from master. Coordinate only through the repo.

---

## Open Questions

- **Is the Edge extension really "not started"?** The attached project doc describes Omicron Alpha as a shipped MV3 extension with a gateway, Supabase schema, dashboard and 27 passing tests. This row is currently fiction. Raised 2026-09-13, unanswered.
- Notes app: substitutes for the four platform-impossible parity items. Ruling is full parity; the gap is real and needs a per-item decision. **Now the explicit v1 gate** — no v1 code until it is written down.
- Notes app: was deferring the keyboard-up layout intended? It is the item the project's own state file names as the day-one gate.
- Overlay launcher: does it replace the taskbar's job, or only the launching part?
- Is the coordination repo on GitHub yet, or still only the seed zip? Everything in `COORDINATION.md` assumes it becomes a real remote.
- Whiteboard: does the zero-dependency ruling carry over? It decides whether there is a server, and a centralised ordering point is what makes hand-rolled sync tractable at all.
- Whiteboard: where does it sit in build order? It is project #6 and must not displace the notes app.
- Whiteboard: primary target — iPad + Pencil, or Windows + graphics display? Windows exposes twist, tangential pressure and barrel buttons; Apple Pencil exposes none of them.
- Connect a folder on memeputer — nothing local is reachable from master until then.
- **The PC Workflows system (AHK + FancyZones, all on LAlt) is an existing system this board has never listed.** Is it board #3 grown up, or its own project? Second existing system the board did not know about — see the Omicron Alpha question above, still unanswered since 2026-09-13.
