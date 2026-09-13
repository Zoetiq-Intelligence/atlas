# Tests

Nothing here ships to the browser. The app itself has zero dependencies; these
tests borrow a Playwright install from the machine if one exists.

```sh
# model only — plain node, no dependencies at all
node test/model.test.mjs

# browser tests — need playwright and a chromium binary
python3 -m http.server 8111 --directory . &
PW=$(node -e "console.log(require.resolve('playwright'))") \
CHROME=/path/to/chrome \
  node test/editor.test.mjs http://127.0.0.1:8111

# app.test.mjs additionally needs config.js pointed at https://stub.supabase.co
# with any anon key — every request to that host is intercepted and faked.
```

`editor.test.mjs` is the one that matters: it drives a real browser through
typing, Enter, Backspace-at-boundary, bold, checklist toggling and cross-block
arrow navigation, and asserts against the model each time. It is how we find out
whether the hand-rolled hybrid input layer actually works.
