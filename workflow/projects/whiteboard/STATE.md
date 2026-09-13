# Whiteboard — STATE

> Owned by this project's thread. Master reads, never writes.
> Seeded by master 2026-09-13. No project session has run yet.
> Last updated: 2026-09-13

## One-line status

Not started. Triaged and scoped. **The infinite-space question is settled** — see `FINDINGS.md`: v0's stated bounds fit in plain float64 with 35,000x headroom, and the one thing that must be built correctly on day one is camera-relative rendering, which is also what preserves the truly-infinite path for free.

## Rung

Current: 0 · Target: 2 (browser app) · Skips: none yet.

Unlike the notes app, this is **not** known territory and the ladder applies. But the v0 bounds below take most of the risk out.

## Stack

Undecided beyond the rendering floor. Verified constraints:

- **WebGL2** is the compatibility floor — Safari iOS/iPadOS 15.0+, 98.55% of iOS devices.
- **WebGPU** shipped on iPadOS 26 / Safari 26 (2025-09-15), on by default. Available as the primary backend today with WebGL2 behind it, no coverage gap.
- **Canvas2D is not a candidate** past a few thousand strokes, and iOS caps canvas area at 4096x4096 and total canvas memory at roughly 384 MB. Tile caching must live in GPU textures, not a pool of `<canvas>` elements.

## Scope

**v0 — operator ruling, 2026-09-13:**

- Whiteboarding only. No mindmapping, no diagramming.
- **Zoom: 1/64x to 64x** (4096:1 total range)
- **Extent: ~1,000,000 pages wide at standard zoom** (~1e9 world units)
- Simultaneous users
- Stylus and mouse, tablets and graphics displays

For calibration, that zoom range is **wider than every shipping competitor**: tldraw 160:1, Excalidraw 300:1, Miro 400:1. v0 is not a toy.

**Out of v0, explicitly:**

- Mindmapping, diagramming, shapes, text
- Shaders, 3D models
- Truly unbounded address space

**Not foreclosed:** the three items above are all reachable from the v0 architecture without a rewrite, *provided* the camera seam in `FINDINGS.md` §3 is built correctly. That is the entire architectural requirement of v0.

## Now

Nothing. Awaiting a build-order ruling from master and a commissioned thread.

## Next

1. Decide build order — this is project #6 and must not jump the notes app (master's call, not the thread's)
2. Decide whether the zero-dependency ruling carries over from the notes app. **This is the single largest open question** and it changes the project's size by a wide margin — see Open questions.
3. Prototype the camera seam and ink latency on the real target device before anything else
4. Schema and sync design

## Blocked

On master for build order and the dependency ruling. Not on the operator for anything technical — v0 scope is settled.

## Tried and rejected

- **Nothing yet.** But recorded from research so nobody re-derives it: the "fully generalized engine supporting shaders and 3D at infinite zoom" framing was **narrowed on the same day it was raised**, by the operator, to bounded v0 numbers. That was the correct move and the reasoning is in `FINDINGS.md` §5 — no shipping product has solved the general problem, and building a generalized engine before one working application generalizes in the wrong directions.

## Decisions

- 2026-09-13 — **v0 bounds set at 1/64x-64x zoom, ~1e6 pages wide.** Operator ruling.
- 2026-09-13 — **Coordinates are float64 for v0.** Verified: the stated bounds need 2.56e11 of dynamic range; float64 gives 9.0e15, a 35,184x margin. No exotic machinery is needed or justified at v0.
- 2026-09-13 — **Camera-relative rendering is mandatory from the first commit, not an optimisation.** float32 is short of v0's requirement by 15,259x, and float32 is the hard ceiling on both WebGL2 and WebGPU — WGSL has no f64 and the spec issue has been open and unscheduled since 2022, blocked in part because Metal has no native float64. World coordinates therefore can never be handed to the GPU. They must be rebased against the camera origin in float64 on the CPU first.
- 2026-09-13 — **Truly-infinite is deferred but not foreclosed, and costs nothing to preserve.** Because rendering only ever sees camera-relative deltas, the absolute coordinate representation is a storage concern rather than a render-loop concern. Swapping float64 for nested frames or tile-local integers later does not touch the renderer. One function is the seam.
- 2026-09-13 — **Concurrent ink needs no conflict resolution.** A completed stroke is immutable, so the stroke set is a grow-only set, which is trivially a CRDT. Erase is an LWW tombstone; z-order is a fractional index. A general CRDT library is unjustified for v0. See `FINDINGS.md` §4.

## Open questions

**W1 — Does the zero-dependency ruling carry over from the notes app?** The single biggest scope lever on this project. Hand-rolling the sync layer is tractable *only* with a centralised ordering point (one process or Durable Object per room) — that is precisely how Figma and tldraw avoid real CRDTs. Without a server, you are rebuilding Yjs, and Yjs is ~62 KB gzipped against Automerge and Loro at ~1.1 MB. Needs an operator ruling.

**W2 — Is there a server at all?** Follows from W1. The notes app's Supabase is a REST database, not an ordering point. Supabase Realtime, a Cloudflare Durable Object, or a small local companion are the candidates. This is a rung-3 tell: the thing is fundamentally *shared mutable state*, not files.

**W3 — Primary target device.** iPad + Apple Pencil, or Windows + graphics display? It changes the input work substantially: Windows/Wacom exposes twist, tangential pressure and barrel buttons; Apple Pencil exposes none of those and Pencil Pro's squeeze and barrel roll are not available to web at all.

**W4 — What does "a page" mean?** The v0 extent is stated in pages. Taken as ~1000 units for the arithmetic. Worth pinning, though at 35,000x headroom the answer barely matters.
