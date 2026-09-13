# Resume here

Everything is built and tested. Three things stand between it and your devices, and
two of them take about four minutes.

---

## 1. Supabase — run the SQL (≈2 min)

The tables live in their own `notes` schema rather than in `public`, because you said
this project is shared with your other systems.

**SQL Editor → New query →** paste the block from `workflow/_protocol/SETUP-NOTES.sql`
→ **Run**. Expect `Success. No rows returned.`

Then **Settings → API → Exposed schemas**: add `notes`, **keep whatever is already
there**, Save. Without this the API cannot see the schema at all.

Then **Authentication → Emails → Magic Link**: the template must contain
`{{ .Token }}`, not only `{{ .ConfirmationURL }}`. The exact template is in
`workflow/_protocol/SETUP.md` §2a. **This is the step most likely to get skipped, and
without it you cannot sign in on your phone at all** — see §6 of the guide.

Then **Authentication → URL Configuration**:
- Site URL: `https://zoetiq-intelligence.github.io/atlas/notes/`
- Redirect URLs: `https://zoetiq-intelligence.github.io/atlas/notes/**` and `http://localhost:8000/**`
  (the trailing `/**` is required)

Your project URL and publishable key are already in `notes/config.js`.

---

## 2. GitHub — push (≈1 min)

This container's git proxy refuses to inject credentials for a repo that is not in the
session's authorized source set, so I cannot push. **Your machine can.** The zip is a
complete git repository with one commit and the remote already set.

```powershell
# unzip somewhere, then:
cd atlas
git push -u origin main
```

If it asks for credentials, your usual GitHub login works — this is your own machine
with your own credentials, which is exactly how your other sessions were "just in."

Then **Settings → Pages → Source: Deploy from a branch → main → / (root) → Save.**
First build takes a few minutes.

**To let me push directly in future:** start the next session with
`Zoetiq-Intelligence/atlas` attached as a repository source at creation time. That is
the thing you couldn't find mid-session — it is chosen when the session starts.

---

## 3. Install (≈4 min)

**PC (Edge):** open `https://zoetiq-intelligence.github.io/atlas/notes/`, sign in with
your email, **click the link in the email**, then install with the ⊞ icon in the
address bar.

**iPhone:** open the same URL in **Safari** (not Chrome — only Safari can make a real
standalone app). **Share → Add to Home Screen.** Then **open it from the Home Screen
icon**, enter your email, and **type the 6-digit code**.

**Do not tap the link on your phone.** iOS gives a Home Screen app storage completely
separate from Safari — session, cookies, localStorage, service worker, all isolated —
so the link signs Safari in and leaves the installed app logged out forever. There is
no redirect that crosses that boundary. The code is typed directly into the installed
app, so it never leaves that container.

---

## 4. Then send me one thing

In the installed app: open the notes list, **tap the build id at the bottom five
times**, tap **Copy report**, and paste the whole block back to me.

That is the device truth kit. It answers, in one payload, every question I cannot
answer from here: whether the layout viewport matches the frame, what the real safe-area
insets are, which build the device is actually running, whether storage is persisted,
and what configuration produced the numbers. Without it I am guessing about a device I
have never touched — and the guide's most expensive lesson is that a desktop browser
cannot contradict itself.

---

## What changed in v1.5

Built from `workflow/_protocol/ONESHOT-WEBAPP.md`, my working guide derived from your
181-lesson field document.

- **Status bar `black`.** Translucent decouples the native frame from the layout viewport and leaves a dead band at the bottom that nothing you draw can cover — and any fixed element positioned into it is laid out below the clip and never composited. Your bottom bar would simply vanish, on the device only.
- **Root pinned with `position:fixed; inset:0`**, no height chain, nothing sized from the frame.
- **All four safe-area insets read exactly once** into custom properties — machine-checked at exactly four — so a test can drive the installed configuration that otherwise only reproduces on hardware.
- **The keyboard-up layout you deferred is now largely in.** The keyboard shrinks the visual viewport, not the layout one, so a fixed footer sits behind it. The footer now lifts by the measured intrusion and the editor shrinks to match.
- **Bar height is content + pad + reserve + border, summed explicitly**, with the reserve at 0 — the "gesture band steals taps" claim is unmeasured in your own document and 34px of a scarce axis is not spent on folklore.
- **A service worker that cannot serve two builds at once.** Precached URLs come from the precache unconditionally; freshness is the worker lifecycle's job. It does not `skipWaiting()` on install — the page asks for the handover once it has confirmed you are idle, which collapses the mixed-build window from minutes to milliseconds.
- **`update()` on every foreground.** An installed app is resumed, never navigated, so the browser's own update check never runs and a deploy can sit on the server for days. This is the one bug that cannot be found in development.
- **A `busy()` predicate written from what a reload would destroy** — including caret position and DOM-only drag state, not just the store.
- **The device truth kit**, and a reset page outside the worker's scope, reachable from inside the installed app.
- **Content-hashed cache name** so an asset change becomes a worker-script change and cannot be forgotten.

147 tests pass: 26 model, 54 lexical shell guards, 17 editor in Chromium, 29 app, 21
device-simulation (safe-area and keyboard driven off-device).

**Two real bugs the new tests caught**, both invisible without them:
1. `getPropertyValue` on a `calc()` custom property returns the unresolved token stream, so `--bar-h` read as 0 — in the app, not just the test.
2. My own explanatory comments named every forbidden string, so the lexical guards fired on them. Stripping comments first is the source document's own lesson, and I needed it immediately.
