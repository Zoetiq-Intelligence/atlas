# Building a web app one-shot — the working guide

> **This is mine, not a copy.** Derived from XENO's 181-lesson iOS field document
> (3,767 lines, 53 lessons measured on real hardware), deduplicated to ~90 distinct
> rules, reorganised around **build order** instead of topic, corrected where six
> independent reviews found the source wrong, and extended with the one thing the
> source could not have: the epistemics of an agent who will never hold the device.
>
> **Applies to every one-shot.** Revised after every success and every failure.
> Version 1 · 2026-09-13 · see §12 for the revision protocol.

---

## How to use this

Read §0 first, always. Then read the section for whatever you are about to write —
the sections are ordered so that following them in order produces a correct app.

**Do not read this cover to cover before starting.** It is a checklist, not a book.

### Confidence labels

Carried from the source, with my own additions marked:

| Label | Means | How to treat it |
|---|---|---|
| 📱 | Measured on real hardware | Non-negotiable. You cannot reproduce the evidence, so you cannot overrule it. |
| 🖥 | Measured in a real rendering engine | Trust for layout relations; not for iOS-specific behaviour. |
| ⊢ | Reasoned from spec or engine behaviour | Sound default. Adapt with a written reason. |
| ⚠ | Asserted, never proven | Implement only if free. Never build logic that depends on it. |
| ✎ | **My correction or addition** | Flagged so a future revision can challenge it. |

**The most important thing about these labels:** the source's update-timing section
*reads* as heavily evidenced and is mostly ⊢. Only four things in it are measured.
Weight accordingly — and do the same to this document.

---

## §0 — Epistemics: what I may and may not claim

This section exists because **every expensive failure in the source document has the
same shape**: something was verified with a tool that could not possibly have
contradicted it, and the device disagreed. The source's own words — *"the dock was
'fixed' three times from Chromium measurements alone, and the iPhone simulator
confirmed every one of them."*

### 0.1 The capability table

| My tool | May assert | May **never** assert |
|---|---|---|
| Node test suite | State, data flow, DOM structure, the app's own write→read round trip, contents of built files | Anything about fit, overflow, clipping, paint order, size or position — **jsdom has no layout engine** |
| Headless Chromium at 390×844 | That a Chromium engine at that viewport lays out this way; regressions against my own baseline | That iOS WebKit does. That the standalone container does. That the safe-area case was exercised |
| Playwright WebKit | Closer to Safari than Chromium is | That it **is** iOS Safari. No iOS viewport chrome, no home-screen container, different process model |
| A screenshot I took | That the code renders *from the state I seeded* | That the state I seeded is the state the app actually produces |
| A phone-shaped frame in a desktop browser | **Nothing the desktop browser did not already tell me** | Anything at all about the device |

**The rule underneath the table:** a tool built on engine X cannot falsify a claim
about engine Y. Chromium cannot refute Chromium. Confirmation from a source that
structurally cannot disagree is worth zero — and it *feels* like evidence, which is
what makes it expensive.

### 0.2 Twelve things never to assume

1. **Never assume the device is running my code.** Prove three facts first: which ref the host builds, whether that ref has the commit, and which build id the device's own cache reports. 📱
2. **Never assume a fixture matches the schema.** Grep every field name before writing a fixture on it. If the only hits are in code I just wrote, I invented the name. 📱
3. **Never assume a green suite means the feature works.** At least one test per read path must drive the real write path and read back.
4. **Never subtract across coordinate origins.** Element rects are viewport-relative; `screen.*` is screen-relative. Mixing them produces a number that is wrong *by construction* and looks authoritative. 📱
5. **Never measure a suspect viewport against itself.** `innerHeight − rect.bottom` is 0 by construction on a device visibly showing a dead band. Derive from two independent facts instead. 📱
6. **Never assume "present in the file" means "executes in the document."**
7. **Never assume the build output contains only the files I listed.** Grep every published byte.
8. **Never assume my probe is inert.** A diagnostic that calls the app's own layout path has already destroyed the evidence.
9. **Never assume a fix I found explains the symptom they reported.** Say both: "this is real, and it is not your bug."
10. **Never assume silence means done.** An unmentioned ask reads as a finished one.
11. **Never assume my session can reach a service.** `curl` it, write the result down, re-read that note later.
12. **Never assume a doc's numbers** — including this one's. Read them from code or assert them in a test.

### 0.3 What to ask for, in priority order

Ask for **machine text, never prose.**

1. *"Open the app, tap the build id five times, tap Copy report, paste it here."* One tap answers geometry, build, storage, environment and configuration at once — and the report identifies its own configuration, so no follow-up is needed about which meta or which channel.
2. *"Tap Run self-test, tell me the X / Y."*
3. When they quote a string, **reproduce that literal string** against the published build before accepting any diagnosis. Not a plausible analogue — the exact one.
4. **Re-read their incidental clauses before theorising.** §0.5.

### 0.4 After two failed fixes to one complaint, change category

Two failures to the same report means the lever is wrong, not the setting. Stop
tuning. This is a hard stop, not a heuristic.

### 0.5 The paraphrase lesson — the most valuable thing in the source

A user reported a tab vanishing. Almost as an aside they added: *"when feedback
disappears, History takes us to the feedback page and it usually coordinates with an
app flicker."*

The agent's first theory produced a **real fix that was not the bug**. The aside was
the diagnosis: a tab labelled *History* opening a pane the app renders as *Feedback*
is a label/target mismatch that **only one cause produces** — an old shell running
new JavaScript, two builds on screen at once. The "flicker" was the service-worker
handover.

Three rules follow, and they are why this section exists:

- **Record verbatim. Paraphrase is a diagnostic instrument being thrown away.** A summariser keeps what it already thinks is important — exactly the wrong filter when the theory is wrong.
- **A real fix is not a diagnosis.** Naming it "real but not yours" is what kept the channel open.
- **Never ask what they already answered.** On a device I cannot hold, that channel is my only instrument, and re-asking spends it.

---

## §1 — Decisions to make before writing a line

| Decision | Default | Why |
|---|---|---|
| Status bar style | **`black`**, never `black-translucent` | 📱 §2.1. Translucent decouples the frame from the layout viewport and leaves a dead band you cannot paint. |
| Auth | **OTP code or password, entered in an overlay** | 📱-adjacent §6. Magic links and OAuth navigate away and sign in the *wrong storage container*. |
| Fonts | **System stack, or self-hosted** | 📱 §8.4. Never a font CDN. |
| Root sizing | **`position:fixed; inset:0`** | 📱 §2.3. No `height:100%` chain to resolve, no viewport unit to disagree with. |
| Caching | **Precache-first, lifecycle freshness** | 📱 §7. Never per-request freshness — that is how two builds end up on screen. |
| Install surface | **Its own directory**, relative `scope`/`start_url` | ⊢ §8.1. |
| Diagnostics | **Ship the device truth kit on day one** | 📱 §9. Not when something breaks — by then you are paying device round trips to get it there. |

---

## §2 — The shell

### 2.1 📱 Status bar: `black`, never `black-translucent`

**Mechanism.** `black-translucent` asks iOS to extend the native web-view **frame**
under the status bar. iOS enlarges the frame but **not the layout viewport**, which
stays at `screen − statusBar` and is pinned to the frame's **top**. The whole
difference lands as dead space at the **bottom**. Measured: screen 852, innerHeight
793, top inset 59, and 852 − 793 = 59 exactly.

The band's colour is the **root background propagated to the canvas**, and the canvas
covers the frame rather than the viewport — so it is not chrome tint and **no
restyling of your own elements can remove it**.

**Failure mode:** a strip of page-background along the bottom. **Standalone + device
only.** Everything inside the short viewport measures consistently, so every desktop
check and every phone-frame simulator shows nothing wrong.

```html
<meta name="apple-mobile-web-app-status-bar-style" content="black">
```

### 2.2 ✎ Ship both capable metas

`apple-mobile-web-app-capable` is the deprecated spelling; Safari logs a warning.
Ship both, and a manifest with `"display":"standalone"`.

```html
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
```

### 2.3 📱 Never size a box from the frame

The layout viewport is both the **containing block and the clip rectangle** for fixed
boxes. Growing `html`/`body`/`.app` to the frame height changes the *document*, not
the *clip* — a fixed box positioned into the extra region is laid out **below the clip
and never composited**. It does not extend. It **vanishes**. Measured: a dock moved to
807–852 inside a viewport ending at 793 and disappeared entirely.

```css
html,body{height:100%;position:fixed;overflow:hidden;overscroll-behavior:none;
          -webkit-text-size-adjust:100%}
.app{position:fixed;inset:0}       /* the containing block IS the layout viewport */
/* FORBIDDEN: any height:var(--frame-h) on the root chain */
```

Machine-check it: `assert(!/height:\s*var\(--vp-h/.test(css))`.

### 2.4 📱 `viewport-fit=cover`, and never `height=device-height`

`cover` is **the opt-in that makes insets non-zero at all**. Without it the layout
fits inside the safe area, where insets are zero by definition, and all your inset
handling is dead code computing to 0.

`height=device-height` asks for a layout viewport taller than the frame — which *is*
the mismatch. Measured on device: **it did not move `innerHeight`.**

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

### 2.5 ✎ Drop `maximum-scale` and `user-scalable`

Safari has ignored them for pinch-zoom since iOS 10. They do not prevent focus-zoom
either — only §4.1 does. In the source project shipping them cost the team a **10px
type floor** they believed was non-negotiable, for a constraint that was not real.

### 2.6 ⊢ `format-detection: telephone=no`

iOS rewrites number-like runs as `tel:` links. They take a system link colour that
overrides your palette, and tapping one offers to place a call.

### 2.7 ⊢ Install metadata is per-page, not per-site

iOS installs **whatever page is open** using **that page's** metadata. The only way to
make a page un-installable is to withhold the manifest link and the capable metas.
Test it by stripping HTML comments **first** — the explanatory comment saying
"deliberately no manifest here" otherwise trips the check.

---

## §3 — Safe area, and the keyboard

### 3.1 📱 Read `env()` exactly once, into custom properties

`env()` is a **read-only environment value with no setter and no media-query
equivalent.** Nothing in CSS or JS can assign it, and a framed document is not handed
the host's insets — so a rule that reads `env()` directly **can only ever be exercised
on hardware**, and the installed-with-insets case is exactly the one that overflows.

Reading each inset once into a custom property converts an unwritable UA input into
an ordinary style input at zero runtime cost, and lets a test drive it.

```css
:root{
  --sa-top:    env(safe-area-inset-top,    0px);
  --sa-right:  env(safe-area-inset-right,  0px);
  --sa-bottom: env(safe-area-inset-bottom, 0px);
  --sa-left:   env(safe-area-inset-left,   0px);
}
/* everywhere else: var(--sa-bottom). Never env() again. */
```

**✎ Define all four and assert exactly four.** The source asserts two, which forbids
ever handling landscape — where left/right insets are non-zero and a horizontal
layout clips.

Machine-check: the only detectable signature of a stray direct read is **lexical**, so
a grep assertion is the only guard that can fire before the regression reaches a
device.

### 3.2 📱 Budget from measured height minus chrome — never from height breakpoints

**Viewport height is not content height.** Insets plus chrome consume ~227pt of an
852pt screen. A height media query compares against the *viewport* and therefore
**cannot see the chrome**: on a 393×852 phone a `max-height:760px` query never fires,
yet the usable pane is ~625px. A column needing 700px overflows by ~76px on a device
the breakpoint calls "tall."

```css
:root{ --avail: calc(var(--app-h,100dvh) - var(--sa-top) - var(--top-h) - var(--bar-h)); }
```

One rule compacts on a phone and relaxes on a desktop, with no breakpoint to miss.

### 3.3 ⊢ `justify-content: safe center`, declared twice

Plain `center` distributes overflow to **both** sides, so an over-tall column pushes
its first item up out of the box *and* clips its last. `safe` falls back to start
alignment exactly when content does not fit.

```css
.col{justify-content:center; justify-content:safe center}
```

Two declarations are required: an engine that does not know `safe` discards that
declaration and keeps the previous one. Standard CSS error recovery, not a hack.

### 3.4 ⊢ Add the inset to a bar's height; never pad it out of a fixed height

Under `border-box` the declared height **is** the border box, so padding and border
come out of the content box. `height:60px; padding-bottom:34px` leaves ~26px of usable
bar. The inset is **extra chrome the device is demanding**, not space the bar already
had. The border must be in the sum too — a height that forgot the hairline overflows
by exactly 1px.

```css
:root{
  --bar-content:38px; --bar-pad-top:6px; --bar-keep:0px; --bar-border:1px;
  --bar-h:calc(var(--bar-content) + var(--bar-pad-top) + var(--bar-keep) + var(--bar-border));
}
.bar{height:var(--bar-h);box-sizing:border-box;
     padding:var(--bar-pad-top) 16px var(--bar-keep);border-top:var(--bar-border) solid}
.bar .fill{position:absolute;top:var(--bar-pad-top);height:calc(100% - var(--bar-pad-top));
           border-radius:12px 12px 0 0}     /* reaches the glass; top corners only */
```

**✎ Ship `--bar-keep: 0px`.** The claim that the bottom ~15px loses taps to the system
swipe recogniser is **asserted in the source and explicitly never measured**. Do not
spend 34px of a scarce axis on folklore. Raise to 8–12px only if your own device
testing shows dropped taps.

Fill and hit area are **separate concerns**: the fill wants the full frame for
continuity (a panel stopping short of the glass by exactly the inset reads as a
rendering bug), the tap target wants to stay clear.

### 3.5 ✎📱 The keyboard: the gap the source does not cover

When the keyboard opens, iOS shrinks the **visual** viewport, not the layout viewport.
A `position:fixed` bottom bar therefore stays pinned to the bottom of the *layout*
viewport — **behind the keyboard**.

```js
const vv = window.visualViewport;
const sync = () => {
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', kb + 'px');
};
vv.addEventListener('resize', sync, {passive:true});
vv.addEventListener('scroll', sync, {passive:true});
sync();
```

```css
.bar{ transform: translateY(calc(-1 * var(--kb, 0px))); }
```

`transform` on the bar is fine — but note it makes the bar a containing block for
absolutely-positioned descendants (§5.3). That is usually what you want.

**A report taken while the keyboard is up is unreadable** unless the diagnostic flags
it. §9 flags `keyboardLikely` for this reason.

### 3.6 ⊢ Publish measured height; re-measure twice after rotation

```js
const sync = () => root.style.setProperty('--app-h', app.clientHeight + 'px');
addEventListener('orientationchange', () => { sync(); setTimeout(sync, 300); });
```

The late second read is defensive: metrics are not guaranteed settled when the event
fires, and **a rotation ending at the same height fires no `resize` at all**.

**✎** The source's scepticism about `100dvh` is now excessive — `dvh` has been solid
in WebKit since 16.4, and the fault that motivated the machinery **turned out to be
the status-bar-inset fault**. Implement measured height because you want one source of
truth, not because you think `dvh` is broken.

---

## §4 — Touch and input

### 4.1 ⊢ Every focusable input gets a computed font-size ≥ 16px

iOS zooms the viewport whenever a focused field's computed font-size is under 16px.
Bumping the field removes the *reason* to zoom, which is why it works where a zoom
policy meta does not.

```css
input,textarea,select{font-size:max(16px,1rem)}
```

**✎** `max(16px,1rem)` rather than a flat `16px`, so a user's larger default is not
clamped down.

### 4.2 ⊢ Declare `touch-action` per axis on every drag surface — never once globally

A global `touch-action:none` kills scrolling everywhere and you get it back by
exception, badly. Declare the axis each surface actually wants.

**For a scroll-snap pane containing editable text:** the editor is `pan-y` so a
horizontal drag belongs to selection; the switching affordances are `pan-x`. This
resolves the swipe-vs-selection conflict **in the platform**, with no touch handlers
and no physics to tune.

### 4.3 ⊢ One scroll container per pane

A nested scroller **swallows the drag**: the inner one consumes the gesture and the
outer never sees it. If a pane needs two scrollable regions, it needs two panes.

### 4.35 ✎📱 Show a peek — a pane that fills the viewport looks like the only pane

**Reported on device:** *"I can't get it to swipe to the paired note at all, and nothing
but the primary one is visible."* Two separate causes, and the second is a design fault
rather than a bug.

**Cause 1 — the containing block.** Absolutely-positioned grab strips inside a scroll
container resolve against **the scroll container's padding box, which spans the whole
scrollable area** — not against the pane you wrote them inside. A `right: 0` strip
therefore lands at the far end of the *last* pane, and the first pane has nothing on its
right edge to grab. Give each pane `position: relative` so its strips anchor to it.
`position` on a flex child with no offsets looks inert and is load-bearing.

**Cause 2 — a pane exactly as wide as the viewport is indistinguishable from an app
that has one pane.** There is no affordance and no evidence the second thing exists.
The industry answer is the **peek**: make each pane slightly narrower than the viewport
so a sliver of its neighbour stays on screen. It does two jobs — it *shows* the pair
exists, and it gives the thumb a target.

```css
#panes { --peek: 30px; }
.pane  { position: relative; flex: 0 0 calc(100% - var(--peek)); scroll-snap-align: start; }
.pane:last-of-type { scroll-snap-align: end; }
/* strips overhang their own pane so they sit ON TOP of the neighbour's sliver —
   without the overhang the sliver belongs to the neighbouring editor, which is
   pan-y, and the drag is swallowed */
.edge   { position: absolute; top: 0; bottom: 0; width: calc(var(--peek) + 14px); touch-action: pan-x; }
.edge-l { left:  calc(-1 * var(--peek)); }
.edge-r { right: calc(-1 * var(--peek)); }
```

**The overlap trap this creates.** At the seam, pane N's right strip and pane N+1's
left strip occupy the same pixels, and the later one in DOM order wins the hit test. A
rule of *"left strip means back, right strip means forward"* then fires **the wrong
direction at exactly the pixel the user actually taps.** State the rule in terms of the
pane instead: **tapping any visible part of a pane that is not the current one goes to
that pane**; only a strip on the pane you are already on means "move along." Overlap
then cannot produce a wrong answer.

### 4.36 ✎ Snap a draggable divider to integer fractions, not to pixels

Every k/n for n in 2..5 gives nine stops. A split is then always a describable ratio —
a half, a third, two fifths — which is easier to re-hit deliberately and easier to
reason about than "roughly 47%". Snap **during** the drag, not on release: corrective
snapping feels like a bug, magnetic snapping feels like a feature.

### 4.4 ✎ Caret versus scroll-snap

A snap container holding a focused contenteditable **fights the browser's
scroll-caret-into-view**: WebKit scrolls to the caret, snap yanks it back.

- Snap on the **horizontal axis only** — never `both`.
- Consider `scroll-snap-type:none` on the container while the editor has focus.

### 4.5 ⊢ Bind drag move/up to `window`, keep `touchend` as a floor

A pointer that leaves the element never delivers `pointerup` to it. Bind to `window`.
Keep a `touchend` listener underneath as a floor — and log a gesture *stolen* by the
system separately from one *cancelled* by your own code, because they have different
causes and identical symptoms.

### 4.6 ⊢ Long-press is a timer plus `contextmenu` preventDefault

There is no long-press event. iOS fires `contextmenu` and shows the callout; you must
suppress it or your gesture and the system's fight.

### 4.7 ⊢ Grow small tap targets with a transparent inset `::after`

Enlarge the hit area without changing layout — then check the grown targets do not
overlap each other.

### 4.8 ⊢ A full-bleed decorative wrapper steals every tap in its bounds

`pointer-events:none` on the decoration, and give it back explicitly to the children
that need it.

### 4.9 ⊢ Copy-out needs three tiers

Tier 1 async clipboard → Tier 2 offscreen **readonly** textarea + `execCommand`
(readonly or iOS pops the keyboard; `setSelectionRange` is required) → **Tier 3:
select the visible text and tell the user to copy by hand.**

**✎ Tier 3 is the one that must never be omitted** — `execCommand` is deprecated and
will be the tier that eventually breaks.

**✎📱 The activation trap the source does not name:** `navigator.clipboard.writeText`
requires transient user activation, and **WebKit loses that activation across an
`await`.** The moment you compute the payload with anything async — `caches.keys()`,
`storage.estimate()`, an IndexedDB read, *i.e. exactly what a real diagnostic does* —
the write silently rejects. **Build the string before the tap**, or pass a promise to
`navigator.clipboard.write(new ClipboardItem({'text/plain': p}))`.

### 4.10 ⊢ Wrap a phone nav bar to two rows — never make it a horizontal scroller

A scroller can carry an item off-screen where the user cannot know it exists. This is
exactly what produced the "vanishing tab" report in §0.5 — and the scroller was a
*real* bug that was *not* that bug.

---

## §5 — Rendering and compositing

### 5.1 📱 One opacity per DOM branch

Group opacity composites a subtree **once**. A descendant with its own opacity
composites **twice**, so effective alpha is `a1 × a2` *at every instant* — during a
shared transition the nested element's curve is the **square** of the parent's. It
runs ahead fading out and behind fading in. Arithmetic, not easing; no timing function
corrects it. Measured: `.14 × .14 = .02`; mid-fade the nested element read `.37` while
siblings read `.61`, and `.61² = .372`.

### 5.2 📱 `isolation:isolate` on anything whose opacity animates

Hold the stacking context open so it does not collapse mid-animation and reorder
paint.

### 5.3 📱 Never dim with `filter`, and never `backdrop-filter` on an animating element

A non-`none` `filter` **becomes a containing block** and moves positioned descendants
— the element dims and its children jump. `backdrop-filter` on an element whose own
opacity animates is a documented WebKit rendering fault.

### 5.4 📱 Canvas: `min-height:0` on a flex child, size the buffer by DPR, assign `width` only when it changed

A flex child will not shrink below content without `min-height:0`. Size the backing
store by `devicePixelRatio` but **draw and hit-test in CSS pixels**. Assigning
`canvas.width` **reallocates the backing store and clears it** — only do it when the
size actually changed.

### 5.5 ⊢ Honour Reduce Motion through the same token the app already damps with

One knob, not a parallel code path that drifts.

---

## §6 — Auth on iOS: the one that silently defeats everything

### 6.1 📱-grade consequence: the installed app has its own storage container

On iOS, the same URL **in Safari** and **launched from the home screen** are two
clients with **two sandboxed stores** — separate IndexedDB, separate localStorage,
separate cookies, separate service worker. Nothing copies data at install time and
**no code you ship can read or repair the other copy**.

### 6.2 The rule: never navigate out of a standalone install

Scope is a navigation boundary. Crossing it is a **one-way trip out of the app** — the
window is handed to the browser, and anything the out-of-scope page writes lands in a
**different container than the app will read.**

**What this kills, by default, in a Supabase build:**

| Flow | Works in the installed iOS app? |
|---|---|
| OAuth (`signInWithOAuth`) | **No** — full navigation off-origin |
| Magic link | **No** — the emailed link always opens in Safari |
| **Email OTP code** | **Yes** — typed into an overlay, same document |
| **Password** | **Yes** — same |

**Consequence to tell the user once, in the UI:** installed app, Safari tab and
desktop are **three separate sessions**. Each needs its own first sign-in.

### 6.3 Build gates, logins and onboarding as overlays

Same document, no navigation, so the write lands where the read will happen.

```js
document.body.appendChild(gateEl);
window.__LOCKED__ = true;         // boot returns early while set
// on success: write, remove the overlay, boot() — never location.href = ...
```

**✎ Halt the app on a synchronous global.** An overlay only hides pixels; the app
behind it still runs, still syncs, still writes.

---

## §7 — Service worker and updates

The four measured rules here are non-negotiable. Everything else is good reasoned
architecture you may adapt.

### 7.1 📱 THE critical one: call `update()` on every foreground

**The browser's automatic update check is piggy-backed on navigation.** An installed
home-screen app is **backgrounded and resumed, never navigated** — so no navigation,
so **no update check ever runs**, so the device serves whatever build it installed,
**indefinitely**. `load` can fire once and not again for days.

`pageshow` is needed alongside `visibilitychange` because a bfcache restore does not
reliably produce a visibility transition.

**Failure mode: a deploy that is provably live on the server never arrives on the
device.** The user says "your fix didn't work" and you go debug correct code. **This
bug exists only in the installed app and cannot be discovered in development.**

### 7.2 📱 Serve every precached URL from the precache — never decide freshness per request

Each request resolves **independently**. Race cache against network per request and a
slow navigation falls back to the cached shell while its sibling scripts arrive fresh.
**Neither build is broken; the pair is.** Because unhashed files mutually assume each
other, the result is *plausible wrong behaviour*, not an exception. Nothing throws.
Nothing in telemetry moves.

This is the §0.5 bug. Freshness is a property of the **lifecycle**, never of the fetch
handler.

### 7.3 📱 Cache-first deletes your only update channel

If the navigation branch is `caches.match(shell) || fetch()`, the cache hit always
matches and the shell comes from cache forever. The worker script **is** the update
trigger; if nothing fetches it, nothing updates. Cache-first is a launch-latency
optimisation that silently removes the only channel a deploy has.

**✎ Causal ranking, because the attractive answer is wrong:** the dominant cause is
resumed-not-navigated (7.1). Host cache headers are second-order at most — and
`updateViaCache:'none'` removes them from the conversation entirely.

### 7.4 📱 Define `busy()` from what a reload would destroy — including DOM-only state

The obvious implementation asks the *input model*, because that is what your code
tracks. But the interval between "task armed and shown" and "first keystroke" is
**precisely the interval that matters**, and during it the model is empty — so the
guard reads `false` at the exact moment the user is most engaged. Gesture state has
the mirror-image blind spot: a drag exists only as a CSS class plus closure variables.

**Enumerate what a reload would destroy, then write the predicate from that list.**

### 7.5 ✎ Do not `skipWaiting()` in `install`

The source's snippet activates the new worker on install, but the page is not reloaded
until it goes idle — possibly minutes later. In that window **the old page is
controlled by the new worker backed by the new cache**, which is 7.2's mixed-build
state arrived at through the lifecycle instead of the fetch handler. The source never
closes this.

**Fix:** leave the worker `waiting`; have the page post `SKIP_WAITING` **at the moment
it has already confirmed idle**. The mixed-build window collapses from minutes to
milliseconds. Strict improvement, costs nothing.

### 7.6 ⊢ Rank reload moments; wait indefinitely

Hidden and not busy is **free** — no state cost, no visible flash. Visible but off the
work surface is acceptable. On the work surface: **never**, however long that takes.
No forcing timeout, because a forced reload is the interruption the gate exists to
prevent.

`busy()` and `onPrimarySurface()` are **different predicates and must both exist**:
one is about state destruction (always blocks), the other about visual interruption
(blocks only while visible).

### 7.7 ✎ Decouple the *notice* from the *reload*

Composing 7.6 with "suppress the notice while busy" produces a user who lives on the
work surface, is **never told an update exists**, and never receives it. Keep the
indefinite wait for the reload; let a **passive, non-modal badge** appear even while
busy. Suppress only the interrupting toast.

### 7.8 ⊢ Reload only on a controller *handover*, and latch it

`controllerchange` covers two events: the first-ever `clients.claim()` on a fresh
install, and a real handover. The discriminator is whether the page **had a controller
at script-evaluation time** — capture it **synchronously in an inline `<head>`
script**, because a deferred module can evaluate after a claim has landed and read
`true` spuriously, reintroducing the first-launch flash it exists to prevent.

### 7.9 ⊢ Poll for idleness; never hook the interaction path

If the entry path must notify the updater, every new surface must remember to — and a
missed call is a silent reload-during-work bug that only shows on a device. Poll
instead, **bounded and self-terminating**: the loop ends by reloading. Never
`setInterval` — in a test harness it keeps the event loop alive and hangs the suite.

### 7.10 ⊢ Cache name = content hash of every precached byte

A browser reinstalls a worker only when the **worker script's own bytes** differ.
Embedding a hash of the precache in that script makes an asset change **into a script
change**. A forgotten manual version bump means a byte-identical worker, **no handover
at all**, and a symptom indistinguishable from a caching bug. **Hash from disk, every
run, after any in-place patch.**

`addAll` is all-or-nothing: one 404 fails the install **loudly, while you are online**,
instead of leaving a half-cached app that works online and breaks offline — the one
state nobody tests.

### 7.11 ⊢ Never cache a cross-origin response

Opaque responses have status 0, an unreadable body, and padded quota. You cannot
distinguish success from failure, and `cache.put` will **happily store a failure you
can never inspect**. Bail **before** `respondWith` so those requests go to the network
untouched.

### 7.12 ⊢ Self-heal a stale shell exactly once, latched, prefix-filtered, online-only

Scripts are the only party that knows which shell they were written against. Declare
the DOM contract at boot; if unmet, clear caches and reload **once**.

Three corrections to the source's snippet, all real bugs:
- **Delete by prefix only.** Unfiltered `caches.keys()` deletion on a `*.github.io` origin destroys every other project you host there.
- **Require `navigator.onLine`.** Nuking the cache offline turns a cosmetically-wrong app into a blank page.
- **Write the latch *before* the reload.** After is an infinite boot loop.

If `sessionStorage` throws, assume "already tried" — **fail closed into no-reload**.

### 7.13 ⊢ Ship a visible build id, read from the live cache name

"The fix isn't there" and "the fix hasn't arrived yet" are indistinguishable from the
outside. Derive the id from `caches.keys()` — **what is running** — not from a
constant, which reports **what was deployed**. Those two disagreeing is exactly the
condition you are diagnosing, so a constant lies in the only case that matters.

### 7.14 ⊢ Put the reset page *outside* the worker's scope

A reset page inside the scope is served **by the worker you are trying to kill**.
`getRegistrations()` returns the whole origin's workers, which is what lets an
out-of-scope page reach in. **And it must be linked from inside the installed app** —
clearing site data in Safari does not touch the installed container (§6.1).

---

## §8 — Deploy

### 8.1 ⊢ The app gets its own directory; relative `scope` and `start_url`

Worker scope and manifest scope are both **the directory the app is served from**. A
sibling directory is outside it by construction. `"./"` not `"index.html"` — iOS
identifies an install by its start URL, and two spellings are two identities.

**Storage is keyed by origin, not path.** `you.github.io` is ONE origin for every repo
that account publishes: localStorage, IndexedDB, CacheStorage and the SW registration
list are shared across all of them. Path separation buys **scope**, never **storage**.
Namespace every storage key with a channel prefix.

### 8.2 ⊢ Relative paths everywhere

GitHub Pages serves a project repo at `/<repo>/`, not the root. One absolute
`/js/main.js` and the app 404s **only in production**.

### 8.3 ⊢ `.nojekyll`

Pages runs Jekyll over a branch by default and Jekyll treats leading-underscore paths
as source, never copying them. **No error anywhere** — green deploy, 404 request. For
an all-or-nothing precache this also means the worker can never install.

**✎** Inert for Actions-based deploys. Costs one empty file; keep it, but if you are
debugging a missing underscore path on an Actions deploy, this is not your culprit.

### 8.4 📱 Self-host fonts — the offline failure is minor, the metric drift is not

The offline case is boring: a fallback face. **The worse case is online.** With
`font-display:swap`, a failed fetch leaves the fallback **permanently** — pixel-identical
to what a slow-but-successful load looks like in its first second. No error, no console
message, no visual cue.

Meanwhile **every character budget is a function of glyph advance widths**, so
substituting the face changes how many characters fit **without changing one line of
your code**. Every line clamp and one-line title you sized against the real face is
now wrong, silently.

**✎ A system font stack sidesteps this entirely** and is the right default for a
one-shot.

### 8.5 ⊢ Confirm which ref the host builds, and push to it as the last step of every editing turn

### 8.6 ⊢ Assert on published bytes, never on the build script

"We self-host everything" is a property of **the output**. Exclusion happens in one
place; inlining and copying happen in several. Real case: dropping a dataset from a
script list still shipped all 1,441 rows **twice**, via two other inliners. *"Reading
the code did not catch it — grepping the output did."*

Scope the grep to attributes the browser actually fetches (`src`/`href`) and strip
comments first, or the test fires on a placeholder string in a UI label and gets
disabled by its first false positive — after which it protects nothing.

**✎ And assert that the marker the test greps for still exists in the source**, so the
test cannot silently pass forever because something was renamed.

---

## §9 — The device truth kit

**Ship this in every app, on day one.** Not when something breaks — by then you are
spending device round trips to get the instrument there.

Requirements, each tracing to a rule above:

- Renders **inside the app** (a settings pane), not only as a separate URL — the installed container may not reach a sibling page (§6.1).
- The verdict is **derived from two independent facts** and never subtracts across coordinate origins (§0.2.4–5).
- Build id from the **live cache name** (§7.13).
- The payload string is built **synchronously before the tap** (§4.9).
- **Writes nothing.** Opens IndexedDB with **no version** so it can never trigger an upgrade or a `VersionError`.
- Renders the whole payload into a visible, selectable `<pre>` so it can be copied by hand or screenshotted if every clipboard tier fails.
- Reports **its own configuration** — status-bar meta, viewport meta, both capable metas, display-mode — so a paste needs no follow-up question.
- **✎ Returns `shortfall: null` in landscape** (iOS `screen.*` does not swap on rotation, so the subtraction is meaningless) and **flags `keyboardLikely`** when the visual viewport is >80px shorter (a report taken mid-typing is otherwise unreadable).

The derivation that matters:

```js
// FACT A: how much of the screen the layout viewport does not account for
const shortfall = portrait ? (screen.height - innerHeight) : null;
// FACT B: a non-zero TOP inset proves the deficit falls at the BOTTOM
const bottomBand = (shortfall > 0 && saTop > 0) ? shortfall : 0;
```

Both obvious formulas fail: `innerHeight − rect.bottom` is **0 by construction** on a
device visibly showing a band; `screen.height − rect.bottom` is **the full shortfall by
construction** even when the box is flush. Two device round trips, both wasted.

---

## §10 — Pre-flight, before claiming any UI work is done

```
[ ] node suite green (state, data, structure only — never layout)
[ ] real-engine render at 390x844, 375x667, ~1100; screenshots diffed
[ ] no horizontal body scroll; canvases crisp at DPR 3
[ ] safe-area case exercised by overriding --sa-* off-device
[ ] keyboard case exercised by driving --kb off-device
[ ] every new persisted field name grepped and found in the writer
[ ] one test drives the real write path and reads back
[ ] built artifact grepped for anything that must not ship
[ ] pushed to the ref the host actually builds
[ ] OPEN row added: "fixed in build <hash>; UNCONFIRMED on device"
```

**A row leaves the OPEN list only when the user says done AND tested on the device.**
My tests, my screenshots and my reasoning are not the closing signal.

---

## §11 — Where I depart from the source

Recorded so a future revision can challenge me rather than rediscover the argument.

| # | Source says | I say | Why |
|---|---|---|---|
| 1 | `apple-mobile-web-app-capable` | Ship both spellings | The `apple-` prefix is deprecated; Safari warns |
| 2 | Assert `env()` appears exactly twice | Four insets, assert four | Two forbids ever handling landscape |
| 3 | Reserve the bottom inset (one snippet uses the full 34px) | `--bar-keep: 0px` | The tap-loss claim is explicitly unmeasured; 34px of a scarce axis for folklore |
| 4 | Ship `maximum-scale=1, user-scalable=no` | Delete both | Ignored since iOS 10; cost the source team a 10px type floor for nothing |
| 5 | `skipWaiting()` in `install` | Never; page posts `SKIP_WAITING` when idle | Otherwise an old page runs on a new cache for minutes — the mixed-build bug via the lifecycle |
| 6 | Suppress the update notice while busy | Suppress the *toast*; allow a passive badge | Otherwise a user who never leaves the work surface never learns an update exists |
| 7 | `caches.keys()` → delete all | Delete by prefix only | Unfiltered deletion on `*.github.io` destroys every other project on that origin |
| 8 | Self-heal unconditionally | Require `navigator.onLine` | Nuking the cache offline turns a wrong app into a dead one |
| 9 | `setTimeout` network bound | `AbortController` | The timeout rejects the promise but leaves the fetch in flight; on a flaky link they pile up |
| 10 | `reg.installing \|\| reg.waiting` after `update()` | Listen for `updatefound` with a grace window | Can be null on the tick it resolves — the button lies in the only case it exists for |
| 11 | An installed app cannot be debugged | Ask whether they have a Mac | Web Inspector has attached to home-screen apps since iOS 16.4; one cable session beats hours of copy-out |
| 12 | Unhashed sibling scripts + elaborate mixed-build defences | Content-hash asset filenames where affordable | Makes the mismatch structurally impossible rather than detected and healed |
| 13 | ⚠ Install snapshots the launch config, "no push can reach it" | Disbelieve the mechanism, keep the ritual | A cache-first SW explains every observation identically, and the project ships one. The claim says a fix is undeliverable when it may just be cached |
| 14 | ⚠ Delay network work 1500ms after resume | Keep the delay as *coalescing*; fix it with retry+backoff | Mechanism unverified; a dead socket after freeze explains it better, and a delay does not fix that — a retry does |

---

## §12 — Revision protocol

This document is a knowledge graph under construction. It gets better only if
revising it is cheap and mandatory.

**Revise after every one-shot, success or failure.** Two questions:

1. **What did the device do that I did not predict?** That is a new rule, or an
   exception to an existing one. Label it 📱 — it outranks everything reasoned.
2. **What rule did I follow that bought nothing?** Rules have a cost. A rule that
   never fired across several apps is a candidate for deletion, not a trophy.

**Rules for editing this file:**

- **A rule without a mechanism is not a rule.** If you cannot say *why* the platform behaves this way, you have a superstition with good outcomes so far. Write it as ⚠ and say so.
- **Never upgrade a confidence label without new evidence.** ⊢ becomes 📱 only when a real device produced a number.
- **Downgrade freely.** If something is contradicted, mark it and keep the old text struck through — the rejected path is what stops the next session repeating the week.
- **Record the failure that produced the rule**, not just the rule. §0.5 is worth more than any single lesson in here, and it is a story.
- **Contradictions get resolved in writing, not silently.** Six independent reviews of the source found real internal conflicts; the source was better for having them named.

### Revision log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-09-13 | Created from XENO's 181-lesson iOS field document. Deduplicated to ~90 rules, reorganised by build order, 14 departures recorded in §11, §0 epistemics and §3.5 keyboard handling added. |
| 2 | 2026-09-17 | **First device report against the guide.** Swipe-to-paired-pane failed on a real iPhone. Added §4.35 (containing block for grab strips inside a scroll container; the peek pattern; the strip-overlap direction trap) and §4.36 (fraction-snapped dividers). §4.35 is 📱 — it outranks anything reasoned. Also added: never `parseFloat` a `calc()` custom property, `getPropertyValue` returns the unresolved token stream and reads 0 (found by the device suite, present in shipped code). |
