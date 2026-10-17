# Notes

A replacement for iOS Notes. Static client, Supabase behind RLS, installed to the
home screen on iPhone and to Edge on PC.

**Zero dependencies.** No npm, no `package.json`, no bundler, no transpile step,
no runtime library — including no `supabase-js`. What is in this repo is
byte-for-byte what runs in the browser.

## Run it

```sh
python3 -m http.server 8111        # from notes/
# then open http://127.0.0.1:8111
```

There is no build step and there never will be. Edit a file, refresh. Before a push, run `tools/build.py`
so installed devices see the change (it stamps `sw.js`; see the root README).

## Configure

`config.js` holds the Supabase URL and anon key. Both are public by design: the
client is a shell, the data sits behind row-level security, and the anon key is
meant to be published. The **service_role** key must never appear in this repo.

## Layout

```
index.html          entry, no logic
config.js           Supabase URL + anon key (public)
css/                base (tokens) · layout (panes, footer) · editor (blocks)
js/
  adapters/         store.js (IndexedDB) · net.js (one request())
  model/            doc.js (the block document) · schema.js (block types) · import.js · merge.js
  editor/           render.js · input.js (the controller) · caret.js · commands.js (the registry)
  ui/               panes · footer · sidebar · topbar · selection · keys · layout · motion · tooltip
                    · importer · merger · claude · backups · diag
  data/             auth.js · api.js · sync.js · realtime.js · backup.js · claude.js
  main.js           wiring only
update.js · sw.js   the update layer; sw.js is generated from sw.template.js by tools/build.py
test/               see test/README.md
```

Two files are the seam to every future platform: `adapters/store.js` and
`adapters/net.js`. Everything that persists goes through the first; everything
that touches the network goes through the second.

`ui/layout.js` is the third seam — every positioned element derives from one
function there. Turning on the keyboard-up layout is a change to that file alone.

## What it is now (v1.5)

Editor with the footer, selection menu and Space-hold hotkeys over one command registry,
folders, search, local-first sync with live updates, dual panes with a gutter handle and
edge-swipe switching, the keyboard-up layout, lossless import (files or paste), merge on the
device, a Claude panel (Ctrl+.) that reaches the Atlas Master thread, and snapshot backups
(inert until `workflow/_protocol/SETUP-BACKUP.sql` is run).

**Not yet:** tables, attachments, drawings, per-note locking, in-note search. The open queue
is `workflow/QUEUE.md`.
