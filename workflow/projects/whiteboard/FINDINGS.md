# Whiteboard — FINDINGS

> Research commissioned by master 2026-09-13, before any build decision.
> Verified against primary sources, not recalled. Where something could not be
> verified it says so — those gaps are findings too.
> Owned by master until a project thread takes over.

---

## 1. Nobody ships a truly infinite canvas

Checked against source code and vendor documentation, not marketing copy.

| Product | Coordinates | Zoom range | Evidence |
|---|---|---|---|
| **Excalidraw** | float64 (`x: number`) | **10%–3000%** (300:1) | `MIN_ZOOM = 0.1`, `MAX_ZOOM = 30` in `packages/common/src/constants.ts` |
| **tldraw** | float64 | **5%–800%** (160:1) | `zoomSteps = [0.05 … 8]`, clamped in `Editor.ts`; configurable by host |
| **Miro** | unpublished | **1%–400%** (400:1) | documented in the Web SDK Viewport reference |
| **Figma** | plugin API float64; **`.fig` wire format stores vertices as f32** | undocumented | Kiwi format spec: `float` = 32-bit |
| **Apple Freeform** | unpublished | unpublished | nothing authoritative exists |

**Figma admits in writing that its canvas is bounded.** From Figma community support, on why FigJam boards end: *"We have to reserve memory for canvas coordinates, so FigJam needs to have some defined bounds."* Users hit the wall and complain about it.

**Consequence for us:** "truly infinite" is not a table-stakes feature that everyone has and we lack. It is unsolved in this product category. That makes it a differentiator *and* a research risk, which is exactly why v0 should be bounded.

**Calibration:** v0's stated 1/64x–64x is a **4096:1** range — wider than every product above. The v0 bound is not a compromise; it is already category-leading.

---

## 2. The precision arithmetic, for the stated v0 bounds

Assume a page ≈ 1000 world units, so 1,000,000 pages ≈ **1e9 units** of extent. At 64x zoom-in one screen pixel is 1/64 of a unit; allow 4x subpixel fidelity, so the finest meaningful increment is **1/256 ≈ 0.0039 units**.

**Required dynamic range = 1e9 / 0.0039 = 2.56e11.**

| | Mantissa precision | Verdict for v0 |
|---|---|---|
| **float64** (JS `number`) | 2^53 = 9.01e15 | fits, with **35,184x headroom** |
| **float32** (all GPU pipelines) | 2^24 = 1.68e7 | **short by 15,259x** |

Two things follow, and they are the whole architectural story of v0.

**(a) float64 is sufficient. No exotic machinery is justified.** No bigint coordinates, no nested frames, no tiled addressing. JS numbers are already float64, so this costs nothing.

**(b) The GPU can never see world coordinates — not even at v0 scope.** This is the finding that matters, because it is counterintuitive: the model is comfortable and the renderer still cannot cope.

- **WebGL2 / GLSL ES 3.00:** no `double` type exists.
- **WebGPU / WGSL:** `f32` is the only guaranteed float type. `f64` does not exist. The spec issue (gpuweb#2805) has been **open and unscheduled since April 2022**, with a named blocker that **Metal has no native float64** — which makes it permanently unlikely on Apple hardware.

So world coordinates must be rebased against the camera origin **in float64 on the CPU**, and only the small camera-relative offsets go to the GPU as f32. This is the standard "relative-to-center / relative-to-eye" technique — Cesium, deck.gl and Unreal Engine 5's Large World Coordinates all do exactly this. UE5 abandoned fixed tiling for paired-f32 emulation precisely because it *"stores as much precision as it can, regardless of the value's magnitude."*

**Prior art on the failure mode.** Pad++ hit this in 1998 and documented the trap: naively computing `(xoffset * zoom) - (xview * zoom)` makes the reachable space *"pyramid shaped — the more you zoom in, the less you can pan."* The fix is to reassociate as `zoom * (xoffset - xview)`, i.e. subtract in world space **before** scaling. Same lesson, twenty-eight years earlier.

**The browser floor is lower than float64 anyway.** Skia's `SkScalar` is 32-bit float and it converts internally to 26.6 and 16.16 fixed point. Any web canvas must rebase near the viewport before handing coordinates to the rasteriser regardless of what the model stores.

---

## 3. The seam that preserves truly-infinite for free

Because the renderer only ever sees **camera-relative deltas**, the absolute coordinate representation is a *storage* concern, not a *render-loop* concern.

That means the upgrade path from bounded to unbounded does not touch the renderer, the input layer, the sync layer, or the UI. It touches one function:

```
worldToCamera(point, camera) -> small f32 offset
```

v0 implements it as a float64 subtract. Truly-infinite later reimplements it over whichever representation wins — nested frames, tile-local integers, or a floatexp scalar — and everything downstream is unchanged.

**This is the single architectural requirement of v0.** Build this seam and the infinite option stays open at zero cost. Skip it — hand absolute coordinates to the GPU — and v0 both breaks at its own stated bounds *and* forecloses the infinite path. There is no version of this project where that seam is optional.

**Candidate representations when the time comes, ranked by evidence:**

1. **Hierarchical / tile-local integer coordinates.** Proven in production at scale by Mapbox Vector Tiles: geometry stored as integers local to a tile, `extent` 4096, with `(z, x, y)` carrying the high-order address. Unbounded depth comes from adding levels, not widening the number.
2. **floatexp** — a normalised double mantissa plus a separate integer exponent. The deep-zoom fractal technique; a drop-in scalar type for the camera's zoom with no schema change.
3. **Nested coordinate frames** — a scene graph where each node is relative to its parent. Most natural for mindmaps, where a branch *is* a frame. The catch: hit-testing, snapping and bounds must all stay frame-relative and never flatten.

For reference on what unbounded really buys: deep-zoom fractal renderers reach 1e300 with plain doubles, and beyond e4900 using perturbation theory — computing one reference orbit in arbitrary precision and every other pixel as a small delta from it. That is floating origin applied to iteration rather than to a camera. The ceiling is the bignum library, not the algorithm.

---

## 4. Concurrent ink is far easier than it sounds

**A completed stroke is immutable.** Its id is a UUID, its geometry never changes after pointer-up. Two clients can therefore never produce conflicting values for the same stroke.

That makes the stroke collection a **grow-only set** — union is commutative, associative and idempotent, so it is trivially a CRDT with **zero merge logic and zero metadata**. Add an LWW tombstone flag for erase and you have a standard LWW-element-set. No vector clocks, no OT, no sequence CRDT.

The only genuinely shared mutable ordering is **z-order**, which is what fractional indexing is for — and both Figma and Excalidraw use it exactly and only that way. Fractional indexing is the right tool for shape z-order (interleaving two shapes is harmless) and the wrong tool for character-level text, where it produces the documented Logoot/LSEQ interleaving anomaly.

**In-progress strokes are single-writer by construction** — one pointer, one client. tldraw's wire protocol has a dedicated `Append` op carrying an offset for exactly this: a monotonically growing array from a single author needs only "append from N", which is idempotent and reorder-tolerant.

**How the incumbents actually sync — none of them use a real CRDT:**

- **Figma:** *"inspired by multiple separate CRDTs"* with the decentralisation stripped out. Last-writer-wins **per property**. One server process per document. Text is explicitly not merged.
- **tldraw:** server-authoritative git-style push/pull/rebase with a logical clock. One Cloudflare Durable Object per room.
- **Excalidraw:** whole-element LWW, tiebroken deterministically by `versionNonce`. Coarser than Figma.

**The decisive insight: a centralised ordering point is what makes hand-rolling tractable.** Figma buys it with a per-document process, tldraw with a per-room Durable Object. That single-writer serialisation point is *why* they can skip real CRDTs. Drop it and you are rebuilding Yjs.

**Library weights, measured from published artifacts:** Yjs 62 KB gzipped; Automerge 1.12 MB; Loro 1.07 MB. For an app needing only grow-only sets, LWW registers and fractional z-order, that is a heavy tax — but only if there is a server. This is why W1 and W2 in `STATE.md` are the same question.

**What hand-rolling actually requires** (the parts people underestimate): tombstones **plus a GC watermark** below which clients must full-resync; fractional index repair and dedup; referential integrity the merge cannot express; schema migration across clients of different versions; and an undo that composes with remote edits. With a server, roughly 500–1500 lines.

---

## 5. Why "fully generalized, shaders and 3D" was the right thing to narrow

No shipping product in this category has solved unbounded space. Building a generalized engine before there is one working application is how engines end up generalized along the wrong axes — you discover which abstractions were needed by needing them, not by predicting them.

The operator narrowed this to bounded v0 numbers on the same day it was raised. That is the correct sequencing, and §3 is why it costs nothing: **the generality lives behind one function**, so v0 can be concrete and the general version stays reachable.

This also matches the board's existing pattern. The Edge extension was triaged as *"not a feature, a substrate"* — but it still ships one module first. Same shape here.

---

## 6. Platform constraints worth knowing before design

**Rendering**
- WebGPU ships on iPadOS 26 / Safari 26 (2025-09-15), on by default; also macOS, Chrome, Edge. Firefox is Windows and Apple-Silicon macOS only.
- WebGL2 covers 98.55% of iOS devices (Safari 15.0+, 2021). Safe floor.
- **WebGL2 has no compute shaders.** If tessellation, culling or hit-testing move to compute, that code cannot be shared with the WebGL2 backend.
- **iOS canvas caps: 4096x4096 area** (multiply by devicePixelRatio — a 2048 CSS canvas at DPR 2 is already at the cap) and roughly **384 MB total across all live canvases**. Tiles must be GPU textures, not a pool of `<canvas>` elements. The 384 MB figure is a secondary source from the Safari 15 era and device-dependent — **measure it on the real target**.
- WebGL2 `MAX_TEXTURE_SIZE` is 8192 on 100% of iOS devices, 16384 on 98%. WebGPU's guaranteed default `maxBufferSize` is 256 MiB — chunk geometry rather than assuming one buffer.
- OffscreenCanvas with WebGL2 works in a Worker on iPadOS from Safari 17, WebGPU from Safari 26. But Safari fires **no `contextlost` event on OffscreenCanvas**, so GPU context loss must be detected another way — and that matters on memory-constrained iPads.

**Stylus**
- `getCoalescedEvents()` and `getPredictedEvents()` landed in **Safari 18.2** (2024-12-09), along with `altitudeAngle`/`azimuthAngle`.
- **Apple Pencil samples at 240 Hz while `pointermove` fires at frame rate.** Without coalesced events you discard three of every four samples at 60 Hz. This is not an optimisation; strokes are geometrically wrong without it.
- tldraw shipped, reverted and re-landed `getCoalescedEvents` because it was **null in some circumstances on iOS**, and synthetic events return an empty array. Always null-check and fall back to the dispatched event.
- **Pressure defaults to 0.5 for hardware without pressure while a button is down**, 0 otherwise — the classic trap that makes mouse strokes half-width. `tilt` and `twist` default to 0 when unsupported, so "flat" and "unsupported" are indistinguishable without probing.
- **Latency levers on iPad are thin.** `desynchronized: true` is 2D-only in Safari (not WebGL, and there is no WebGPU equivalent on any platform); Delegated Ink Trails is Chrome/Edge only; `pointerrawupdate` is not in Safari. **Prediction plus a main-thread wet-ink overlay is the entire toolkit on iPad.**
- **Apple Pencil Pro squeeze and barrel roll are not exposed to the web at all**, nor is double-tap, haptics, or hover distance. Hover presence works from Safari 16.1 on M2 iPad Pro and later.
- Palm rejection has no API. `pointerType` is the reliable signal; enter pen-mode on the first pen `pointerdown` and drop touch pointers. Must handle `pointercancel` by **undoing a partially drawn stroke**.

**Storage**
- iOS/iPadOS per-origin quota is up to **60% of total disk** since Safari 17 — quota is not a constraint. The widely-repeated "50 MB iOS cap" is obsolete folklore.
- **Installed home-screen apps and tabs get the same quota, but differ on eviction.** Best-effort storage is evicted LRU and after roughly 7 days without interaction. Developer reports consistently indicate `navigator.storage.persist()` returns true **only for home-screen web apps** in Safari — not officially documented by Apple, flagged as strongly indicated rather than confirmed. **Design consequence: this must be installable and must call `persist()` on first run**, or a tab-only user can lose everything.

**Spatial indexing**
- tldraw uses an **R-tree (RBush)**, one index per page, with a dirty-set that makes updates O(affected) rather than O(page). Pad++ also chose R-trees over R*-trees in 1998 because dynamic scenes favour cheap insertion over optimal structure.
- Quadtrees need a bounded universe and degenerate on clustered content — which whiteboards always are.
- **LOD is a separate axis from culling and is the bigger win past ~1e5 objects.** tldraw's own open issue on this names the gap: per-shape DOM nodes become the bottleneck, and the fix is rasterising a tile of content to one texture at low zoom.

---

## 7. Explicitly not verified

- Figma's min/max zoom — undocumented in both the help centre and the plugin API. Circulating figures have no primary source.
- Figma's internal coordinate width — the f32 evidence is reverse-engineering of the `.fig` Kiwi format, not a Figma statement.
- Figma's and Miro's spatial index structures — unpublished.
- Apple Freeform — coordinates, zoom limits, sync algorithm. Nothing authoritative exists.
- Whether Safari's `desynchronized: true` measurably reduces latency on iPadOS. Recorded as supported since Safari 15; no benchmark or WebKit statement found.
- iOS total canvas memory ≈ 384 MB — secondary, Safari 15 era, device-dependent.
- `navigator.storage.persist()` being home-screen-only — consistent developer reports, no Apple documentation.
- WebGPU device-tier restrictions on iPadOS — none found, none ruled out.
- Chrome Android mapping S-Pen barrel orientation to `twist` — OS data exists, browser mapping unconfirmed.
- "Immutable strokes ⇒ grow-only set" as a *named* pattern — the supporting facts are all source-verified, the framing is ours.

---

## Sources

Figma: [multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) · [canvas bounds thread](https://forum.figma.com/t/make-the-canvas-infinitive/3159) · [Kiwi format](https://github.com/evanw/kiwi)
tldraw: [sync docs](https://github.com/tldraw/tldraw/blob/main/apps/docs/content/docs/sync.mdx) · [SpatialIndexManager](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/editor/managers/SpatialIndexManager/SpatialIndexManager.ts) · [camera options](https://tldraw.dev/reference/editor/TLCameraOptions) · [LOD issue #8307](https://github.com/tldraw/tldraw/issues/8307) · [coalesced-events PR #5554](https://github.com/tldraw/tldraw/pull/5554)
Excalidraw: [constants](https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/constants.ts) · [reconcile](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts)
Miro: [Viewport SDK](https://developers.miro.com/docs/websdk-reference-viewport)
Precision: [Cesium, Precisions Precisions](https://help.agi.com/STKComponents/html/BlogPrecisionsPrecisions.htm) · [UE5 Large World Coordinates](https://dev.epicgames.com/documentation/unreal-engine/large-world-coordinates-rendering-in-unreal-engine-5) · [Pad++ 1998 (PDF)](http://www.cs.umd.edu/projects/hcil/pad++/papers/spe-98-padimplementation/spe-98-padimplementation.pdf) · [Project Zero on Skia precision](https://projectzero.google/2018/07/drawing-outside-box-precision-issues-in.html) · [deep zoom theory](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html) · [gpuweb#2805 f64](https://github.com/gpuweb/gpuweb/issues/2805)
Addressing: [Mapbox Vector Tile spec](https://github.com/mapbox/vector-tile-spec/blob/master/2.1/README.md) · [DZI format](https://github.com/openseadragon/openseadragon/wiki/The-DZI-File-Format)
CRDT: [Kleppmann & Gomes, interleaving (PDF)](https://martin.kleppmann.com/papers/interleaving-papoc19.pdf) · [fractional indexing](https://observablehq.com/@dgreensp/implementing-fractional-indexing) · [Loro benchmarks](https://www.loro.dev/docs/performance)
Platform: [WebGPU status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) · [Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) · [Safari 18.2](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/) · [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) · [Pointer Events L4](https://www.w3.org/TR/pointerevents/) · [canvas area limit](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/)
