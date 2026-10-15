# Atlas Notes → Atlas Master: handoff

> From the **Atlas Notes** cloud session (2026-09-18 → 2026-10-15), per Gianni's handoff note of 2026-10-13.
> Companion file: `atlas-notes-messages.jsonl`, with every message Gianni sent, verbatim, oldest first, and its state.
> Ruling from the brief: **Notes stays the product as it stands and wins conflicts.**

## 1. Version and what's live where

| What | Where | State |
|---|---|---|
| Notes PWA | https://zoetiq-intelligence.github.io/atlas/notes/ (GitHub Pages from `main`; every push deploys) | build **`notes-ef930d477279`** (sw.js cache name; the sidebar's "build …" label reads it from the LIVE cache) |
| Data | Supabase **personal** project `ymcewqdxtfxskyuizlqx`, schema `notes` | live, RLS on, realtime broadcast triggers installed |
| Gianni's devices | PC (Edge/Chrome, desktop browser) and iPhone (home-screen PWA) | both on the current build as of 2026-10-13 |
| Tools | `tools/build.py` (content-hash stamps `sw.js`; run after ANY change under `notes/`), `tools/merge-notes.mjs`, `tools/note-push.mjs` | in repo |

Updating: the service worker is precache-first and swaps on an idle gate. **Ctrl+Shift+R** bypasses it on desktop; Gianni
didn't know that at first (message 5), so say it whenever a change "isn't showing".

## 2. Data model

A note's body is a **block array in jsonb, never HTML** (`notes/js/model/doc.js`, `schema.js`):

```
doc = { v: 1, blocks: [ { id, t, text, marks: [[start, end, type, value?]], depth?, done? } ] }
t ∈ p h1 h2 h3 li ol check quote code      (li/ol/check carry depth; check carries done)
```

`coerce()` runs on every load: it drops non-objects, rewrites unknown `t` to `p` and normalises marks. ⚠ That means a
new block type (e.g. drawings) written by a newer client is **silently flattened by an older one**. Make `coerce()`
forward-compatible (keep unknown blocks opaque) before any new block type ships. That's why Drawings v1 is blocked.

### Supabase schema `notes` (live, read 2026-10-15)

```
notes.note   id uuid default gen_random_uuid(), user_id uuid default auth.uid(), folder_id uuid,
             title text default '', doc jsonb default '{"v":1,"blocks":[]}', pinned boolean default false,
             created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
notes.folder id uuid, user_id uuid default auth.uid(), name text, parent_id uuid, sort int default 0,
             created_at, updated_at
notes._import_lines   ⚠ LEFTOVER staging table (src, n, line), 2,664 rows of Gianni's note text. RLS on, all grants
             revoked, so it's unreadable through the API. `drop table` via the MCP connector times out at 60 s
             (twice). Drop it from the Supabase SQL editor: `drop table notes._import_lines;`
```

- RLS: own rows only (`user_id = auth.uid()`). Soft delete via `deleted_at`.
- `title` is recomputed by the client from the first non-blank block on every save. To retitle, edit the block.
- Realtime: triggers `note_broadcast` / `folder_broadcast` call `realtime.send` with a **pointer** payload
  `{op, kind, id, updated_at}` on private topic `notes:<user_id>`, policy "own notes topic". The client
  (`js/data/realtime.js`, a hand-written Phoenix client, no supabase-js) pulls on a pointer. A poll stays underneath
  (5 s, or 30 s while live) because broadcast is at-most-once. Pull is incremental (cursor = max server `updated_at`
  − 30 s overlap).
- Backups: `notes.snapshot` / `take_snapshot` / `restore_snapshot` are written in `workflow/_protocol/SETUP-BACKUP.sql`
  and **were never run**. The Backups button exists and does nothing until they are.

## 3. Sign-in

Email magic link **and** 6-digit code from one OTP call over GoTrue REST (`js/data/auth.js`). The code is the path
for the installed iPhone app, because a magic link always opens in Safari, outside the PWA's storage. Refresh-token
rotation is client-side. `config.js` holds URL and anon key, both public by design. **The service_role key never
appears in the repo or in chat.**

## 4. Tests

**322 passing**: model 44, shell 74, editor 17, app 89, device 42, realtime 17, merge-notes 17, note-push 22.
`node notes/test/model.test.mjs`, `node tools/*.test.mjs` are plain node. The browser suites need Playwright +
Chromium (`notes/test/README.md`). `app.test.mjs` fakes every request to a stub Supabase host. **Tests never touch
Gianni's real data.** Run the full suite before every push, because every push reaches his phone.

## 5. Open bugs and loose ends

1. **Backups inert:** SQL never installed (above). Asked for on 09-18. Needs Gianni's yes, then one run.
2. **Leftover staging table** `notes._import_lines` (above).
3. **`coerce()` flattens unknown block types** (above). It's a data-loss risk across client versions.
4. Space-chord hotkeys are **desktop only** by design (intercepting keydown breaks iOS autocorrect/dictation). The
   footer and selection menu carry every command on the phone. The **latched** double-tap-Space mode isn't built.

## 6. Leaving iOS Notes: state on 2026-10-15

| Note | State |
|---|---|
| `☀️🌞⛅️ New Day (OLD)` | **in Supabase**, id `de3c5c83-5565-4a24-bdd6-1b0bfb4504b0`, 1,970 blocks, verified exact (text md5 `5641350c4d98618a35784debd45a6d7c`) |
| `🥤Today (OLD)` | **waiting on Gianni**: import `🥤Today (OLD).atlasnote.json` with the sidebar's Import button (the file was sent to him on 10-13; bottom of the notes list: build · Backups · **Import** · Sign out). 5,585 blocks |
| `☀️🌞⛅️ New Day` (the merge) | **ready, one call**: 7,544 blocks built in Postgres from the two OLD notes (`tools/note-push.mjs`; fingerprint `b471567b7e535a09f97c625fcf53e82b`). Tested on a local Postgres: exact match, under 1 s, a rerun refuses instead of duplicating, and it refuses while Today (OLD) is missing |

The input files and the generated SQL are in the Notes session's scratchpad, **never in the repo** (atlas is public).
If Atlas Master takes this over, regenerate:
`node tools/merge-notes.mjs today.txt newday.txt <out-dir>` then
`node tools/note-push.mjs "<out>/☀️🌞⛅️ New Day.atlasnote.json" out.sql --user <uuid> "N=<New Day (OLD) file>@de3c5c83-…" "O=<Today (OLD) file>@🥤Today (OLD)"`
and run `out.sql` with the Supabase connector's `execute_sql`.

⚠ Today contains a work login line. Don't repeat it anywhere.

## 7. The fast note-editing process (Gianni: "we have ot build it pretty much immediatley")

**The slow part was never Supabase. It was Claude typing every character.** One 1,970-line note took seven
hand-verified chunks. Rules that fix it:

1. **New text enters from Gianni's device, not through Claude:** the Import button (lossless by proof:
   `model/import.js` refuses any import whose text doesn't come back out exactly). About 30 s.
2. **One SQL call per note** (`tools/note-push.mjs`, built 10-15): text already in the database goes as references
   (source note, line range, one letter per line for its type); only new text goes as text. Postgres rebuilds the
   note, fingerprints every block and inserts only on an exact match, never over a live title. The merge came to
   9 KB of SQL instead of 600 KB of JSON.
3. **NOT BUILT, the next step:** the style loop. One SQL call restyles **every** note in place
   (`update notes.note set doc = <transform>(doc) where …`), taking a snapshot first so revert is one more call. The
   open app repaints at once via the broadcast trigger (an `update` fires it), so Gianni sees each style on his phone
   seconds after it's run. When a style settles, port the transform to JS in the app ("built into the Notes system as
   an automation in hardcode/no LLM necessary"). It needs: the backup SQL installed (snapshot = revert), and a
   transform library (block-type rules, like `merge-notes.mjs`'s list heuristics, as SQL functions in a
   non-exposed schema).
4. The cloud container **can't reach supabase.co** (agent proxy 403). The Supabase MCP connector is the only DB
   route from a cloud session. On the Workstation, a direct route may exist. Prefer it there, but keep the
   fingerprint gate.

## 8. Roadmap (in order)

1. Today (OLD) imported → run the merge call → Gianni checks all three on the phone.
2. Drop `notes._import_lines`. Install the backup SQL (needs his yes).
3. The style loop (§7.3), then the later ask: **every Today/Daily note merged into one long sequence, then split by
   category** (message 19). `merge-notes.mjs` generalises to N notes; the copied-run dedup is the part to keep.
4. `coerce()` forward-compat → **Drawings v1, three takes to A/B/C test inline** (message 6).
5. **Hotkey atlas** (BOARD #7): what Windows uses, what other apps use, and the LAlt (PC Workflows/AHK) vs Space
   split (message 18). Waiting on Gianni's AHK scripts. These are pasted in chat, never committed.
6. Pairing notes (message 11). Unconfirmed: ask first; needs a `pair_id` column.
7. QUEUE items still not started: search (in-note, then global), drag-and-drop line reordering "fast on phone",
   custom context menu (ruled: suppress on Windows, supplement on iOS), latched Space mode.

## 9. Decisions and why

- **Work on `main`, every push deploys** (Gianni, 09-18). So the full suite runs before every push.
- **Zero dependencies, no build step, no supabase-js.** What's in the repo is byte-for-byte what runs. The realtime
  client was written from the protocol spec.
- **Blocks, not HTML,** because contenteditable HTML differs between Safari and Chrome.
- **One command registry** (`js/editor/commands.js`): footer, selection menu and Space hotkeys are three renderers
  over one array, so parity can't drift. `markParity()` audits the rendered DOM at runtime and paints any gap red
  (Gianni, 09-19).
- **Keys:** `1234` block type, `qwer` lists, `asdf` inline, `zxcv` structure, `5tgb` actions. The row is the
  category. Space chord: 90 ms dwell, refused on rollover, the space types on keyup.
- **Broadcast pointers, not `postgres_changes`:** private topic per user, payload carries no note text, client pulls.
- **150 ms smootherstep everywhere:** one `--dur` / `--ease-smoother` token. `ui/motion.js` evaluates the real
  polynomial, and a test pins the CSS samples to it.
- **Note → pane:** per-row ◀ ▶ buttons plus swipe-the-row (touch-action `pan-y`, threshold 56 px). Desktop has a
  hamburger per pane; the phone has one.
- **Imports are verbatim and proven;** formatting lives only in a derived note that can be regenerated from the OLD
  ones. A wrong formatting guess costs a re-run, never a word.
- **None of Gianni's notes ever go in the repo** (it's public): out-dirs inside the repo are refused by both tools.

## 10. Gianni's unfinished requests, in his own words

- *"we need data backups for the actual state of the entire notes system whenever one of our instances is on and 6 hours has passed since hte last backup, with some way to revert, just in case we break things. go ahead and set it up to do the first backup now in the browser instance i have running"*: built, SQL never run.
- *"can we put in a V1 of being able to insert drawings? I want 3 different takes that I can A/B/C test inline (without breakign the rest of the app/notes data!) and then we will iterate."*
- *"I'd like the ability to actually attach notes to eachother as at least pairs, so we just open up a pair and both come up on the left/right."*: unconfirmed after "scratch that".
- *"we will need a general hotkey interface that lets us see what Windows uses, what other apps already use, then helps us understand our LAlt vs. Spacebar split."*
- *"for now, I need to get this setup with two of my current iOS notes but merged together; and after that's in the system (marked in their titles as OLD), THEN we will work on a third note that merges the two together without losing a single sentence of what I've said."*: one of three in.
- *"in the future we will go back through all of my "Today/Daily/similar" notes and merge them into one long sequence before working on splitting things up by category."*
- *"can you directly put them into supabase? none of my notes should be in the repo anyways"*: partly.
- *"we will need to build a better process for you directly editing notes FAST so we can work on styles, apply them to everything, see how it looks, change stuff, etc. before it's built into the Notes system as an automation in hardcode/no LLM necessary"*: push built, style loop not.
- Standing rule (10-15): *"When I ask a question, even if you're in the middle of a process, you need to immediately respond without much thinking, and then continue what you're doing."*

## Gianni's messages

Verbatim, oldest first. Re-deliveries of the same message by the app are listed once. Re-sends Gianni typed again
are listed again. Time is UTC.

### 1. 2026-09-18 17:33: **done**

> Read workflow/README.md in Zoetiq-Intelligence/atlas and follow the reading order at the bottom. Then confirm you can push by making a trivial commit. Then tell me what you think the next task is.

Read the reading order, pushed a trivial commit, proposed the next task.

### 2. 2026-09-18 17:42: **done**

> pg_get_function_arguments
> "topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text"
> "payload jsonb, event text, topic text, private boolean DEFAULT true"

Confirmed realtime.broadcast_changes / realtime.send signatures; used to write the live-sync triggers.

### 3. 2026-09-18 17:45: **partly**

> id rather you work on main and have every push deploy; but we need data backups for the actual state of the entire notes system whenever one of our instances is on and 6 hours has passed since hte last backup, with some way to revert, just in case we break things. go ahead and set it up to do the first backup now in the browser instance i have running

Working on main with every push deploying: done. 6-hourly backups with revert: built (notes.snapshot, take/restore, Backups panel) but workflow/_protocol/SETUP-BACKUP.sql was never run, so no backup has ever been taken.

### 4. 2026-09-18 18:35: **done**

> pg_get_function_arguments
> "topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text"
> "payload jsonb, event text, topic text, private boolean DEFAULT true" came back from your SQL

Same signature output re-sent; acknowledged.

### 5. 2026-09-18 18:35: **done**

> im still not seeing aaany changes whatoever in the esktop browser instance. that i am accessing at https://zoetiq-intelligence.github.io/atlas/notes/

Cause: the precache-first service worker kept the old build. Explained the idle-gate update and Ctrl+Shift+R.

### 6. 2026-09-18 18:49: **done**

> oh i didnt realize i needed to hard refresh (ctrl shift r, right?) that showed me at least the fractional divider snapping.
>
> instead of two headers, I want one SPA header that handles both panes + global stuff in a smart way

Ctrl+Shift+R confirmed. One SPA header built (title segments sized to the divider, pane switcher, global actions once).

### 7. 2026-09-18 18:51: **partly**

> what im not seeing is the three-way parity between footer buttons, selection menu (not right click; just when we select), and hotkeys (shown as instant tooltips in the footer) for EVERY function we can do to control inputs.
>
> also, can we put in a V1 of being able to insert drawings? I want 3 different takes that I can A/B/C test inline (without breakign the rest of the app/notes data!) and then we will iterate.

Three-way parity: built 09-19 (one command registry rendered as footer, selection menu and Space hotkeys, instant tooltips). Drawings v1 with three A/B/C takes: open, blocked on making coerce() keep unknown block types.

### 8. 2026-09-18 18:51: **done**

> build aa5b4825515b

Build aa5b4825515b report acknowledged.

### 9. 2026-09-18 19:43: **done**

> build a9dfe8977ff8 on pc and on phone.
>
> some notes on mobile:
>
> * sometiems when I switch to the right pane, it shows a little peek on the right side still instead of the left; that's weird, the other note is then on the left (where nothing is visible) so idk what's showing up there. tapping the left side will still make it toggle back to the other though.
> * ALL transitions, including the left/right note thing, should be 150ms smootherstep.

Wrong-side peek fixed (edge strip overhang plus unsettled swipe). All transitions moved to one 150ms smootherstep token, pane switch scripted on the same curve.

### 10. 2026-09-18 19:44: **done**

> im currently not seeign sync across devices - in fact, even if i have the same note open on both sides of phone, editing one doesn't sync to the other, which should be INSTANT!

Same note in two panes now mirrors (was overwriting edits). Pull polls every 5s and repaints. Live sync via database broadcast built and its SQL installed 09-19.

### 11. 2026-09-18 20:34: **done**

> okay let's do 2.

"2" was the live-sync trigger; written and installed.

### 12. 2026-09-18 20:36: **partly**

> I'd like the ability to actually attach notes to eachother as at least pairs, so we just open up a pair and both come up on the left/right. also we need a separate note picker for left and right, not one that relies on what we clicked into last.

Separate left/right pickers: replaced by his next two messages. Pairing notes: not built; asked whether "scratch that" cancelled it, never answered. Needs a pair_id column.

### 13. 2026-09-18 20:36: **done**

> actually scratch that - just next to each note is a left-pane vs. right-pane set of buttons.

Per-row left/right buttons in the notes list.

### 14. 2026-09-18 20:36: **done**

> or we can touch the note and swipe left or right and it goes that way.

Swipe a row left/right to send it to that pane (touch-action pan-y, 56px threshold).

### 15. 2026-09-19 14:33: **done**

> proname,pg_get_function_arguments
> send,"payload jsonb, event text, topic text, private boolean DEFAULT true"

realtime.send signature confirmed; broadcast triggers written against it.

### 16. 2026-09-19 14:35: **done**

> Your two revisions, recorded
>
> Note → pane: scratched the separate pickers. Now: two small buttons per row, plus swipe-the-row left/right. One thing to design around — rows live in the slide-over, so a horizontal drag there has to not fight the panel's dismiss gesture or the pane scroller beneath. This app's answer to that is always touch-action, not JavaScript, same as .editor vs the edge strips.
>
> Pairing — I need one word from you. I read "scratch that" as cancelling the separate picker, which it immediately replaced, not the pairing idea. But that's an inference and it's the only item needing a schema change, so I haven't built it. Still want pairs, or is per-row left/right buttons enough?
>
> ---
>
> on this - or desktop, we have two separate hamburger menus, but in either one we do have distinct left/right buttons too. so we can click either just the title of the note or specifically left or right.
> on mobile, we have just one hamburger menu, and we can either swipe a title left or right or click the left/right buttons.

Built as described: desktop has a hamburger per pane, the phone has one; every row has title tap plus explicit left/right buttons and swipe. The pairing question inside the quoted text stayed unanswered.

### 17. 2026-09-19 14:36: **done**

> I am STILL not seeing tooltips from the footer buttons that tell me the shortcuts or a selection menu when we select text. remember, EVERY function for content gets keyboard shortcuts, selection menu, and footer buttons. EVERY single one. I have said that multiple times and I am curious why I am not seeing the changes!

Footer tooltips with shortcuts and the selection menu shipped 09-19 for all 20 commands; earlier builds had not deployed them.

### 18. 2026-09-19 14:39: **done**

> if three-way parity isn't established, the button should automatically have a red highlight so I KNOW that it's unfinished.

markParity() audits the rendered DOM at runtime and paints any command missing a surface red.

### 19. 2026-09-23 12:36: **open**

> btw we will be integrating another system that controls my PC Workflows (with things like Fancyzones, AHK, etc.) that I already have - all of its hotkeys are using LAlt. so we will need a general hotkey interface that lets us see what Windows uses, what other apps already use, then helps us understand our LAlt vs. Spacebar split.

Hotkey atlas recorded as BOARD #7; waiting on the AHK/PC Workflows scripts (to be pasted in chat, never committed).

### 20. 2026-10-13 15:40: **partly**

> @"/root/.claude/uploads/7d1cbd65-dd61-57af-a241-eab3b3b9fb93/ce802a4c-Today.txt" @"/root/.claude/uploads/7d1cbd65-dd61-57af-a241-eab3b3b9fb93/36c86277-_____New_Day.txt" we are going to move this to a Desktop Claude thread soon through my Horizon master thread that governs all of my major projects, so make a handoff that gives it a summary of where you are at and then it will respond (with my handing the messages over between you) with instructions on what to do.
>
> for now, I need to get this setup with two of my current iOS notes but merged together; and after that's in the system (marked in their titles as OLD), THEN we will work on a third note that merges the two together without losing a single sentence of what I've said. in the future we will go back through all of my "Today/Daily/similar" notes and merge them into one long sequence before working on splitting things up by category. 
>
> the two notes are uploaded. New Day (with the current emojis, too) will be the title of the third one where we merge them; that one's the most recent of the two and there is some overlap of what I copied over. but basically I only use iOS Notes for this ONE note sequence, and I want to get off of it as soon as possible becuase it runs poorly with large amounts of text/emojis/styling on the one note

Handoff summary written. New Day (OLD) imported and verified exact. Today (OLD): waiting on his in-app import. Merged New Day: built and proven lossless (tools/merge-notes.mjs), insert ready as one SQL call. Later merge of all Today/Daily notes: open.

### 21. 2026-10-13 15:44: **done**

> let's go ahead and use checkboxes, hyphens and bullet points for successive lines that don't have a newline in between them just so that it's easier for me to parse the merged file

Merged note formatted as asked: checkboxes for tasks, bullets for lines in a run, hyphens for indented lines; labels stay plain. Arrived twice.

### 22. 2026-10-13 16:09: **done**

> here is the handoff note after we get these merged and it workign on my phone:
>
>
> Atlas is merging into one app under a new "Atlas Master" thread on my Workstation (brief: workflow/ATLAS-MASTER-BRIEF.md in Zoetiq-Intelligence/atlas; pull main). Notes stays the product as it stands and wins conflicts. Before you stop:
> 1. Make sure everything you made is saved: push every change.
> 2. Write workflow/imports/atlas-notes-handoff.md: Notes' current version and what's live where, the data model and the Supabase notes schema, sign-in, tests, open bugs, the roadmap, decisions and why, every request of mine that isn't finished in my own words, and a section "Gianni's messages": each of my messages in this session, verbatim, oldest first, marked done / open.
> 3. Also write every message I sent you in this session as workflow/imports/atlas-notes-messages.jsonl: one JSON object per line, oldest first, {"t": "<ISO time if known, else empty>", "text": "<my message, verbatim, every word>", "state": "done|open|partly", "detail": "<what happened to it>"}. Every message, none skipped or summarised: Horizon files each one as a triage record for Atlas.
> 4. Push and tell me the commit id. Don't start new work after this.

This file, atlas-notes-handoff.md and the push.

### 23. 2026-10-13 16:19: **partly**

> can you directly put them into supabase? none of my notes should be in the repo anyways

New Day (OLD) inserted directly via the Supabase connector in 7 md5-verified chunks; nothing of his notes is in the repo. The other two moved to the faster process.

### 24. 2026-10-13 16:41: **partly**

> when we handoff, we will need to build a better process for you directly editing notes FAST so we can work on styles, apply them to everything, see how it looks, change stuff, etc. before it's built into the Notes system as an automation in hardcode/no LLM necessary

tools/note-push.mjs built: one SQL call per note, references instead of retyped text, fingerprint-gated insert. The style loop (restyle every note in one call, see it live, revert) is designed in the handoff, not built.

### 25. 2026-10-13 16:45: **done**

> wait is there anyway we can stop with just New Day OLD, and try a new process rigth now for the other two?

Stopped chunk transfer after New Day (OLD). New process: device import for new text, one SQL call to build the merge from notes already stored.

### 26. 2026-10-13 16:45: **partly**

> we have ot build it pretty much immediatley anyways and this is quite laborious so far

Push half built the same day; style loop is the next build for Atlas Master.

### 27. 2026-10-13 22:10: **partly**

> can you directly put them into supabase? none of my notes should be in the repo anyways
> when we handoff, we will need to build a better process for you directly editing notes FAST so we can work on styles, apply them to everything, see how it looks, change stuff, etc. before it's built into the Notes system as an automation in hardcode/no LLM necessary
> wait is there anyway we can stop with just New Day OLD, and try a new process rigth now for the other two?
> we have ot build it pretty much immediatley anyways and this is quite laborious so far

Re-send of the four messages above; same outcome as each.

### 28. 2026-10-13 22:15: **partly**

> can you directly put them into supabase? none of my notes should be in the repo anyways

Re-send; same as the first "can you directly put them into supabase?".

### 29. 2026-10-15 21:53: **done**

> describe to me how we are improving this process to become one SQL call per note that we push?

Answered: text enters from the device, everything else is one small SQL call that rebuilds and fingerprints the note in Postgres.

### 30. 2026-10-15 21:55: **done**

> I asked you a question, haven't heard a response. and haven't heard a response. When I ask a question, even if you're in the middle of a process, you need to immediately respond without much thinking, and then continue what you're doing.

Acknowledged as a standing rule: answer questions immediately, then continue.

### 31. 2026-10-15 21:56: **done**

> Okay, really quickly give me a step-by-step checklist of all the things we need to do before we're ready to hand off to the new master atlas thread.

Gave the 8-step handoff checklist.

### 32. 2026-10-15 21:58: **done**

> Is there any reason I have to do it on the phone versus the desktop app?

No reason; desktop import syncs to the phone.

### 33. 2026-10-15 22:10: **done**

> okay, im in the desktop version, what do I do? I don't see an import tool anywhere

Pointed to the Import link at the bottom of the notes list (build · Backups · Import · Sign out).
