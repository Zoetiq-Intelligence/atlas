# Notes

A replacement for iOS Notes. Static client, Supabase behind RLS, installed to the
home screen on iPhone and to Edge on PC.

**Zero dependencies.** No npm, no `package.json`, no bundler, no transpile step,
no runtime library — including no `supabase-js`. What is in this repo is
byte-for-byte what runs in the browser.

## Run it

```sh
python3 -m http.server 8111
# then open http://127.0.0.1:8111
```

There is no build step and there never will be. Edit a file, refresh.

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
  model/            doc.js (the block document) · schema.js (block types)
  editor/           render.js · input.js (the controller) · caret.js
  ui/               panes.js · footer.js · sidebar.js · layout.js
  data/             auth.js · api.js · sync.js
  main.js           wiring only
test/               see test/README.md
```

Two files are the seam to every future platform: `adapters/store.js` and
`adapters/net.js`. Everything that persists goes through the first; everything
that touches the network goes through the second.

`ui/layout.js` is the third seam — every positioned element derives from one
function there. Turning on the keyboard-up layout is a change to that file alone.

## What v0 is

Editor with a flat two-row footer, folders, search, local-first sync, dual panes
with a gutter handle and edge-swipe switching.

**Not in v0:** tables, attachments, per-note locking, realtime, and the
keyboard-up layout. v0 is deliberately disposable — v1 is a rebuild from the
design documents, not a refactor of this.
