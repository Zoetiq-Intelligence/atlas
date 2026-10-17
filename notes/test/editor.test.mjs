// Browser tests. Not a project dependency — nothing here ships to the client.
// Needs playwright available somewhere on the machine:
//   PW=$(node -e "console.log(require.resolve('playwright'))") \
//   CHROME=/path/to/chrome node test/editor.test.mjs http://127.0.0.1:8111
const pwPath = process.env.PW || 'playwright';
const pw = (await import(pwPath)).default ?? (await import(pwPath));
const { chromium } = pw;
const CHROME = process.env.CHROME || undefined;
const base = process.argv[2];
let pass=0, fail=0;
const ck=(c,m)=>{ c?pass++:(fail++,console.log('  FAIL:',m)); };

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
// The browser asks the server root for /favicon.ico on every navigation; python's
// http.server answers 404 and the page logs an error, which made this suite exit 1
// on every run since it was written — 17 assertions passing behind a red exit code.
// Answered here rather than filtered, so a 404 for anything else still fails the run.
await p.route('**/favicon.ico', r => r.fulfill({ status: 200, contentType: 'image/x-icon', body: '' }));
const errs=[]; p.on('pageerror', e=>errs.push(String(e)));
p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto(base + '/test/harness.html');
await p.waitForFunction('window.ready===true');

const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.ed.flush())));
const focusFirst = async () => { await p.click('.row .txt'); };

// --- typing ---------------------------------------------------------------
await focusFirst();
await p.keyboard.type('Groceries');
let d = await doc();
ck(d.blocks[0].text === 'Groceries', 'typed text reaches the model: ' + d.blocks[0].text);

// --- Enter splits ---------------------------------------------------------
await p.keyboard.press('Enter');
await p.keyboard.type('milk');
d = await doc();
ck(d.blocks.length === 2, 'Enter created a block, got ' + d.blocks.length);
ck(d.blocks[1].text === 'milk', 'second block text: ' + d.blocks[1].text);

// --- split mid-text preserves both halves ---------------------------------
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
await p.keyboard.press('Enter');
d = await doc();
ck(d.blocks.length === 3 && d.blocks[1].text === 'mi' && d.blocks[2].text === 'lk',
   'mid-text split: ' + JSON.stringify(d.blocks.map(x=>x.text)));

// --- Backspace at 0 merges ------------------------------------------------
await p.keyboard.press('Home');
await p.keyboard.press('Backspace');
d = await doc();
ck(d.blocks.length === 2 && d.blocks[1].text === 'milk',
   'backspace merged: ' + JSON.stringify(d.blocks.map(x=>x.text)));

// --- bold a selection -----------------------------------------------------
await p.evaluate(() => {
  const t = document.querySelectorAll('.row .txt')[0];
  const r = document.createRange();
  r.setStart(t.firstChild, 0); r.setEnd(t.firstChild, 5);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  t.focus();
});
await p.evaluate(() => window.ed.mark('b'));
d = await doc();
ck(JSON.stringify(d.blocks[0].marks) === '[[0,5,"b"]]', 'bold applied: ' + JSON.stringify(d.blocks[0].marks));
ck(await p.locator('.row .m-b').first().textContent() === 'Groce', 'bold rendered in DOM');

// --- marks survive typing before them (the iOS autocorrect path) ----------
await p.evaluate(() => {
  const t = document.querySelectorAll('.row .txt')[0];
  const s = getSelection(); const r = document.createRange();
  r.selectNodeContents(t); r.collapse(false); s.removeAllRanges(); s.addRange(r);
  t.focus();
});
await p.keyboard.type('!!');
d = await doc();
ck(d.blocks[0].text === 'Groceries!!', 'appended: ' + d.blocks[0].text);
ck(JSON.stringify(d.blocks[0].marks) === '[[0,5,"b"]]', 'mark unmoved after append: ' + JSON.stringify(d.blocks[0].marks));

// --- checklist + toggle ---------------------------------------------------
await p.click('.row:nth-child(2) .txt');
await p.evaluate(() => window.ed.block('check'));
ck(await p.locator('.row[data-t="check"]').count() === 1, 'checklist block created');
await p.click('.row[data-t="check"] .chk');
d = await doc();
ck(d.blocks[1].done === true, 'checkbox toggled in model');
ck(await p.getAttribute('.row[data-t="check"]', 'data-done') === '1', 'checkbox toggled in DOM');

// --- indent ---------------------------------------------------------------
await p.click('.row[data-t="check"] .txt');
await p.evaluate(() => window.ed.nudge(1));
d = await doc();
ck((d.blocks[1].depth||0) === 0, 'indent refused with no list above (depth stays 0)');

// --- backspace on a styled block demotes before merging -------------------
await p.click('.row[data-t="check"] .txt');
await p.keyboard.press('Home');
await p.keyboard.press('Backspace');
d = await doc();
ck(d.blocks.length === 2 && d.blocks[1].t === 'p', 'check demoted to p, not merged: ' + d.blocks[1].t);
await p.keyboard.press('Backspace');
d = await doc();
ck(d.blocks.length === 1, 'second backspace merged: ' + d.blocks.length);

// --- undo -----------------------------------------------------------------
await p.evaluate(() => window.ed.undo());
d = await doc();
ck(d.blocks.length === 2, 'undo restored the split: ' + d.blocks.length);

// --- arrow navigation across block boundaries ----------------------------
await p.click('.row:nth-child(2) .txt');
await p.keyboard.press('Home');
await p.keyboard.press('ArrowLeft');
const inFirst = await p.evaluate(() => {
  const rows=[...document.querySelectorAll('.row')];
  const t=getSelection().anchorNode;
  const el=t.nodeType===3?t.parentNode:t;
  return rows.indexOf(el.closest('.row'));
});
ck(inFirst === 0, 'ArrowLeft at offset 0 moved to previous block, landed in row ' + inFirst);

// --- 2026-10-17 review fixes ------------------------------------------------------
const loadDoc = blocks => p.evaluate(bs => window.ed.load('t-' + Math.random(), { v: 1, blocks: bs }), blocks);
const selectIn = (row, a, z) => p.evaluate(([row, a, z]) => {
  const t = document.querySelectorAll('.row .txt')[row];
  t.focus();
  const walk = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
  const pts = []; let n, acc = 0;
  while ((n = walk.nextNode())) { pts.push([n, acc]); acc += n.nodeValue.length; }
  const at = off => { for (let i = pts.length - 1; i >= 0; i--) if (off >= pts[i][1]) return [pts[i][0], off - pts[i][1]]; };
  const r = document.createRange(); r.setStart(...at(a)); r.setEnd(...at(z));
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}, [row, a, z]);
const rowOfCaret = () => p.evaluate(() => {
  const n = getSelection().anchorNode; const el = n && (n.nodeType === 3 ? n.parentNode : n);
  return [...document.querySelectorAll('.row')].indexOf(el && el.closest('.row'));
});

// paste over a selection keeps the marks on the characters that stay
await loadDoc([{ id: 'a', t: 'p', text: 'hello world', marks: [[6, 11, 'b']] }]);
await selectIn(0, 0, 6);
await p.evaluate(() => {
  const dt = new DataTransfer(); dt.setData('text/plain', 'X');
  document.querySelector('.row .txt').dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: dt, bubbles: true, cancelable: true }));
});
d = await doc();
ck(d.blocks[0].text === 'Xworld' && JSON.stringify(d.blocks[0].marks) === '[[1,6,"b"]]',
   'paste over a selection keeps "world" bold: ' + JSON.stringify(d.blocks[0]));

// Enter replaces a selection
await loadDoc([{ id: 'a', t: 'p', text: 'hello world', marks: [] }]);
await selectIn(0, 6, 11);
await p.keyboard.press('Enter');
d = await doc();
ck(JSON.stringify(d.blocks.map(x => x.text)) === '["hello ",""]', 'Enter with "world" selected replaces it: ' + JSON.stringify(d.blocks.map(x => x.text)));

// undo leaves the caret where the edit was, not at the title
await loadDoc(Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, t: 'p', text: 'line ' + i, marks: [] })));
await p.click('.row:nth-child(21) .txt');
await p.keyboard.press('End');
await p.keyboard.type('z');
await p.waitForTimeout(700);
await p.keyboard.press('Control+z');
await p.waitForTimeout(50);
d = await doc();
ck(d.blocks[20].text === 'line 20', 'undo removed the typed letter');
ck(await rowOfCaret() === 20, 'and the caret stays in that line, got row ' + await rowOfCaret());

// Shift+Arrow at a block edge keeps the selection inside the block
await p.click('.row:nth-child(5) .txt');
await p.keyboard.press('Home');
await p.keyboard.press('Shift+ArrowLeft');
ck(await rowOfCaret() === 4, 'Shift+ArrowLeft at the start of a line does not jump to the line above');

// a key that changes nothing does not cost the redo stack
await loadDoc([{ id: 'a', t: 'p', text: 'one', marks: [] }]);
await p.click('.row .txt');
await p.keyboard.press('End');
await p.keyboard.type(' two');
await p.waitForTimeout(700);
await p.keyboard.press('Control+z');
await p.keyboard.press('Home');
await p.keyboard.press('Backspace');          // at the very start: nothing to merge into
await p.keyboard.press('Control+Shift+z');
d = await doc();
ck(d.blocks[0].text === 'one two', 'Backspace at the start of a note leaves redo intact: ' + JSON.stringify(d.blocks[0].text));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (errs.length) { console.log('\nPAGE ERRORS:'); errs.slice(0,8).forEach(e=>console.log(' ', e)); }
await b.close();
process.exit(fail || errs.length ? 1 : 0);
