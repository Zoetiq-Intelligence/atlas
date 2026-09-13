# Deploy — getting Notes onto your iPhone and PC

Roughly 15 minutes. Do the steps in order: the Supabase redirect config needs
the Pages URL, which doesn't exist until after the first push.

Where it says `<you>`, use your GitHub username.

---

## 1. GitHub — the repo and the token (~3 min)

**Two empty repos** at <https://github.com/new>. Add **no** README, `.gitignore`
or licence to either — master pushes a full tree and an initialised repo
collides on the first push.

| Repo | Visibility | Why |
|---|---|---|
| `notes` | **Public** — required | Private Pages gates the site behind a GitHub session cookie, which breaks add-to-home-screen standalone launches. Nothing here is sensitive. |
| `workflowpipelines` | Private is fine | Docs and coordination, not a website. |

**One fine-grained token** at <https://github.com/settings/personal-access-tokens/new>:

- Name `claude-master-cloud`, expiry 90 days
- Repository access → *Only select repositories* → select **both**
- Permissions → **Contents: Read and write** and **Pages: Read and write**
- Not a classic token — classic tokens can't be scoped to individual repos

**Send me:** the token and your GitHub username.

---

## 2. Supabase — project and schema (~4 min)

New project at <https://supabase.com/dashboard>. Save the database password in
your password manager; I never need it — everything goes through the REST API.

**SQL Editor → New query →** paste the schema block from
`_protocol/SETUP.md` §2.2 → **Run**. Expect `Success. No rows returned.`

### 2a. The email template — do not skip this

**Authentication → Emails → Magic Link**, and make sure the template contains
**both** a link and a code:

```html
<h2>Sign in to Notes</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>Or, on a computer, <a href="{{ .ConfirmationURL }}">click here to sign in</a>.</p>
```

`{{ .Token }}` is the part that matters and it is **not** in the default
template. §6 explains why the link alone cannot work on your phone.

### 2b. Auth URLs

**Authentication → URL Configuration**

- Site URL: `https://<you>.github.io/notes/`
- Redirect URLs — add both, and **the trailing `/**` is required** or the link
  bounces with *"redirect_to is not allowed"*:
  - `https://<you>.github.io/notes/**`
  - `http://localhost:8000/**`

**Send me:** Project URL and **anon** key from **Settings → API Keys**.
Not the `service_role` key — that one never leaves the dashboard.

---

## 3. Push and publish (I do this)

I fill `config.js`, push to `main`, and enable Pages by API. First build takes
a few minutes; later pushes are usually under a minute.

Your site: **`https://<you>.github.io/notes/`**

---

## 4. PC — install in Edge (~1 min)

1. Open `https://<you>.github.io/notes/` in Edge
2. Sign in: type your email, hit **Send code**, then **click the link in the
   email**. It opens the app already signed in.
3. Install it: the **⊞ install icon** at the right of the address bar, or
   **⋯ → Apps → Install this site as an app**

It gets its own window, its own taskbar icon, and no browser chrome.

---

## 5. iPhone — add to Home Screen (~2 min)

**Safari only.** Chrome and Firefox on iOS cannot add a real standalone web app.

1. Open `https://<you>.github.io/notes/` in **Safari**
2. **Share** (the square with the up arrow) → scroll → **Add to Home Screen**
3. Name it *Notes* → **Add**
4. **Open it from the Home Screen icon**, not from Safari

---

## 6. Sign in on the iPhone — use the code, not the link

Open the app **from the Home Screen icon**, enter your email, tap **Send code**,
then **type the 6-digit code** from the email into the app.

**Do not tap the link in the email on your phone.** It will appear to work and
it will not help.

Why: iOS gives a Home Screen web app storage completely separate from Safari —
session, cookies, localStorage and even the service worker are isolated. A link
tapped in Mail always opens in Safari, so it signs *Safari* in and leaves the
installed app logged out. There is no redirect that crosses that boundary. The
code is typed directly into the installed app, so it never leaves that context.

This is why §2a matters. If the email arrives with only a link, the template
change didn't take.

---

## 7. Check that it actually works

1. On the iPhone, in the installed app, type a note
2. Switch away and back — the header pip should go quiet
3. On the PC, reload the app. The note is there.
4. Edit it on the PC, then switch away and back on the phone. The edit appears.

Sync pulls on focus, so "switch away and back" is the gesture that triggers it.

---

## Things that will look like bugs and aren't

- **No email arrives after a few tries.** Supabase's built-in SMTP allows only a
  handful of auth emails per hour on the free tier, then silently stops. Wait, or
  add custom SMTP.
- **"redirect_to is not allowed"** — the trailing `/**` is missing in §2b.
- **404 on some files after deploying.** Something got an absolute path. Every
  path in this app is relative because Pages serves at `/<repo>/`, not the root.
- **Your notes vanish after about a week of not opening it.** Safari evicts
  best-effort storage after ~7 days of no interaction. Installed Home Screen apps
  can claim persistent storage; a plain tab generally cannot. Use the installed
  app, not a tab. Your notes are on the server regardless — this only affects the
  local cache.
- **The app doesn't update after I push.** There is no service worker yet, so a
  hard reload always gets the newest version. The caching strategy is deliberately
  unwritten until your PWA lessons land — a stale cached shell is the top failure
  mode of this stack and not worth guessing at.
