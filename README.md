# atlas

One-shots and workflow systems. Everything lives here.

```
index.html          hub — deliberately NOT installable (see the guide, §2.7)
notes/              the Notes app  ->  /atlas/notes/
reset/              cache reset, OUTSIDE the app's service-worker scope
tools/build.py      the only build step: stamps sw.js with a content hash
workflow/           coordination: board, protocol, per-project state
RESUME.md           what to do next
```

## Working on it

```sh
python3 -m http.server 8111        # then open http://127.0.0.1:8111/notes/
python3 tools/build.py             # after ANY change to a file under notes/
```

`tools/build.py` does not transpile, bundle or minify. Every source file is served
byte-for-byte as written. It exists only because a browser reinstalls a service worker
when the worker script's own bytes change, so an asset change has to *become* a script
change or installed devices keep serving the old build forever.

## Tests

```sh
node notes/test/shell.test.mjs     # lexical guards — no browser needed
node notes/test/model.test.mjs     # document model — no browser needed
# with a server running and playwright available:
PW=$(node -e "console.log(require.resolve('playwright'))") CHROME=/path/to/chrome \
  node notes/test/device.test.mjs http://127.0.0.1:8111/notes
```

`device.test.mjs` drives the safe-area insets and the keyboard intrusion off-device.
That is only possible because every inset is read once into a custom property — `env()`
has no setter, so a rule that reads it directly can never be tested anywhere but on
hardware.

## The guide

`workflow/_protocol/ONESHOT-WEBAPP.md` is the working guide every one-shot here is
built against. Read §0 before trusting any verification, including your own.
