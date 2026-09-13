# workflowpipelines

Coordination repo for a set of parallel projects run by separate Claude threads.

## How this works

**Conversation is transitory. Files are permanent.** Every thread writes its state to a file in the folder it works in. Nothing is coordinated by message alone.

```
BOARD.md              universal board — master thread owns it
HANDOFF-MASTER.md     full context transfer for the master thread
TRANSCRIPT.md         verbatim source conversation this repo came from
_protocol/
  PROTOCOL.md         rules every thread follows — read at session start
  COORDINATION.md     verified topology: who can reach whom, and the four tiers
  STATE-TEMPLATE.md   copy when starting a new project
projects/
  notes-app/          #1 in build order — STATE.md + DESIGN.md + ROADMAP.md
  edge-extension/
  fancyzones/
  training-suite/
```

**GitHub is the coordination bus.** Every session pulls at start and pushes at end. Cross-session messaging does not reach every session — `COORDINATION.md` has the verified map — so a decision that is not committed did not happen.

## Roles

**Master thread** (a Cowork cloud session, as of 2026-09-12 — see `_protocol/COORDINATION.md`) — runs the serial conversation with the operator, owns `BOARD.md` and `_protocol/*`, owns the handoffs, commissions project threads.

**Project thread** — owns one folder, writes code, keeps its `STATE.md` current, never edits `BOARD.md`.

## Start here

New master session: read `HANDOFF-MASTER.md`, then `TRANSCRIPT.md`, then `_protocol/PROTOCOL.md`, then `_protocol/COORDINATION.md`, then `BOARD.md`. The handoff is the distillation; the transcript is the source — read both, they are not redundant.

New project session: read `_protocol/PROTOCOL.md`, then your own `STATE.md`. Nothing else is required reading.
