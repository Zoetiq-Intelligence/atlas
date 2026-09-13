# Coordination

> Master thread owns this file. Supersedes the "Capability findings" section of `HANDOFF-MASTER.md`.
> Written 2026-09-12 by master session `claude-a2 [128d7b]` (Cowork cloud).
> Last updated: 2026-09-12

---

## The one-line answer

**GitHub is the bus. Everything else is a latency reducer.**

Every session — cloud, local, subagent — pulls the repo at start and pushes at end. No other channel is assumed to exist, because no other channel survives every topology. The protocol's existing rule ("conversation is transitory, files are permanent") was already correct; this file makes it load-bearing rather than aspirational.

---

## Verified findings — corrections to the handoff

These were tested in-session on 2026-09-12, not recalled.

### 1. Cross-session messaging is NOT Claude Code only

The handoff states: *"It is Code-session ↔ Code-session only. A Cowork/chat thread has neither tool."*

**False.** This Cowork cloud session has both `ListAgents` and `SendMessage`. It is named `claude-a2 [128d7b]` and is addressable. The reasoning that moved the master role to Claude Code no longer holds on those grounds.

### 2. "Reachable peers" means *same machine* — and a cloud session's machine is its own container

`ListAgents` from here reports: *"No reachable agents — no other Claude session is running on this machine right now."*

"This machine" is the ephemeral Linux container this session runs in. It is **not** memeputer. Therefore:

- Local Claude Code sessions on the Windows box are **not** peers of this session.
- Sessions inside this container (subagents I spawn) **are** peers.
- Other cloud sessions on the account are reachable **one-way only** — I can send to them; they cannot send back. Their return channel must be the repo.

### 3. The desktop bridge exists and is separate from messaging

memeputer is linked (`win32`, app `1.52386.3`). The `remote-devices` tools reach it: a shell in an isolated Linux VM on that machine, folder access, screenshots, its Chrome.

**Currently `connectedFolders` is empty.** Until a folder is connected, nothing on the Windows filesystem is reachable. That is a one-click fix on XENO's side, not a limitation.

### 4. This container can push to GitHub directly

`git 2.43.0` present, `api.github.com` returns 200 through the egress proxy. `gh` CLI is absent but unnecessary — `git push` over HTTPS with a token works. This is how prior sessions pushed.

`gh` absent also means: no `gh pr create`. Use the REST API via `curl` if a PR is ever needed.

### 5. Net effect on the handoff's "all cloud has a wrinkle" flag

The flag was right to exist and wrong in its specifics. The real shape:

| Link | Direction | Reliable? |
|---|---|---|
| Master → in-container subagent | both ways | yes |
| Master → other cloud session | one way | yes, outbound only |
| Master → local Code on memeputer | neither | **no** |
| Master → memeputer filesystem | both ways | yes, via device bridge, once a folder is connected |
| Any session → GitHub | both ways | **yes — the only universal one** |

The bottom row is why GitHub is the bus.

---

## The four tiers

### T0 — Substrate: the `workflowpipelines` repo

The durable state of everything. Not a backup of the conversation; **the record**, of which conversation is a lossy cache.

- First act of every session, without exception: `git pull`.
- Last act of every session, without exception: `git commit && git push`.
- A decision that is not committed did not happen. This is not a style preference — given T3 and T4 below, it is the only thing that actually works.

This repo may be **private**. It is docs and coordination. The *public* repo requirement applies only to the notes-app Pages site, which is a different repo. Do not conflate them.

### T1 — Master: this cloud session

Owns `BOARD.md`, owns the handoffs, runs the serial conversation with the operator, opens and closes projects. **Writes no project code.**

Why here rather than local Claude Code, given the handoff planned the opposite:

- Always on. Survives PC sleep, reboot, and XENO closing the laptop. A local master dies with the machine and takes the serial conversation with it.
- Has the fan-out primitives (`Agent`, `Workflow`) *and* the device bridge *and* browser automation. Local Code has the filesystem but not the rest.
- Reachable from phone, PC, anywhere — the same session, not a synchronised window onto one.

What it gives up: no direct filesystem on memeputer without a connected folder, and it cannot message local Code sessions. Both are handled by T0 and T4.

### T2 — In-session subagents (`Agent` tool)

Ephemeral workers inside this container. They share the master's context, run in parallel, and return a result.

**Use for:** parallel research, drafting competing approaches, adversarial verification of a claim, sweeping a codebase.

**Hard rule: a subagent never owns a `STATE.md`.** It cannot outlive the turn, so it cannot be a project thread. It reports to master; master writes the file. Confusing these is how state gets lost.

### T3 — Child cloud sessions

For a long-running independent workstream that needs its own context budget — a second project built in parallel.

Constraint that shapes everything: **messaging to them is one-way.** Master can push a pointer in; nothing comes back except through the repo. So a child cloud session is commissioned with a written brief committed to the repo, and reports by committing to its `STATE.md`. Messages say *"pull, read `projects/x/STATE.md` at commit abc123"* — never the content itself.

Do not open one until a project genuinely cannot share master's context. Two projects in one session beats two sessions with a broken link.

### T4 — Local Claude Code on memeputer

A **peer, not a child.** No messaging link to master exists. Coordinated purely through the repo, on the same pull-first/push-last discipline.

Reserve it for the jobs the cloud genuinely cannot do:

- Loading an unpacked MV3 extension into real Edge and testing it — the Edge extension project (#1) needs this at rung 2 and there is no cloud substitute.
- PowerToys / FancyZones configuration (#3) — it is config on that machine, full stop.
- Anything needing the real Windows filesystem at volume, the local GPU, or git with XENO's own credentials.

**The notes app does not need it.** It is static files plus REST calls — the cloud does that better and never sleeps.

---

## T0.5 — Shared services: master is the platform layer

XENO's ruling, 2026-09-12:

> "I'd prefer to handle those here so that any child threads just do their applications and this handles all the stuff they might all use."

**Master owns every shared resource. A project thread owns only its application.**

| Master holds | A project thread never |
|---|---|
| GitHub account, repos, tokens | creates a repo or a token |
| Supabase project, schema, RLS, auth config | provisions a database or configures auth |
| Deployment config — Pages, domains, DNS | sets up hosting |
| The protocol, the board, the handoffs | edits `BOARD.md` or `_protocol/*` |
| Every credential, and the ledger in `SETUP.md` | holds a credential it did not receive from master |

Why this is right, beyond XENO preferring it: **setup is where secrets leak and where decisions get made twice.** Four threads each creating a Supabase project is four schemas that drift. One thread holding the platform means a commissioned thread's first action is `git pull` and its second is writing application code — not an hour of account admin, and not a second copy of a credential in a second transcript.

Consequence for commissioning: a brief is not "go build X." It is **"here is a repo you can push to, a database with the schema applied, auth configured, and a design document — build X."** If a thread has to ask for infrastructure, the commission was incomplete.

`_protocol/SETUP.md` is the record of what exists, how it was configured, and how to revoke it.

---

## What master does, and what it must not

XENO, 2026-09-12: *"you will only do oneshots and adjustments, whereas threads will manage."*

Close, and worth stating precisely because the loose version hides a failure mode.

**The cut is not duration — it is which kind of state each side holds.** Master is stateful about the *system* and deliberately stateless about any *implementation*. A project thread is the inverse: deep state on one codebase, near-zero on the system. Master owns the longest-lived artefacts in the repo, so "one-shots" undersells it; what master must not own is a build in its head.

**Usable test: master's work must always be interruptible.** Anything that cannot be dropped mid-way and resumed from a file belongs in a thread. Master's context is a shared resource — tokens spent on one project's internals are unavailable for triage across the other three, and a master deep in a build cannot answer a question about a different project without derailing.

**What master legitimately builds: the bootstrap.** The work that is cheapest done once, coherently, by whoever holds the whole design — the platform, the schema, the skeleton that proves the architecture. Handing a cold thread an empty repo and a design document costs more than handing it something already running.

**The asymmetry in "adjustments."** Master adjusts freely *before* handoff. After handoff, master **raises, never patches** — a master that keeps editing a thread's code is a second writer on that file, and the one-writer rule is the thing keeping conflicts impossible rather than merged.

**Threads are cheap to lose; master is not.** A dead thread is re-commissioned from its `STATE.md`. A dead master needs `HANDOFF-MASTER.md` to be current — which makes keeping that file good master's most important recurring duty, not an end-of-session chore.

### Scope is the one thing neither side owns alone

A thread manages scope *inside* its brief: sequencing, what to build first, what to cut from a version, how to spend its own days. It does not need permission and should not ask.

A thread does **not** rule on scope *of* its brief. Growing the brief, skipping a rung, parking the project, or anything that changes another project's assumptions goes to master — because the thread knows the cost and only master can see the consequence. `PROTOCOL.md` already requires this as escalation; this is why.

Master rules, writes the outcome to `BOARD.md`, and the thread writes it to its own `STATE.md`. Both files, not either. A scope change living in one file is how two projects end up built against different assumptions.

The tell that this is being done wrong: a thread asking master whether it may reorder its own next two tasks (master is being used as a bottleneck), or a thread quietly absorbing a new feature without an escalation (the board is now fiction).

### Consequence, recorded 2026-09-12

Handoff point for the notes app moved **earlier**, from "editor engine proven" to "working skeleton." Proving the engine is management, not bootstrap. Skeleton means: document model, editor engine, one successful round-trip to Supabase, deployed and loading on both devices. The thread inherits something running and does the proving.

---

## Commissioning a project thread

1. **Master finishes the platform first.** Repo, schema, auth, deploy — all working, all in `SETUP.md`.
2. **Master writes `projects/<x>/COMMISSION.md`** — the brief. Committed before the thread is opened. This is the handoff; the conversation that opens the thread is not.
3. **Master pushes.** The brief does not exist until it is on the remote.
4. **The thread is opened and pointed at the repo**, nothing more. Its first act is `git pull`; its second is to read `PROTOCOL.md`, `COORDINATION.md`, its `COMMISSION.md`, `DESIGN.md` and `STATE.md`.
5. **The thread takes ownership of its `STATE.md`** and master stops writing it. Ownership transfer is explicit and dated in both files, or it has not happened.
6. **Master keeps the credentials.** It hands over the minimum the thread needs to work. A thread that needs to push gets push access to one repo, not the account.

Reverse direction is the same discipline: a thread hands work back by committing, then telling master which commit to read.

---

## Rules

1. **One writer per file.** Master owns `BOARD.md` and `_protocol/*`. Each project thread owns exactly one `projects/<x>/STATE.md`. Nobody writes another's file. Merge conflicts then become impossible by convention rather than resolved by merge.
2. **Messages carry pointers, never content.** `"schema changed, pull and read projects/notes-app/STATE.md"` — good. `"the schema is now X"` — forbidden, because the one session that misses the message is the one that needed it.
3. **Pull first, push last.** Every session. If a session ends without pushing, treat its work as lost and reconstruct from the last commit; do not try to recover it from a transcript.
4. **Commit messages are part of the record.** `wip` is a defect. The commit subject should be readable by a cold session six weeks out.
5. **Escalation unchanged** from `PROTOCOL.md`: project thread raises, master writes `BOARD.md`, project writes its own `STATE.md`. Both, not either.

---

## Assignments as of 2026-09-12

| Work | Venue | Why |
|---|---|---|
| Triage, board, handoffs, commissioning | **This cloud session** (T1) | always-on, has every bridge |
| Notes app | **This cloud session** (T1 builds it directly, T2 fan-out) | static + REST; no local machine needed; XENO wants it today |
| Edge extension + Claude module | **Local Claude Code** (T4) | needs unpacked-extension loading in real Edge |
| FancyZones layouts | **Local Claude Code** (T4) | config on the machine itself |
| Training prompt pack | Cowork thread (artifact, not code) | unchanged |

Deviation from the handoff, recorded so it can be challenged: the notes app is built by master rather than commissioned to a project thread. Justification — it is the day-one build, the operator wants it live today, and the cost of a one-way link to a child session exceeds the benefit of separating contexts. **If the notes app outgrows master's context, it gets promoted to T3 with a written brief, not messaged instructions.**

---

## Open

- **Connect a folder on memeputer.** Nothing local is reachable until then. Needed before any T4 work is coordinated or verified from here.
- **GitHub token.** A fine-grained PAT scoped to the notes-app repo lets master push and iterate without a manual round trip. Not needed for the coordination repo if XENO pushes that himself.
- **Does the coordination repo exist on GitHub yet**, or is it still only the seed zip? Everything above assumes it becomes a real remote today.
