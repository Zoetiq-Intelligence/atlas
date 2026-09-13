# Protocol

Every thread working in this repo follows this. Read it at session start.

## The one rule

**Conversation is transitory. Files are permanent.**

If something is decided, it goes in a file before the conversation moves on. A decision that exists only in a transcript does not exist.

## Roles

**Master thread** — owns `BOARD.md`, owns triage, opens and closes projects, talks to the operator about priority. Does not write project code.

**Project thread** — owns exactly one folder under `projects/`. Writes code. Keeps its `STATE.md` current. Never edits `BOARD.md`; it raises things to master instead.

## Writing state

A project thread updates its `STATE.md`:

- at session start (note that you resumed, and from what)
- whenever a decision is made
- whenever something is blocked
- whenever a milestone lands
- **before the session ends or context gets tight** — this is the one that matters most

Write it so a cold session with zero context can pick up from the file alone. Assume the next reader knows nothing. Include what was tried and rejected, not just what's current — the rejected paths are what stop the next session repeating your week.

## Messaging vs. files

Cross-session messaging (`ListAgents`, `SendMessage`) carries text only — never history, never files. Treat it as a **latency reducer on top of the files, never the record**.

Correct use: "I changed the note schema, your query will break." Then write the schema change to your `STATE.md` too.

Incorrect use: relaying a decision that was never written down.

Availability: v2.1.224+ on macOS/Linux incl. WSL 2; **native Windows needs v2.1.234+**.

**Reachability is narrower than the handoff assumed — see `COORDINATION.md`.** Verified 2026-09-12: peers are scoped to a single machine, and a cloud session's machine is its own container. Local Claude Code on memeputer is *not* reachable from the cloud master, and cloud-to-cloud messaging is one-way. **GitHub is the bus.** Pull first, push last, every session.

## Escalation

A project thread escalates to master when:

- scope changes
- a rung on the ladder needs to be skipped
- another project is affected
- the project should be parked or killed

Master writes the outcome to `BOARD.md`, then the project writes it to its own `STATE.md`. Both, not either.

## The ladder

1. Userscript, written adapter-shaped
2. Extension, any number of surfaces
3. Extension + local companion
4. Standalone app — only if the app *is* the product

Adapter-shaped means: logic in plain modules, storage behind `store.get/set`, network behind one `request()`.

Rungs may be skipped, but only deliberately and only with the reasoning written into `BOARD.md`. The ladder manages risk; where there's no risk, it doesn't apply.

## Zeroth-phase rule

Nothing gets replaced, nothing gets uninstalled. Everything runs alongside the thing it will eventually eat.
