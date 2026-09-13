# Edge extension — STATE

> Owned by this project's thread. Master reads, never writes.
> Last updated: 2026-09-11 (seeded by master handoff; no session has run yet)

## One-line status

Not started. Second in build order. **This is a substrate, not a feature** — one extension that is a sidepane plus a place to drop modules, so every later browser-side idea becomes a module instead of a new project.

## Rung

Current: 0 · Target: 2 · Skips: none. Start at rung 1 (userscript) written adapter-shaped, port to rung 2.

## Stack

- Tampermonkey userscript first, then MV3 extension for Edge
- Surfaces at rung 2: sidepane + full extension page (these are one rung, not two — same context, same APIs)

## Scope

**In:**
- Module host / registry
- Sidepane shell
- First module: the Claude standards-injector (see below; split into its own folder if it grows)

**Out:**
- Anything needing filesystem or long-running background work — that's rung 3, and this project probably never goes there

## Now

Nothing.

## Next

1. Userscript skeleton, adapter-shaped from line one
2. Module registry
3. Standards-injector as module #1
4. Port to MV3

## Blocked

Behind the notes app in priority. Not blocked technically.

## Tried and rejected

- **"Sidepane" and "own extension page" as separate rungs.** Collapsed into one — same extension context, same APIs, different surface. Will likely want both anyway.
- **Electron as the step after the extension.** Rejected: it surrenders in-page context (DOM + logged-in session), which is the entire point. A local-companion rung was inserted before it.

## Decisions

- 2026-09-11 — Built as a substrate/module host rather than a bag of features.
- 2026-09-11 — Adapter-shaped rule is mandatory here: logic in plain modules, storage behind `store.get/set`, network behind one `request()`. This is what makes the userscript→extension port a swap of two adapters instead of an untangling. The gap between those rungs is real: Tampermonkey gives free cross-origin, `GM_*` storage, no build step, one file; MV3 means manifest, service worker, `chrome.storage`, message passing, CSP, host permissions.

## Open questions

- Does the standards-injector stay a module here, or become its own project folder once it has real surface area?

---

## Sub-project: Claude standards-injector

The prize: **universal standards edited in one place, applied to all chats.**

Design, TOS-safe:
- Local prompt-fragment library, injected client-side into the composer **before the operator hits send**
- Queueing = a local outbox that pastes the next message when they're ready

**Hard line: human in the loop on every send.** The moment it fires on a timer, it isn't compliant. This is not a preference; it's the boundary the design exists to respect.

Cut from scope: design docs / kanbans. That was a different project wearing this one's coat. Un-scoped.
