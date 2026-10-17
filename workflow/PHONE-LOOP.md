# The phone loop: import, merge and Claude, all from the phone

> Built 2026-10-17 by Atlas Master. Gianni's words: *"we need the ability to do the import and merge w/ Claude all
> on the phone - so however that would work, please set it up now. since only I'm using it we can have it send
> stuff to this thread for merging"*.

## On the phone (Notes → the notes list → bottom row)

| Button | What it does | Where it runs |
|---|---|---|
| **Paste** | In iOS Notes: Select All → Copy. Paste into the box, add a title mark like `(OLD)`, Import. Proven lossless exactly like a file import (`model/import.js`). | device |
| **Import** | The same, from `.txt` / `.atlasnote.json` files. | device |
| **Merge** | Pick the newer and the older note, set a title, and it creates **a new note**. It shows the coverage proof first and refuses if a line would be lost. It never edits either source. The rules are `notes/js/model/merge.js`, the same module as `tools/merge-notes.mjs`. | device |
| **Claude** (Ctrl+. on PC) | Write a request and attach notes (the open ones by default). It goes to this thread, and replies appear in the panel. **Merge → Ask Claude instead** pre-fills a merge request with both notes. | Workstation |

## How a request reaches Atlas Master

1. The app inserts into `public.feedback`: `app=atlas`, `kind=request`, `dev=true`, signed with Gianni's own JWT. RLS lets only his email set `dev`, so only he wakes the thread. The text ends with a `— notes —` trailer, one `<uuid>  <title>` per attached note. `context` = `{ask_id, note_id}`.
2. Horizon files it as a triage record. The Dispatcher wakes **Atlas Master** (about 10 s for kind `request`).
3. Atlas Master works it, then runs `triage.py reply <id> --append "…"` and `triage.py state <id> done …`.
4. Horizon mirrors the record into `public.horizon_triage`. The panel polls it by `ref.ask_id` every 8 s while open, and on foreground.

The app code: `notes/js/data/claude.js` (send / history), `notes/js/ui/claude.js` (panel), `notes/js/ui/merger.js`.
Tests fake every request to a stub, and never touch the real `feedback` table, since a row there wakes a real thread.

## Runbook: working a request on the Workstation

Never let note text pass through the chat. Pull it to disk, transform it there, push it back as one statement.

```
SP=<scratchpad, outside the repo>
node tools/note-pull.mjs "$SP/in" <note id> <note id>      # .txt + .atlasnote.json per note; prints id, title, lines, md5
node tools/merge-notes.mjs "$SP/in/<older>.txt" "$SP/in/<newer>.txt" "$SP/out"   # coverage proof or nothing written
node tools/note-push.mjs "$SP/out/<merged>.atlasnote.json" "$SP/push.sql" --user <uuid> \
  "N=$SP/in/<newer>.atlasnote.json@<newer id>" "O=$SP/in/<older>.atlasnote.json@<older id>"
node tools/sql-run.mjs "$SP/push.sql"                      # prints `inserted`, or why it refused
```

- The result syncs to the phone by itself (broadcast trigger + pull).
- Then reply on the triage record with what was made: title, line counts, proof. Never the text.
- `note-pull.mjs` and `sql-run.mjs` use the Supabase Management API token Horizon keeps in LocalGen
  `gateway_state/supabase_mgmt.json`. They don't use the service key, because `service_role` has no grant on the
  `notes` schema. The token is never in this repo.
- All three tools refuse paths inside the repo (atlas is public).

## Next (Gianni, same message)

*"next we will use Horizon Gate to make some features with Featherless, where we queue up suggestions for
A. styling B. reorganization C. whatever else per line, chunk (separated by at least 2 newlines makes a chunk)"*.

The plan is a suggestions queue, so nothing changes until Gianni accepts it:
- Featherless runs through Horizon Gate (`api.horizongate.io`), with the key from Horizon → Connections.
- It proposes per-line and per-chunk changes (chunk = lines separated by 2+ newlines), stored as rows that point at
  block ids.
- Gianni accepts or rejects each one in the app, the way the Merge panel shows a proof before saving.
