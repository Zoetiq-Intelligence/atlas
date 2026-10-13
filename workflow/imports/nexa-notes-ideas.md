# Nexa Notes: UI ideas inventory

_Compiled 2026-10-13 for the move into Atlas. Nexa Notes is retired; this is everything from that build worth taking forward._

**64 entries** — 56 built, 5 designed but never built, 3 discussed only.

Each entry has a stable catalogue id (`NN-01`…) so you can reference one while porting — the ids are handles, not an order of work. The final section lists every request that never got done, quoted verbatim.

---

## Contents

- **Shell & chrome** (6) — The one-file skeleton everything else hangs off.
- **Editor** (19) — The rich-text surface. Parity with the reference app, plus what it was missing.
- **Panes & navigation** (16) — The part that was genuinely new — master note, parallel panes, the hover-scroll strip.
- **Persistence** (9) — Three independent tiers, each usable without the ones above it.
- **Planning surface** (6) — The roadmap / queue / kanban page that shipped inside the app.
- **Designed, never built** (5) — Specced to rebuild-grade detail. No code was written.
- **Discussed only** (3) — Raised, reasoned about, never specced.
- **Never got done** — every unfinished request, in your own words.

---

## Shell & chrome

_The one-file skeleton everything else hangs off._

### NN-01 · Single-file build pipeline

**Status:** Built

**What it does.** The whole app — markup, styles, logic, icons — compiled into one `index.html` with no build step at runtime, no CDN and no dependencies.

**Why it was good.** Deploys to any static host by copying one file. Nothing can version-skew, nothing 404s, and it works with the network off once loaded. Turned "set up GitHub Pages" into a 60-second job.

**How it worked.**

- Source lives as fragments: `src/style.css`, `src/body.html`, and `src/js/*.js` in a fixed numeric order (00_util, 10_store, 20_math, 30_editor, 40_ui, 50_sync, 60_plan_seed, 70_plan, 80_boot).
- `build.py` reads a template with three placeholders — `/*__STYLE__*/`, `<!--__BODY__-->`, `/*__SCRIPT__*/` — and substitutes.
- Any literal `</script>` inside JS is rewritten to `<\/script>` or it terminates the inline block early.
- The build then asserts: exactly one `<script>` tag, no unreplaced placeholders, and a few named functions present. It refuses to emit a broken page.
- Result was ~216 KB uncompressed, ~4000 lines, which gzips to roughly a quarter of that over HTTP.

### NN-02 · Four-row grid shell

**Status:** Built

**What it does.** Header, toolbar, pane strip and main area as named grid areas, with the sidebar spanning the bottom two rows.

**Why it was good.** One grid declaration handles desktop and collapses to mobile with a single column change. No JavaScript layout math anywhere, so nothing jitters on resize.

**How it worked.**

- `grid-template-areas: "head head" "tbar tbar" "nav strip" "nav main"` with rows `auto auto auto 1fr`.
- Columns are `var(--nav-w, 264px) 1fr`; `.nav-collapsed` sets the first to `0`.
- Height is `100dvh`, with a `-webkit-fill-available` fallback inside `@supports(-webkit-touch-callout:none)` so iOS Safari does not jump when its bars hide.
- `padding-top: env(safe-area-inset-top)` on the shell; toasts and the backup nag use the bottom inset.

### NN-03 · Token-first dual theme

**Status:** Built

**What it does.** Complete dark and light palettes as CSS custom properties, flipped by one header button.

**Why it was good.** Every component reads tokens, so adding a theme is ~25 lines and it is structurally impossible to end up half-themed. Also made the "master note is gold" accent a single variable rather than a colour sprinkled through the stylesheet.

**How it worked.**

- Full dark palette on bare `:root`: `--bg`, `--bg-2..4`, `--panel`, `--head`, `--tx`, `--tx-2/3`, `--bd`, `--bd-2`, `--acc`, `--master`, `--ok/warn/bad`, `--sel`, `--shadow`, `--r`.
- `html[data-theme="light"]` redefines only the tokens — no component rules repeated.
- `applyTheme()` stamps `data-theme` on `<html>`, swaps the sun/moon icon, and updates the `color-scheme` meta so form controls and scrollbars follow.
- Note for Atlas: if the host also stamps `data-theme` (artifact viewers do), the app's own boot-time stamp must win or you get a flash of the wrong palette.

### NN-04 · Save-state chip

**Status:** Built

**What it does.** A small pill in the header reading Saved / Saving… / Synced / Storage full, with a coloured status dot.

**Why it was good.** A local-first app has no network spinner to borrow, so there is nothing telling you whether your words are safe. This is the one place that answers it, and it costs almost nothing. The amber pulse while a debounce is pending is what makes the autosave legible instead of mysterious.

**How it worked.**

- `setSaveState(s)` writes `data-state` onto `#sync-chip`; CSS colours the dot (grey/amber/green/red) and animates `pulse` on `dirty`.
- Label becomes "Synced" rather than "Saved" when Supabase is configured, so the two tiers are distinguishable at a glance.
- Clicking the chip opens Settings — the chip is the entry point to everything storage-related.

### NN-05 · Inline SVG sprite with attribute-sized icons

**Status:** Built

**What it does.** One hidden `<svg>` holding every `<symbol>`; a helper builds `<svg><use href="#i-name">` on demand.

**Why it was good.** No network requests for icons, recolourable through `currentColor`, one definition per glyph. The sizing detail below is the part worth carrying over — it shipped as a visible bug first.

**How it worked.**

- `ico(id, size)` sets `width`/`height` as **attributes**, not inline styles.
- An unsized inline SVG balloons to the 300×150 replaced-element default. This actually happened: giant chevrons overlapped the sidebar until the default was added.
- Attributes (unlike inline styles) still lose to CSS, so wrapper rules can override per context.
- Paired with `.caret>svg,.pin>svg{width:100%;height:100%}` for fixed-size wrapper spans.

### NN-06 · Boot-time integrity repair

**Status:** Built

**What it does.** `ensureIntegrity()` runs on every load and repairs any structurally impossible state before the UI renders.

**Why it was good.** A local-first app has no server to re-fetch truth from. One corrupt write would otherwise be permanent and fatal. This made "the app cannot fail to boot" an actual property rather than a hope.

**How it worked.**

- Guarantees at least one group exists; reassigns orphaned notes to the first group.
- Guarantees exactly one master note: if the recorded id is missing or deleted, promotes any note flagged `isMaster`, and failing that re-creates the master from seed.
- Normalises every note: numeric `rev` and `order`, string `html`.
- Filters panes down to live notes, drops duplicates, caps at six, clamps `activePane` into range.
- Called again after every import and sync, not just at boot.

---

## Editor

_The rich-text surface. Parity with the reference app, plus what it was missing._

### NN-07 · Two-row toolbar mirroring the reference

**Status:** Built

**What it does.** Row one: B/I/U/S, blockquote, inline code, code block, ordered/bulleted/checklist, outdent/indent, alignment menu, attach/image/video, overflow. Row two: font family, size, text colour, highlight, sub/superscript, formula, clear formatting.

**Why it was good.** Matching the reference exactly meant zero relearning. The grouping also happens to be Quill's default full toolbar, which turned out to be the key to the whole port (see NN-30).

**How it worked.**

- Buttons are `<button class="tb" data-cmd="…">`; the toolbar has one delegated click listener that dispatches through `runCmd(cmd, val)`.
- Menus are `data-menu="align|more|fore|hilite"` and open popovers instead of firing a command.
- The two `<select>`s are wrapped in `.tb-sel` with a custom up/down chevron pair, reproducing the reference's spinner look without a custom dropdown.
- Rows scroll horizontally with hidden scrollbars rather than wrapping, so the toolbar never changes height.

### NN-08 · Selection-preserving toolbar

**Status:** Built

**What it does.** Clicking any toolbar control applies to the text you had selected, including on the second and third click in a row.

**Why it was good.** This is the single most common way a hand-rolled rich text toolbar breaks, and the failure is silent — the button looks like it worked. It shipped broken and the test suite caught it: bold → italic → colour lost the colour.

**How it worked.**

- `#toolbar` has a `mousedown` listener calling `preventDefault()` for `.tb` targets, so focus never leaves the editor.
- The editor stashes its live Range into a `WeakMap` on `blur`, `keyup` and `mouseup` (`stashSel`).
- `runCmd` calls `restoreSel` first, then re-asserts `styleWithCSS` (Chrome resets it per selection in some builds).
- **The fix that mattered:** `runCmd` calls `stashSel` again *after* the command. `execCommand` rewrites the DOM, which invalidates the range you just restored; without re-stashing, the next chained command applies to nothing.

### NN-09 · Quill-compatible checklist with offsetX hit-testing

**Status:** Built

**What it does.** Checkbox list items whose box is clickable without any `<input>` in the document.

**Why it was good.** Real `<input type=checkbox>` or `contenteditable=false` spans inside a contenteditable cause caret bugs that are miserable to chase. The pseudo-element trick has none of them, and it serialises to clean markup that survives copy-paste.

**How it worked.**

- Markup is `<ul data-list="check"><li data-checked="false">`. The box is a `::before` positioned at `left:-1.42em`, outside the list item's content box.
- The click handler tests `e.offsetX < 0` — negative means the click landed on the pseudo-element in the padding, not on the text. Borrowed from Quill.
- Checked state is a data attribute, so it round-trips through `innerHTML` with no hydration step.
- `[data-checked="true"]` gets strikethrough and muted colour; the box fills with an inlined SVG tick as a `background-image` data URI.
- Pressing Enter inside a checklist item creates the next item unchecked (a `setTimeout(…, 0)` after the default Enter, since execCommand has not run yet).

### NN-10 · Caret-safe markdown autoformat

**Status:** Built

**What it does.** Typing `[] `, `[x] `, `# `, `## `, `### `, `> `, `- `, `1. `, ```` ``` ```` or `---` at the start of a line converts it.

**Why it was good.** The fastest path to structure without reaching for the toolbar. The implementation detail below is the whole lesson — the naive version silently ate the previous paragraph.

**How it worked.**

- On `input`, read `currentBlock(ed).textContent` and match against an ordered rule list.
- **The bug:** clearing the block with `b.textContent = ''` drops the caret. `execCommand('insertUnorderedList')` then reaches backwards and swallows the preceding paragraph into the new list. It produced invalid `<p><ul>…</ul></p>` and lost text permanently on reload.
- **The fix:** `clearBlockForCommand(b)` sets `b.innerHTML = '<br>'` and explicitly parks a collapsed Range at `(b, 0)` before the command runs, so the command acts on that block alone.
- `[x] ` runs the checklist command then sets `data-checked="true"` on the resulting item.

### NN-11 · Font size via font[size=7] rewrite

**Status:** Built

**What it does.** A Small/Normal/Large/Huge dropdown that produces real pixel sizes instead of legacy HTML size buckets.

**Why it was good.** `execCommand('fontSize')` only accepts 1–7 and emits `<font>`. This gets arbitrary sizes out of a battle-tested command without hand-rolling range wrapping.

**How it worked.**

- Call `execCommand('fontSize', false, '7')` — 7 is a sentinel nobody uses.
- Immediately query `font[size="7"]` within the editor and replace each with a `<span style="font-size:Npx">`, moving children across.
- The same trick with `fontName` and a `__NEXA__` sentinel handles font family.
- When the selection is collapsed, the family change instead sets `--ed-font` on the editor and stores it on the note, so it becomes that note's default.

### NN-12 · Colour & highlight swatch popovers

**Status:** Built

**What it does.** Grid of swatches for text colour and highlight, each ending with a "none" tile that strips the property.

**Why it was good.** Most editors let you add a highlight and then give you no way to remove it without nuking all formatting. The "none" tile plus the cleanup pass fixes that.

**How it worked.**

- Eleven foreground colours, eight highlights, drawn as a `repeat(8,1fr)` grid of 22px buttons.
- The "none" tile is a diagonal red slash drawn with a CSS gradient on `::after`.
- Highlight uses `hiliteColor` with a `backColor` fallback for engines that only implement the latter.
- "None" applies `transparent`, then `cleanupTransparent()` walks `[style]` nodes, deletes `background-color: transparent`, drops now-empty `style` attributes, and unwraps bare `<span>`s — otherwise the document accretes dead spans.
- The toolbar button's own underline bar updates to the last colour used, so re-applying is one click.

### NN-13 · Self-contained mini-TeX renderer

**Status:** Built

**What it does.** The `fx` button renders LaTeX-ish maths — `^`, `_`, `\frac`, `\sqrt`, `\text`, `\left/\right`, ~50 greek letters and ~90 operators — in about 180 lines with no library.

**Why it was good.** KaTeX is ~280 KB and a CDN dependency, which would have broken both the one-file rule and offline use. Hand-rolling the 90% of notation that actually appears in notes was cheaper than either. This is the piece I would most want carried into Atlas intact.

**How it worked.**

- Recursive-descent parser: `expr := scripted*`, `scripted := atom (("^"|"_") arg)*`, `atom := group | command | char`. Consecutive sup/sub fold onto one node so `x^a_b` is a single script node.
- Renders to DOM, not a string: `\frac` is a flex column with a `border-bottom` between numerator and denominator; `\sqrt` is a radical glyph plus a `border-top` on the body; scripts are an inline-flex column with tuned `vertical-align` per sup-only / sub-only / both.
- Single latin letters are auto-italicised as variables; digits and commands stay upright; known function names (`sin`, `log`, `lim`…) render upright; big operators (`\sum`, `\int`) scale to 1.32em.
- Unknown commands fall back to their own name rather than throwing, so a typo degrades instead of blanking.

### NN-14 · Re-editable formula chip

**Status:** Built

**What it does.** A rendered formula stays clickable; clicking reopens the editor with the original source.

**Why it was good.** Rendered maths is normally a dead end — you delete and retype. Keeping the source on the node makes formulas behave like text.

**How it worked.**

- `<span class="mathx" contenteditable="false" data-tex="…">` holds the source; the rendered DOM is its children.
- On save, `serializeHTML` **empties** the chip — only `data-tex` is stored. On load, `hydrateMath` re-renders from source.
- That means a renderer improvement retroactively fixes every formula ever written, and the stored note stays small.
- The insert dialog has a live preview and a row of one-click snippets (`\frac{a}{b}`, `\sqrt{x}`, `x^{n}`, `\sum_{i=1}^{n}`, greek, operators) that insert at the caret.

### NN-15 · Paste sanitiser with an allowlist

**Status:** Built

**What it does.** Pasted HTML is filtered through tag, attribute and CSS-property allowlists before it enters the document.

**Why it was good.** Pasting from Word or a web page is how a rich text editor normally fills with junk spans, foreign fonts and occasionally script. Allowlist rather than blocklist means new junk is excluded by default.

**How it worked.**

- Three sets: `OK_TAGS` (~30), `OK_ATTR` (~20, including the app's own `data-list` / `data-checked` / `data-asset` / `data-tex`), and `OK_CSS`, a regex of ~11 permitted declarations.
- Unknown elements are **unwrapped**, not dropped, so their text survives. Only `SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|NOSCRIPT|SVG|MATH` are removed outright.
- `href`/`src` are checked against `javascript:`/`vbscript:`/`file:`; `on*` attributes are stripped wholesale; `url(` and `expression` are rejected inside style values.
- Every surviving `<a>` gets `target="_blank"` and `rel="noopener noreferrer"`.
- Runs on paste *and* on load, so a note hand-edited in a backup file cannot inject anything either.

### NN-16 · IndexedDB asset store with data-asset references

**Status:** Built

**What it does.** Images and attachments live in IndexedDB as real Blobs; the note HTML references them by id.

**Why it was good.** Base64 images inside a ~5 MB `localStorage` quota kill the app after a handful of screenshots. Splitting the stores is the difference between "notes app" and "notes app until you paste a picture".

**How it worked.**

- Insert creates `{id, name, type, blob, created}` in an `assets` object store; metadata (minus the blob) is mirrored into app state for size accounting.
- The document holds `<img data-asset="ID">`. On save, `serializeHTML` **strips the `src`**; on load, `hydrateEditor` looks up the blob and sets an object URL. Object URLs are memoised in a `Map`.
- A missing asset renders as a dashed "image missing from this device" chip rather than a broken image.
- If IndexedDB is unavailable (private browsing), it degrades to an inline data URL on the metadata record and warns.
- JSON backup re-inlines every blob as base64, so a backup is genuinely complete.

### NN-17 · Image downscale on insert

**Status:** Built

**What it does.** Images over 1800px on the long edge, or over ~700 KB, are re-encoded before storage.

**Why it was good.** A phone screenshot is 3–8 MB. Thirty of them is a dead workspace. Doing this at insert time means the user never has to think about it.

**How it worked.**

- `createImageBitmap` → canvas at the scaled size → `toBlob` at quality 0.86, PNG preserved as PNG, everything else to JPEG.
- Keeps the original if the re-encode came out larger, and skips SVG and GIF entirely.
- Wrapped in try/catch returning the original file, so an unsupported format never blocks the insert.

### NN-18 · Attachment chip

**Status:** Built

**What it does.** Non-image files insert as an inline pill showing a paperclip, the filename and its size; clicking downloads it.

**Why it was good.** Keeps a file visible in the flow of the text instead of hiding it in a separate attachments tray, which is where attachments go to be forgotten.

**How it worked.**

- `<span class="att" contenteditable="false" data-asset data-name data-size>` with the icon, name and size as children.
- Click handler resolves the blob from IndexedDB and triggers a download; if the blob is absent it says so rather than failing silently.
- 25 MB per-file ceiling, checked before the read.

### NN-19 · Video embed node

**Status:** Built

**What it does.** A URL from YouTube, Vimeo or a direct media file becomes a responsive 16:9 player inline.

**Why it was good.** Storing video locally would destroy the quota; referencing it keeps notes small. Being explicit that it streams (and therefore needs a connection) avoided a surprise later.

**How it worked.**

- `embedURL()` pattern-matches to `{kind:"iframe"|"video", src}` — YouTube is rewritten to `youtube-nocookie.com/embed/<id>`, Vimeo to `player.vimeo.com/video/<id>`.
- Stored as `<div class="vid" contenteditable="false" data-src="…">` with the iframe **emptied on save** and rebuilt on load, so no stale embed markup is ever persisted.
- Container is `aspect-ratio: 16/9` with `overflow:hidden`, so no layout shift as the frame loads.

### NN-20 · normalizeBlocks safety net

**Status:** Built

**What it does.** Before every save, block-level elements that ended up nested inside a `<p>` are lifted out.

**Why it was good.** `<p><ul>…</ul></p>` is invalid, and the HTML parser silently rearranges it on the *next* load — so the note reshuffles itself between sessions and the user cannot tell why. A cheap pass turns a class of invisible corruption into a non-event.

**How it worked.**

- Loop on `ed.querySelector('p > ul, p > ol, p > pre, p > blockquote, p > table, p > h1, p > h2, p > h3, p > hr')`, move the match after its parent, and delete the parent if it is now empty of text and rich nodes. Guarded at 80 iterations.
- Explicitly a safety net, not the fix — the real fix was NN-10. Keep both: the net catches whatever the next command bug produces.

### NN-21 · List-aware code block toggle

**Status:** Built

**What it does.** Toggling a code block from inside a list item puts the block *after* the list instead of inside it.

**Why it was good.** `<pre>` inside `<ul>` is invalid and destroyed the list item's content. Found by the test suite, not by reading.

**How it worked.**

- With a selection: wrap the selected text in `<pre><code>`.
- Collapsed inside an `<li>`: find the ancestor list, insert the `<pre>` after it, and remove either the item or the whole list if that item was the only one.
- Collapsed elsewhere: replace the current block.
- Toggling off replaces the `<pre>` with a `<p>` carrying its `textContent`.

### NN-22 · Non-list indent via margin steps

**Status:** Built

**What it does.** Tab indents list items by nesting, and ordinary paragraphs by a measured margin step.

**Why it was good.** `execCommand('indent')` on a paragraph produces a `<blockquote>` in several engines — visually wrong and semantically a lie. Stepping the margin does what the user meant.

**How it worked.**

- Inside an `<li>`: `execCommand('indent'|'outdent')`.
- Otherwise: read `parseInt(block.style.marginLeft) || 0`, add ±28px, clamp to 0–280, and remove the `style` attribute entirely when it returns to zero.
- Bound to Tab / Shift-Tab with `preventDefault`, so Tab never escapes the editor.

### NN-23 · Auto-derived note title with a lock

**Status:** Built

**What it does.** A note titles itself from its first non-empty line until you type a title yourself, after which it stops.

**Why it was good.** Naming things is friction, and most notes never get named. Deriving the title means the sidebar is always readable; the lock means an explicit name is never clobbered.

**How it worked.**

- `deriveTitle(ed)` returns the first child element with non-whitespace text, collapsed and truncated to 72 chars.
- `afterEdit` applies it only when `!note.titleLocked`.
- Typing in the pane header's title input, or renaming from the context menu, sets `titleLocked = true` permanently.
- Title changes propagate to the sidebar row, the pane chip and any other pane showing the note — skipping the input that currently has focus, so it does not fight the typist.

### NN-24 · Empty-state placeholder

**Status:** Built

**What it does.** An editor holding only an empty paragraph shows its prompt text.

**Why it was good.** `:empty` does not match an editor containing `<p><br></p>`, which is what a contenteditable actually looks like when empty — so the obvious CSS approach shows nothing, ever.

**How it worked.**

- `updateEmpty(ed)` strips whitespace and zero-width characters from `textContent` and also checks for `img, .att, .vid, .mathx, table, hr, pre`; toggles an `is-empty` class.
- `.ed.is-empty::before { content: attr(data-ph); position: absolute; }` — absolute so the pseudo-element never enters the editable flow or affects the caret.
- Called on input, on build, and after every edit.

### NN-25 · Per-note HTML export

**Status:** Built

**What it does.** Any single note exports as a standalone, styled `.html` file.

**Why it was good.** An escape hatch that needs no importer. Checkboxes survive as real glyphs, so the file reads correctly anywhere — including printed.

**How it worked.**

- Wraps `note.html` in a minimal document with an inline stylesheet.
- Checkbox state is reproduced with `::before { content: "\2610" }` and `"\2611"` for checked, plus strikethrough — no scripting, no app required.
- Filename is the title with non-word characters replaced, capped at 60 chars.

---

## Panes & navigation

_The part that was genuinely new — master note, parallel panes, the hover-scroll strip._

### NN-26 · Master note

**Status:** Built

**What it does.** One designated catch-all note, pinned at the top of the sidebar in gold, that cannot be deleted and can be reassigned to any other note.

**Why it was good.** The thing a daily notes app is actually for is one long running scratchpad — the task queue, the meeting notes, the half-thought. Making it a first-class, structurally protected object rather than "whichever note you happened to pin" is what made the app feel like it had a centre.

**How it worked.**

- `S.masterId` plus an `isMaster` flag on the note; `ensureIntegrity()` reconciles them on every load and re-creates the note from seed if it is ever missing.
- `deleteNote` refuses outright with an explanation rather than hiding the control.
- `setMaster(id)` demotes the old one and promotes the new in one step.
- Gold `--master` token distinguishes it in the sidebar row, the pane chip, the pane title and the pane's focus rule.

### NN-27 · Master-never-evicted invariant

**Status:** Built

**What it does.** Opening a note never replaces the pane the master note is in; it opens alongside instead.

**Why it was good.** Shipped without this and it was immediately wrong: clicking "New note" silently replaced whatever you were reading, which for most people was the master. Making it an invariant rather than a special case in one handler meant every entry point got it for free.

**How it worked.**

- In `openNote`: if the active pane holds the master, force `wantNewPane`.
- If all six panes are taken, reuse the **last pane that is not the master**, scanning backwards.
- If the only pane is the master, a new note always adds a second pane.

### NN-28 · One-pane-per-note invariant

**Status:** Built

**What it does.** A note can only be open in one pane; asking for it again focuses the pane that has it.

**Why it was good.** Two contenteditables bound to one note race each other on save — the losing editor's `afterEdit` overwrites the winner's text with its own stale DOM. Rather than build a reconciliation layer for a feature nobody had asked for, the state was made unrepresentable.

**How it worked.**

- `openNote` checks `S.panes.findIndex(p => p.noteId === id)` *before* anything else and focuses on a hit.
- `ensureIntegrity` deduplicates panes by `noteId` on load, so an old saved state cannot reintroduce the problem.
- Documented as a deliberate deferral — side-by-side views of one long note is a real want, it just needs a shared document model first.

### NN-29 · Parallel panes

**Status:** Built

**What it does.** Up to six side-by-side note columns, each with its own title field, word count, last-edited stamp and controls. Draggable dividers; widths persist.

**Why it was good.** The actual reason to build a new notes app. Comparing a meeting note against the task queue, or drafting beside a reference, is the whole workflow — and tab-switching destroys it.

**How it worked.**

- `S.panes = [{id, noteId, w}]`; `renderPanes()` rebuilds the row. Panes with a stored `w` get `flex: 0 0 Npx`, the rest `flex: 1 1 0`.
- The focused pane is tracked as `S.activePane`, marked with a 2px coloured top rule (gold if it is the master) — the toolbar always acts on it.
- Resize drags adjust the two adjacent panes together, clamped to a 220px minimum each, writing both widths on mouseup.
- Opening a note without an explicit width resets every `w` to null so the row redistributes evenly.

### NN-30 · Quill-shaped document model

**Status:** Built

**What it does.** Checklists, lists and inline formats serialise to the same structures Quill produces.

**Why it was good.** The reference app was almost certainly a Quill build — its toolbar is Quill's full default set, right down to the `fx` formula button sitting beside video embed, which nothing else ships by default. Matching the output structure meant existing notes could be pasted across and behave identically rather than merely similarly.

**How it worked.**

- Checklists are `<ul data-list="check">` with `<li data-checked>`, matching Quill's delta representation.
- The `offsetX < 0` checkbox hit test is Quill's own technique (NN-09).
- Inline formats are CSS spans via `styleWithCSS`, not legacy `<font>` tags, which is what Quill emits too.
- Worth re-checking before porting: this was inferred from the toolbar fingerprint, never confirmed against the actual site.

### NN-31 · Pane chip strip

**Status:** Built

**What it does.** A horizontal row of chips above the panes — one per open pane — showing title, a pin for the master, and a close button.

**Why it was good.** With six panes the headers alone do not tell you what is open once they are narrow. The strip is the one always-legible index of your working set, and it doubles as the reorder surface.

**How it worked.**

- Chips carry `data-pane`; the active one takes the accent, the master a gold border.
- Click focuses; the × closes; chips are `draggable` and drop onto each other to reorder (`drop-l`/`drop-r` classes show the insertion edge from the pointer's half of the chip).
- Dropping a **note** from the sidebar onto a chip opens it as a new pane at that index — one gesture from "in the list" to "open third from left".

### NN-32 · Hover side-scroll with a proximity ramp

**Status:** Built

**What it does.** Moving the pointer near either end of the chip strip scrolls it horizontally, faster the closer you get to the edge. No dragging, no scrollbar, no click.

**Why it was good.** The feature as specified, and the most satisfying thing in the build. A horizontal scrollbar on a 38px strip is a fiddly target; wheel-scrolling a horizontal container is unreliable across platforms. Hover-scroll makes the whole edge the control.

**How it worked.**

- `HOT = 62px` hot zone, `MAXV = 15px/frame` ceiling.
- On `mousemove` over the wrapper, compute distance to each edge; velocity is `MAXV * (1 - clamp(d,0,HOT)/HOT)`, signed by which edge — so it eases in rather than snapping to full speed.
- A `requestAnimationFrame` loop runs only while velocity is non-zero and cancels itself on `mouseleave`, `mousedown`, or when the content stops overflowing.
- Velocity is forced to zero when `scrollWidth - clientWidth < 4`, so a non-overflowing strip is inert.
- **Tuning note:** the ramp constants are the subjective part. 62/15 felt right on a 1440px display and was flagged in the queue for retuning after real use.

### NN-33 · Conditional edge affordances

**Status:** Built

**What it does.** Gradient fades with chevrons appear at the strip's ends — but only when there is actually something to scroll to, and they tint to the accent colour while scrolling is happening.

**Why it was good.** A permanent gradient is decoration and teaches nothing. One that appears exactly when content is hidden is information. The accent tint confirms the hover-scroll is engaged, which the motion alone does not when the strip is nearly full.

**How it worked.**

- `updateEdges()` toggles a `show` class per side from `scrollLeft` and `scrollWidth - clientWidth`, called on scroll, resize and every strip re-render.
- A `hot` class adds the accent colour while velocity is non-zero.
- Each edge is also clickable, scrolling one 220px page smoothly — the keyboard/touch fallback for a hover-only interaction.

### NN-34 · Wheel-to-horizontal on the strip

**Status:** Built

**What it does.** A vertical wheel gesture over the chip strip scrolls it sideways.

**Why it was good.** Hover-scroll does not exist on a trackpad user's muscle memory, and horizontal wheel is a two-finger gesture many mice cannot make. Cheap second route to the same place.

**How it worked.**

- Non-passive `wheel` listener; if `|deltaY| > |deltaX|` and the strip overflows, `preventDefault()` and add `deltaY` to `scrollLeft`.
- Defers to genuine horizontal input so trackpad swipes still work normally.

### NN-35 · Accordion sidebar

**Status:** Built

**What it does.** Collapsible note groups that animate open and closed, with counts, inline "new note here", and right-click rename/delete.

**Why it was good.** Flat note lists stop working at about thirty notes. The animation detail below is what makes it feel built rather than toggled.

**How it worked.**

- Animated with `grid-template-rows: 0fr → 1fr` on the body wrapper, with `overflow:hidden; min-height:0` on the inner div.
- That transitions to *content height* without measuring anything in JS — no `scrollHeight` reads, no layout thrash, no wrong height after the content changes.
- Collapse state persists per group. The caret rotates 90°.
- The "+" on a group header appears on hover and creates a note directly into that group.

### NN-36 · Search that force-expands matching groups

**Status:** Built

**What it does.** The sidebar search filters on titles *and* body text, and any group containing a hit opens automatically while the query is active.

**Why it was good.** Filtering a collapsed accordion normally hides the results you just matched — the classic broken-search bug. Expanding on match makes the search actually usable, and collapsing back when cleared preserves the user's arrangement.

**How it worked.**

- Match is title substring OR `stripTags(note.html)` substring, both lowercased.
- While a query is present, the open state is forced true rather than read from the group record — so the stored collapse state is untouched and returns when the query clears.
- Groups with zero matches are hidden entirely; a zero-result state names the query and says search covers body text.
- Debounced at 140ms.

### NN-37 · Drag notes between groups

**Status:** Built

**What it does.** Notes drag from the list onto any group header to re-file them.

**Why it was good.** Re-filing through a context menu is three clicks and a read; dragging is one gesture. The drop target being the header (not the body) means it works on a collapsed group too.

**How it worked.**

- `dragstart` sets a custom MIME type `text/nexa-note` with the note id — distinct from `text/nexa-pane` and `text/nexa-card` so the three drag systems never cross-trigger.
- Group headers highlight on `dragover` and expand on drop.
- The same `text/nexa-note` payload is accepted by the pane strip (NN-31), so one drag source has two meaningful destinations.

### NN-38 · Container-query pane headers

**Status:** Built

**What it does.** A narrow pane drops its word count, then its secondary button, rather than crushing the title to an ellipsis.

**Why it was good.** Six panes on a laptop means ~330px each. Media queries cannot help — the viewport is wide, the *pane* is narrow. This is exactly what container queries are for, and the before/after was stark: titles went from "A lo…" to fully readable.

**How it worked.**

- `container-type: inline-size` on `.pane`.
- `@container (max-width:420px) { .pane-h .meta { display:none } }` and `(max-width:250px)` drops the options button.
- Title input needs `flex: 1 1 40px; min-width: 0` or its intrinsic input width wins and it never shrinks gracefully.

### NN-39 · Flush-before-rerender

**Status:** Built

**What it does.** Any re-render of the pane row commits pending edits from the editors it is about to destroy.

**Why it was good.** `afterEdit` is debounced ~260ms. Open a note within that window and the pending callback fires against a detached editor — at best a wasted write, at worst a stale overwrite of a note the new editor has already touched. One of the subtle, intermittent, impossible-to-report bug classes.

**How it worked.**

- `renderPanes()` starts with `afterEditDeb.cancel()`, then synchronously calls `afterEdit` on every live `.ed` whose note still exists.
- Clears `activeEd` if it is no longer in the document.
- The debounce helper exposes `.cancel()` and `.flush()` for exactly this.

### NN-40 · Note picker

**Status:** Built

**What it does.** A filter-as-you-type modal listing notes, master first then most-recently-edited, showing each note's group.

**Why it was good.** Once there are panes, "which note goes here" needs an answer that is not scrolling the sidebar. Enter opens the top hit, so it is a keyboard path end to end.

**How it worked.**

- Capped at 60 results; Enter clicks the first row.
- Reused by three callers — add pane, replace a pane's note, split right — by passing a different `onPick` callback.

### NN-41 · Mobile: drawer, scroll-snap panes, 16px floor

**Status:** Built

**What it does.** Under 860px the sidebar becomes a slide-over with a scrim, panes become full-width scroll-snap pages, and editor text is forced to at least 16px.

**Why it was good.** Panes are a pointer-and-width idea; on a phone the honest translation is swipeable pages. The 16px floor is not cosmetic — below it, iOS Safari zooms the whole page when an input takes focus, which feels broken and is hard to diagnose.

**How it worked.**

- `#nav` becomes `position:fixed` with `transform: translateX(-102%)`, revealed by `.nav-open`; the scrim is an `::after` on the shell, dismissed by a tap.
- `#panes` gets `scroll-snap-type: x mandatory`; panes get `flex: 0 0 100%; scroll-snap-align: start`.
- `font-size: max(16px, var(--ed-size))` on the editor.
- Resizers and hover-scroll are disabled rather than left to misfire on touch.

---

## Persistence

_Three independent tiers, each usable without the ones above it._

### NN-42 · Three-tier persistence ladder

**Status:** Built

**What it does.** Tier 1 this browser, tier 2 a JSON file you download, tier 3 your own Supabase project. Each works without the ones after it.

**Why it was good.** The structure was the specification and it held up. It means there is never a moment where the app is unusable because a higher tier is not configured, and the user can stop climbing whenever they are satisfied — a single "sign in to sync" wall would have made the app useless until that was done.

**How it worked.**

- Tier 1 is automatic and unconditional. Tier 2 needs one click and no account. Tier 3 needs a project and is entirely optional.
- The save-state chip (NN-04) reports which tiers are live.
- Each tier's failure mode is contained: quota exhaustion does not stop backups, a sync failure does not stop local saves.

### NN-43 · localStorage / IndexedDB split

**Status:** Built

**What it does.** Text and structure in `localStorage`; binary in IndexedDB.

**Why it was good.** The right split, and worth stating as a rule: `localStorage` is synchronous, string-only and ~5 MB, which makes it perfect for a note tree and catastrophic for images.

**How it worked.**

- Whole app state serialises to one `localStorage` key, debounced at 420ms, flushed on `visibilitychange` and `beforeunload`.
- Config and credentials live under a *separate* key so a state reset does not log you out of sync.
- Blobs go to IndexedDB with a thin promise wrapper (~40 lines) that marks itself permanently broken on first failure rather than retrying forever.

### NN-44 · Quota-exceeded blocking dialog

**Status:** Built

**What it does.** When a write fails, a modal says the edits on screen are **not saved**, offers an immediate backup, and shows a live storage breakdown.

**Why it was good.** The default behaviour of a storage-full `localStorage` app is to silently stop saving while continuing to look fine. That is the worst failure mode in the whole category, and it is a try/catch away from being survivable.

**How it worked.**

- Every write is wrapped; on throw, state goes to `error`, the chip turns red, and the dialog opens once (latched).
- The dialog cannot be dismissed by clicking the scrim.
- `beforeunload` sets `returnValue` while in the error state, so closing the tab warns.
- The breakdown uses `navigator.storage.estimate()` plus actual byte counts for notes and assets.

### NN-45 · Backup nag with three triggers

**Status:** Built

**What it does.** A non-blocking bar offering a one-click backup, triggered by edit count, elapsed time, or never having backed up at all.

**Why it was good.** Local-first means the user is the backup strategy, and they will not remember. Three triggers catch three different usage patterns — the heavy day, the slow month, and the person who never started.

**How it worked.**

- Fires at 60 edits since last backup (configurable), or 7 days, or 25 edits with no backup ever.
- Wording names the specific reason — "43 edits since your last backup" beats a generic reminder.
- "Later" resets the counter rather than snoozing a timer, so it does not immediately re-fire.
- Appears bottom-centre with safe-area padding; never blocks input.

### NN-46 · Remembered backup file handle

**Status:** Built

**What it does.** On browsers with the File System Access API, the first backup asks where to save and every later one writes there silently.

**Why it was good.** The second backup being zero-friction is what turns backups from a thing you did once into a habit. Falls back cleanly where the API does not exist, which includes all of iOS.

**How it worked.**

- `showSaveFilePicker()` once; the `FileSystemFileHandle` is stored **in IndexedDB** (handles are structured-cloneable, so this survives reloads).
- Each backup re-checks `queryPermission({mode:"readwrite"})` and re-requests if needed; a denial falls through to a normal download.
- `AbortError` (user cancelled the picker) is distinguished from a real failure.
- A "Change backup file" action in Settings forgets the handle.

### NN-47 · Merge-vs-replace restore

**Status:** Built

**What it does.** Importing a backup offers Merge (nothing deleted, newest wins per note) or Replace (exact restore), and always takes a safety backup first.

**Why it was good.** "Import" is ambiguous and the two meanings have opposite consequences. Making the user choose, in plain language, with the safety net taken automatically, means neither answer can be a disaster.

**How it worked.**

- Merge compares `rev` then `updated` per note id; adds anything missing; reports counts of added / updated / kept-as-newer.
- Replace clears notes, groups and assets first, then restores wholesale including `masterId` and workspace name.
- `exportBackup(true)` runs silently before either path.
- Assets are restored only if not already present, so re-importing is cheap and idempotent.
- `ensureIntegrity()` runs afterwards, so a malformed backup cannot leave the app unbootable.

### NN-48 · Unreferenced asset GC

**Status:** Built

**What it does.** A Settings action deletes blobs no note references any more and reports the bytes reclaimed.

**Why it was good.** Deleting an image from a note otherwise leaves the blob forever. Manual rather than automatic so an undo-by-reimport is never sabotaged by a sweep running in the background.

**How it worked.**

- Scan every live note's HTML for `data-asset="…"` into a Set; delete every asset id not in it from both the metadata map and IndexedDB; revoke its object URL.

### NN-49 · Supabase setup wizard

**Status:** Built

**What it does.** A four-step in-app guide: create a project, run the provided SQL, paste URL and anon key, sign in. Nothing leaves the app until it is complete.

**Why it was good.** "Bring your own backend" normally means a README and a bad afternoon. Putting the exact SQL in the app with a copy button, and explaining *why* the anon key is safe to paste, is the difference between a feature people use and one they bounce off.

**How it worked.**

- The SQL creates the table, an `(owner, updated_at)` index, enables RLS, and adds a single `auth.uid() = owner` policy for all operations.
- Auth is email+password over the REST endpoints directly (`/auth/v1/signup`, `/auth/v1/token?grant_type=password`) — no SDK, consistent with the no-dependency rule.
- Access and refresh tokens plus expiry are stored in the config key; `ensureToken()` refreshes when under two minutes remain.
- Errors are surfaced verbatim with a hint appended for the common "project is paused" case.
- **Never verified against a real project** — no Supabase instance existed during the build.

### NN-50 · Conflict-copy sync

**Status:** Built

**What it does.** Pull-then-push on `updated_at`. When two devices changed the same note, the remote version is kept as a **separate note** titled "… — from <device>" instead of overwriting anything.

**Why it was good.** Last-writer-wins quietly destroys work. This is deliberately not clever: it is the crude-but-safe placeholder, chosen so that the sophisticated version (NN-56) could be built later without any window in which edits could be lost.

**How it worked.**

- Pull rows with `updated_at > lastSync`; for each, insert if absent, take remote if `rev` is higher and local has not changed since the last sync, otherwise create the conflict copy.
- Push every note with `updated > lastSync`, batched 40 at a time with `Prefer: resolution=merge-duplicates`.
- Device names label the copies, which is why Settings lets you name the device.
- Runs on an interval, on tab focus and on `online`; skipped while hidden or offline.
- **Never verified against a real project.**

---

## Planning surface

_The roadmap / queue / kanban page that shipped inside the app._

### NN-51 · Three-view plan overlay

**Status:** Built

**What it does.** A full-screen page inside the app with three tabs at three zoom levels: Longterm Roadmap, Immediate Task Queue, Kanban.

**Why it was good.** Putting the plan *in the product* rather than in chat meant the roadmap was always one keystroke away and could not drift out of sync with the thing it described. The three-zoom structure was the specification and it earned its keep — different questions genuinely live at different resolutions.

**How it worked.**

- Overlay element, Escape to close, `⌘/Ctrl + /` to toggle; the selected tab persists.
- Each view renders from the same seed structure, so a content update touches one place.

### NN-52 · Seed-merge for plan state

**Status:** Built

**What it does.** `mergePlan(seed, saved)` lets the plan's *content* be updated by a new build while the user's *statuses, notes and card positions* survive.

**Why it was good.** The hard part of shipping a plan inside an app. Without it, every update either wipes what the user marked or freezes the content. This is the mechanism that made "I update the plan each turn, you keep your verdicts" possible.

**How it worked.**

- Everything is keyed by stable ids (`q-verify-editor`, `k-draw`, `f-canvas`).
- For each seed item: take title/detail/feedback from the seed; take status, notes and kanban column from saved if present, else the seed default.
- User-created kanban cards carry `custom: true` and are preserved whole.
- Items dropped from the seed are retained rather than deleted, so a verdict never vanishes silently.
- A `version` and `turn` on the seed surface in the header, so you can see which build's plan you are reading.

### NN-53 · Queue as a verification contract

**Status:** Built

**What it does.** Items grouped A/B/C — awaiting your verification, specced but not built, blocked on you — each expandable to a full implementation outline, with a "How to give feedback" block, a free-text notes field, and five status buttons. Nothing leaves the list until the user marks it Verified.

**Why it was good.** The best idea in the planning surface. "Done" normally means "the builder thinks it is done"; here it means the user exercised it. Section C in particular made blocked work visible as *blocked on a specific question* rather than as silence — and the per-item feedback instructions turned vague dissatisfaction into reportable observations.

**How it worked.**

- Each item: `{sec, id, title, why, status, detail: [[heading, [lines]]], feedback}`.
- The feedback block is prose naming what to try and how to report it ("button → what you did → what you expected → what happened"), not a generic invitation.
- The notes textarea persists per item, debounced 400ms — explicitly described as read at the start of the next turn.
- A progress bar counts only Verified, so it reflects the user's judgement rather than the builder's.

### NN-54 · Roadmap as a blocking tree

**Status:** Built

**What it does.** Features only — no implementation detail — grouped into phases, each card naming what must land before it. Checkpoint phases mark where several branches converge and the work turns from building to polishing.

**Why it was good.** Keeping implementation detail *out* is what made it readable. Phases alone are a wish list; the blocking refs make it a dependency graph you can actually plan from, and the convergence checkpoints name the moments that are easy to skip past and expensive to skip.

**How it worked.**

- Nodes are `{id, t, d, s, blk: [ids], ck}`; `blk` renders as chips showing the blocking node's title, resolved by id.
- Phases are `{id, name, kind: "phase"|"ckpt", sub, nodes}`; checkpoint phases take the gold accent and a target icon.
- Per-phase progress reads "n/total verified".
- Six phases shipped: P0 Foundation, P1 Canvas & Sync, C1 daily-driver checkpoint, P2 Recall, P3 Durability, C2 the 1.0 checkpoint.

### NN-55 · Click-to-cycle status

**Status:** Built

**What it does.** Clicking a roadmap card advances it through queued → in progress → needs verification → blocked → verified.

**Why it was good.** Status editing that needs a menu does not get used. One click, no dialog, no save button.

**How it worked.**

- Index into a `STATUSES` array, modulo, persist, re-render. Pill colour and label are derived from a single status→colour map shared by all three views.

### NN-56 · Kanban with cross-column drag

**Status:** Built

**What it does.** Five columns — Backlog, Next up, In progress, Needs your verification, Done — with draggable cards and priority tags.

**Why it was good.** The middle zoom level. The roadmap says what depends on what, the queue says how to build it; this says what is moving now. Deliberately the least detailed of the three.

**How it worked.**

- Columns highlight on `dragover`; dropping writes `col` on the card's state record.
- Card order persists in `kanbanOrder`, so new seed cards append without reshuffling.
- Priority tags (`p0`–`p3`) colour-code; area tags stay neutral.

---

## Designed, never built

_Specced to rebuild-grade detail. No code was written._

### NN-57 · Drawing canvas — freehand and shapes

**Status:** Designed

**What it does.** Draw with freehand strokes and primitive shapes in a note.

**Why it was good.** Specced as a scene graph rather than a bitmap, which is the decision that keeps drawings editable, diffable and syncable like everything else.

**How it worked.**

- A drawing is a note with `kind: "canvas"` holding `{v, bg, els: [{id, type, x, y, w, h, rot, style, points?, text?}]}`. Types: `path`, `line`, `arrow`, `rect`, `ellipse`, `diamond`, `text`, `image`.
- Render to inline `<svg>`, not `<canvas>`: crisp at any zoom, hit-testing for free, and it serialises to the same string that syncs.
- Freehand via Pointer Events (so Apple Pencil and touch are identical), `pointerrawupdate` where available, Ramer–Douglas–Peucker simplification at ε≈0.7px on pointerup, pressure→width where reported.
- Shapes: drag to draw, Shift constrains, eight resize handles plus rotate, 8px grid snap and edge/centre snapping to other elements with Alt to disable.
- Marquee multi-select, group/ungroup, z-order, canvas-scoped undo stack. Export SVG and PNG.
- A canvas note opens in a normal pane so a drawing can sit beside text; the toolbar swaps when the focused pane is a canvas.
- **Open question that blocked it:** infinite pannable canvas or a fixed page that scrolls like a document. Asked, never answered.

### NN-58 · Mindmaps as a view, not an artefact

**Status:** Designed

**What it does.** Mindmaps built on the canvas model, with two-way conversion between a nested list and a map.

**Why it was good.** The conversion is the idea. A standalone mindmap is a thing you make once and never open again; a mindmap that is a *view* of an outline you already maintain stays alive. Worth carrying into Atlas as a principle, not just a feature.

**How it worked.**

- Adds `node` and `edge` element types with a parent pointer to the NN-57 scene graph.
- Layout is computed, not hand-placed: tidy-tree (Reingold–Tilford, Buchheim variant) for hierarchies, radial as an option.
- Manual nudges stored as per-node *offsets* from the computed position, so re-layout never destroys an arrangement.
- Tab = child, Enter = sibling, Backspace on an empty node deletes and re-parents. Collapse/expand subtrees; drag onto a node to re-parent with a live drop indicator.
- Any nested list in a text note explodes into a map; any map collapses back into a nested list.

### NN-59 · Block-level CRDT merge

**Status:** Designed

**What it does.** Replace last-writer-wins with deterministic per-block merging, so two devices editing different paragraphs of one note merge silently.

**Why it was good.** The honest answer to "perfectly robust merging of differences". Block granularity rather than character granularity was a deliberate choice — it is far simpler, and it covers the real conflict pattern (two people in different parts of a long note) without the complexity of full text CRDT.

**How it worked.**

- Every block (paragraph, list item, heading) gets a stable id and a Lamport timestamp; merging is a deterministic union with no server arbitration.
- Same-block conflicts still produce both versions, marked inline, rather than picking a winner.
- Tombstones for deletes with a 30-day sweep so notes do not grow forever.
- A monotonic `site_id + counter` per device replaces wall-clock time, so a phone with a wrong clock cannot win an argument.
- Transport: a Supabase Realtime channel per user, with the existing polling sync as the fallback when the socket is down.

### NN-60 · Attachment sync

**Status:** Designed

**What it does.** Sync images and files, not just text, so an image created on one device appears on the others.

**Why it was good.** Without it, cross-device sync is only half true and the gap shows up as a "missing on this device" marker. Low ambiguity — it was waiting on a Supabase project, not on a decision.

**How it worked.**

- A `nexa-assets` Storage bucket with the same owner-scoped RLS as the notes table.
- Upload on insert, lazily download on first render, cache in IndexedDB. The note HTML keeps referencing `data-asset`, so the document model does not change at all.
- A per-asset `synced` flag drives an "N attachments not yet uploaded" indicator in the sync chip.

### NN-61 · Offline shell

**Status:** Designed

**What it does.** A service worker caching the page so the home-screen app opens with no connection.

**Why it was good.** The one place where "everything in one HTML page" and "works offline on iOS" genuinely conflict — and the analysis is worth keeping even though the code never shipped.

**How it worked.**

- A service worker **must** be served as its own same-origin JavaScript file. Registration from a blob URL, a data URL or an inline script is refused by every browser. This is a security rule, not a limitation to code around.
- The whole worker is ~30 lines: cache `./` and `./index.html` on install, clean old caches on activate, network-first with a cache fallback for navigations only.
- Written into the project README so it could be dropped in on a one-word answer.
- **Open question that blocked it:** add the second file, or stay strictly one file and accept offline launches failing. Asked, never answered.

---

## Discussed only

_Raised, reasoned about, never specced._

### NN-62 · Master rollup

**Status:** Only discussed

**What it does.** An auto-generated section at the top of the master note gathering every unchecked checkbox from every other note.

**Why it was good.** Offered as one of three readings of "master note". The pinned-scratchpad reading was chosen, but this one is the more interesting long-term idea — it makes the master a live index rather than just a privileged note, and it is the natural companion to backlinks.

**How it worked.**

- Was presented as two variants: a pure live dashboard (master is entirely transclusion), or a hybrid (your scratchpad, with a generated rollup section pinned above it).
- Survives in the shipped roadmap as `f-rollup` in P2 Recall, blocked by wiki links and the master note.

### NN-63 · Same note in two panes

**Status:** Only discussed

**What it does.** Open one long note in two panes to compare its own distant parts.

**Why it was good.** A real want that NN-28 deliberately forecloses. Noting it here so Atlas does not rediscover the tradeoff by accident.

**How it worked.**

- Blocked on a shared document model: two editors over one note need a single source of truth with both views subscribing, not two contenteditables each serialising independently.
- Naturally falls out of NN-59 (block-level model) if that lands first.

### NN-64 · Private Pages on an iOS home screen

**Status:** Only discussed

**What it does.** Whether a private GitHub Pages site works as an Add-to-Home-Screen app.

**Why it was good.** Raised as a risk before building; the user said they had done it many times without issue, so it was dropped. Recorded because it was never actually tested and may resurface in Atlas.

**How it worked.**

- The concern: private Pages is gated by a GitHub SSO cookie, and iOS home-screen web apps have historically used a partitioned cookie jar — so the icon could bounce to a login even though Safari works.
- Alternatives considered: public Pages with private data (the HTML holds nothing sensitive), or a private repo hosted via Cloudflare Pages + Access.
- Never exercised on a device.

---

## Never got done

Every request of yours that was not finished, quoted exactly as you wrote it, with what actually happened to it.

> it also has to allow us to draw with shapes and freehand, and make mindmaps - but that is a queued task.

Never built. Both were specced to rebuild-grade detail (NN-57, NN-58) and sat in the queue as section B. Building them was gated on one question I asked and you never answered: infinite pannable canvas, or a fixed page that scrolls like a document.

> syncing across my phone and all of my PCs with perfectly robust merging of differences

Not achieved. What shipped is last-writer-wins with conflict copies (NN-50) — safe, in that nothing is destroyed, but you reconcile by hand. The actual robust merge was designed (NN-59, block-level CRDT with Lamport timestamps) and never built. It was also never tested against a real Supabase project, so even the crude version is unproven.

> make this our catchall notes app that works as an iOS-optimized webapp (using Add To Home in Safari)

Partly. The meta tags, safe-area insets, 100dvh fallback, 16px font floor, slide-over drawer and scroll-snap panes all shipped (NN-41). None of it was ever tested on your phone, and without a service worker (NN-61) the home-screen icon fails when offline.

> this should be reviewed at every one of your turns to see where we are headed

Happened once. I reviewed and reported the plan at the end of the build turn. The two turns after that — the Quill question and this one — did not open it. That is a straight miss on a standing instruction, and the kind of thing worth building into Atlas as an automatic step rather than relying on it being remembered.

> EVERYTHING in this entire system is served through the one HTML page on Pages. we will set this up immediately. call the repo Nexa

The one-file rule held — the app is a single 216 KB index.html with no dependencies. The repo was never created and nothing was ever deployed. I had no GitHub access from the session; you took the zip to do it yourself.

> uhhh i just checked and github integrations ARE connected here.

Never resolved. I refreshed the MCP server list and filtered the connector registry for git/github/repo and got nothing — the only servers attached were the scheduler and a visualize helper. Your GitHub was presumably connected on a different surface. We moved on rather than settling it.

> persistence goes localstorage->prompt for JSON backup into downloads folder-> prompt for supabase for cross-device

Tiers 1 and 2 built and tested. Tier 3 built but never connected: the wizard, the RLS schema, auth and the sync loop all exist (NN-49, NN-50) and have never once run against a live Supabase project. Treat every line of that code as unproven.

> until I verify it works well, it stays there, you track the progress and how I can provide feedback

The mechanism was built exactly as asked (NN-53) and then never used. All seven items sat in "Awaiting your verification" from the moment they shipped to the moment the app was retired. Nothing in Nexa Notes was ever verified by you — including the backup round-trip, which was the one thing I asked you to do first.

> do you know hte name of the website i was originally using to influence our design?

Answered but unresolved. I did not know and would not guess. I did identify the underlying editor as almost certainly Quill from its toolbar fingerprint (NN-30), and offered to search on any extra detail. You never supplied one, so the original site is still unidentified.

---

_Companion file: `nexa-notes-messages.jsonl` — every message you sent in that chat, with its state and outcome._
