import { newDoc, newBlock, splitBlock, mergeBackward, mergeForward, toggleMark, reconcileText, hasMarkOver, setType, insertText, coerce, titleOf } from '../js/model/doc.js';
let pass=0, fail=0;
const eq=(a,b,m)=>{const A=JSON.stringify(a),B=JSON.stringify(b); if(A===B){pass++}else{fail++;console.log('FAIL',m,'\n  got',A,'\n  want',B)}};

// marks survive typing
let b = newBlock('p','hello world'); b.marks=[[0,5,'b']];
b.text='hello brave world'; eq(reconcileText(b,'hello brave world'),[[0,5,'b']],'insert after mark');
b = newBlock('p','hello world'); b.marks=[[6,11,'b']];
eq(reconcileText(b,'hey hello world'),[[10,15,'b']],'insert before mark shifts');
b = newBlock('p','hello world'); b.marks=[[6,11,'b']];
eq(reconcileText(b,'hello'),[],'delete removes mark');

// toggle
b = newBlock('p','abcdefgh'); b.marks=toggleMark(b,2,5,'b');
eq(b.marks,[[2,5,'b']],'add mark'); eq(hasMarkOver(b,2,5,'b'),true,'has mark');
b.marks=toggleMark(b,3,4,'b'); eq(b.marks,[[2,3,'b'],[4,5,'b']],'punch hole');

// split preserves marks on both sides
let d=newDoc([newBlock('p','hello world')]); d.blocks[0].marks=[[0,11,'b']];
const nid=splitBlock(d,d.blocks[0].id,5);
eq(d.blocks.length,2,'split count'); eq(d.blocks[0].marks,[[0,5,'b']],'head marks'); eq(d.blocks[1].marks,[[0,6,'b']],'tail marks');

// merge back restores
const r=mergeBackward(d,nid); eq(d.blocks.length,1,'merged'); eq(d.blocks[0].text,'hello world','merged text'); eq(d.blocks[0].marks,[[0,11,'b']],'marks rejoined'); eq(r.offset,5,'caret at seam');

// list: backspace demotes type before merging
d=newDoc([newBlock('p','a'),newBlock('li','item')]);
mergeBackward(d,d.blocks[1].id); eq(d.blocks[1].t,'p','li->p first'); eq(d.blocks.length,2,'no merge yet');
mergeBackward(d,d.blocks[1].id); eq(d.blocks.length,1,'then merges');

// enter on empty list item exits list
d=newDoc([newBlock('li','')]); splitBlock(d,d.blocks[0].id,0);
eq(d.blocks.length,1,'no new block'); eq(d.blocks[0].t,'p','exited list');

// h1 enter -> p
d=newDoc([newBlock('h1','Title')]); splitBlock(d,d.blocks[0].id,5);
eq(d.blocks[1].t,'p','h1 enter makes body');

// multiline paste
d=newDoc([newBlock('p','ab')]); const res=insertText(d,d.blocks[0].id,1,'X\nY\nZ');
eq(d.blocks.map(x=>x.text),['aX','Y','Zb'],'multiline paste'); eq(res.offset,1,'caret after paste');

// setType toggles off
d=newDoc([newBlock('p','x')]); setType(d,d.blocks[0].id,'li'); eq(d.blocks[0].t,'li','set li');
setType(d,d.blocks[0].id,'li'); eq(d.blocks[0].t,'p','toggle off');

// coerce garbage
eq(coerce(null).blocks.length,1,'coerce null'); eq(coerce({blocks:[{text:'q'}]}).blocks[0].t,'p','coerce: a block with no type is body text');

// Forward compatibility: a block type this build does not know (a newer client's drawing)
// is kept whole, so saving the note here can never destroy it.
{
  const drawing = { id: 'dr', t: 'drawing', strokes: [[1, 2, 3]], w: 320, take: 'B' };
  const c = coerce({ v: 1, blocks: [{ id: 'a', t: 'p', text: 'before', marks: [] }, drawing, { id: 'c', t: 'p', text: 'after', marks: [] }] });
  eq(c.blocks[1].t, 'drawing', 'coerce keeps an unknown block type');
  eq([c.blocks[1].strokes, c.blocks[1].w, c.blocks[1].take], [[[1, 2, 3]], 320, 'B'], 'and every field it carried');
  eq(c.blocks[1].text, '', 'it gains an empty text so every reader of a doc still works');
  eq(coerce(JSON.parse(JSON.stringify(c))).blocks[1], c.blocks[1], 'a second load changes nothing');
  eq(mergeBackward(c, 'c'), null, 'Backspace at the start of the next line does not merge into it');
  eq(c.blocks.length, 3, 'and the doc is unchanged');
  eq(mergeForward(c, 'a'), null, 'Delete at the end of the line before does not pull it up');
  eq(mergeBackward(c, 'dr'), null, 'it cannot itself be merged');
  setType(c, 'dr', 'h1');
  eq(c.blocks[1].t, 'drawing', 'nor retyped');
}
eq(titleOf(newDoc([newBlock('p','  '),newBlock('p','Real')])),'Real','title skips blank');

// --- import: not one character lost ----------------------------------------
// The operator's requirement for leaving iOS Notes: "without losing a single sentence".
// The only permitted change is line terminators; each case below is something a naive
// split would have got wrong.
const { textToDoc, splitLines } = await import('../js/model/import.js');
const texts = d => d.blocks.map(x => x.text);

eq(splitLines('a\r\nb\r\n'), ['a','b'], 'CRLF: no \\r left on any line, trailing terminator ends the last line');
eq(splitLines('a\rb'), ['a','b'], 'a lone CR is a line break too');
eq(splitLines('a\n\n\nb'), ['a','','','b'], 'runs of blank lines survive — whitespace is the operator\'s structure');
eq(splitLines('a\n\n'), ['a',''], 'only ONE trailing terminator is dropped; a real blank last line stays');
eq(splitLines(''), [''], 'an empty file is one empty line, not zero');

const imp = textToDoc('🥤Today\r\n\r\n\tnoon call\r\n \r\n☀️🌞⛅️ x\r\n');
eq(texts(imp.doc), ['🥤Today','','\tnoon call',' ','☀️🌞⛅️ x'],
   'tabs, whitespace-only lines and emoji variation selectors are kept byte for byte');
eq(imp.doc.blocks.every(x => x.t === 'p'), true, 'an import infers no structure — it is the untouched record');
eq(imp.title, '🥤Today', 'title is the first line');

const o = textToDoc('\r\n\r\nNew Day\r\nline', { suffix: '(OLD)' });
eq(texts(o.doc), ['','','New Day (OLD)','line'], 'the suffix marks the first NON-BLANK line, which is what the title is');
eq(o.title, 'New Day (OLD)', 'and the title reflects it');
eq(textToDoc('x', { suffix: '   ' }).title, 'x', 'a blank suffix changes nothing');

// the round trip every stored note takes on every load
// Ends on a NON-blank line on purpose: text ending in a terminator ends its last line
// there (as `wc -l` counts it), which the trailing-blank cases above already pin down.
const big = Array.from({ length: 6000 }, (_, i) => i % 7 === 3 ? '' : 'line ' + i).join('\r\n');
const bd = textToDoc(big).doc;
eq(coerce(JSON.parse(JSON.stringify(bd))).blocks.map(x => x.text).join('\n'), big.split('\r\n').join('\n'),
   '6,000 lines survive JSON and coerce() unchanged');

// --- structured import (.atlasnote.json) ---------------------------------------
const { jsonToDoc, isNoteFile } = await import('../js/model/import.js');
const nf = blocks => JSON.stringify({ atlas: 'note', v: 1, title: 't', doc: { v: 1, blocks } });
const sj = jsonToDoc(nf([
  { id: 'a', t: 'p', text: 'Head', marks: [] },
  { id: 'b', t: 'check', text: 'call kids', marks: [], done: false, depth: 0 },
  { id: 'c', t: 'li', text: 'detail', marks: [], depth: 0 },
  { id: 'd', t: 'li', text: 'sub point', marks: [], depth: 1 },
]));
eq(sj.doc.blocks.map(b => [b.t, b.text, b.depth || 0]), [['p','Head',0],['check','call kids',0],['li','detail',0],['li','sub point',1]],
   'a note file keeps its checkboxes, bullets and hyphens (depth-1 bullets) exactly');
eq(isNoteFile('x.atlasnote.json', ''), true, 'recognised by extension');
eq(isNoteFile('x.txt', '{"atlas":"note"'), true, 'and by content, whatever the name');
eq(isNoteFile('x.txt', 'plain words'), false, 'plain text is not mistaken for a note file');
let refused = '';
try { jsonToDoc(nf([{ id: 'z', t: 'p', text: 5, marks: [] }])); } catch (e) { refused = e.message; }
eq(/refused/.test(refused), true, 'a block coerce() would drop is refused, not silently lost');
eq(jsonToDoc(nf([{ id: 'z', t: 'p', text: 'Title', marks: [] }, { id: 'y', t: 'drawing', text: '', strokes: [] }])).doc.blocks[1].t,
   'drawing', 'a note file from a newer build imports with its unknown blocks intact');
try { jsonToDoc('{"atlas":"something-else"}'); refused = ''; } catch (e) { refused = e.message; }
eq(/not an Atlas note/.test(refused), true, 'a JSON file that is not a note is refused');

// --- merge.js: the module the phone's Merge panel and tools/merge-notes.mjs share ---
const M = await import('../js/model/merge.js');
eq(M.unmark(['', 'New Day (OLD)', 'x']).join('|'), '|New Day|x', 'unmark drops the app\'s own (OLD) from the title line');
eq(M.unmark(['New Day', 'line (OLD)']).join('|'), 'New Day|line (OLD)', 'unmark touches only the first non-blank line');
const mo = ['Today', '', 'dream', 'attic room with friends', 'awkward three way call'];
const mn = ['New Day', '', 'dream', 'attic room with friends', 'awkward three way call', 'gym'];
const r1 = M.mergeNotes(mo, mn);
eq(r1.ok, true, 'a merge that keeps every line is ok');
eq(r1.title, 'New Day', 'the merge is titled by the newer note');
eq(r1.doc.blocks.filter(b => b.text === 'attic room with friends').length, 1, 'a copied run appears once');
const r2 = M.mergeNotes(mo, mn, { title: 'Merged' });
eq(r2.title, 'Merged', 'a chosen title leads the merge');
eq(r2.doc.blocks.some(b => b.text === 'New Day'), true, 'and the old first line stays below it, so renaming loses nothing');
const lost = M.prove([['kept line', 'a line that is gone']], newDoc([newBlock('p', 'kept line')]));
eq(lost.missing.length, 1, 'the proof names a line the merge would lose');

// --- 2026-10-17 review fixes ------------------------------------------------------
{
  const D = await import('../js/model/doc.js');
  // a malformed mark is skipped, not fatal for the whole note list
  const bad = D.coerce({ v: 1, blocks: [{ id: 'm', t: 'p', text: 'hello', marks: [null, 'x', [0, 'a', 'b'], [0, 2, 'b']] }] });
  eq(bad.blocks[0].marks, [[0, 2, 'b']], 'coerce skips malformed marks and keeps the good one');
  // ids become unique strings, so the DOM can find every block
  const ids = D.coerce({ v: 1, blocks: [{ id: 5, t: 'p', text: 'a' }, { id: 'x', t: 'p', text: 'b' }, { id: 'x', t: 'p', text: 'c' }] });
  eq(ids.blocks.every(b => typeof b.id === 'string'), true, 'coerce makes every block id a string');
  eq(new Set(ids.blocks.map(b => b.id)).size, 3, 'and every id unique');
  eq(ids.blocks[1].id, 'x', 'the first holder of an id keeps it');
  // same-type marks merge even with another mark between them in sort order
  const nm = D.toggleMark({ text: 'abcdefgh', marks: [[0, 3, 'b'], [2, 5, 'i']] }, 3, 6, 'b');
  eq(nm, [[0, 6, 'b'], [2, 5, 'i']], 'overlapping bold ranges merge across an italic');
  // titles never end in half an emoji
  const tt = D.titleOf(D.newDoc([D.newBlock('p', 'x'.repeat(119) + '😀 more')]));
  eq(/[\uD800-\uDBFF]$/.test(tt), false, 'a title cut at 120 never ends inside an emoji');
  // a newer build's block cannot be split, pasted into or marked
  const op = { v: 1, blocks: [{ id: 'dr', t: 'drawing', text: 'sketch', strokes: [1] }] };
  eq(D.splitBlock(op, 'dr', 2), null, 'splitBlock refuses an unknown block');
  eq(D.insertText(op, 'dr', 2, 'a\nb'), null, 'insertText refuses it');
  eq(D.toggleMark(op.blocks[0], 0, 3, 'b'), [], 'toggleMark leaves it unmarked');
  eq([op.blocks.length, op.blocks[0].text], [1, 'sketch'], 'and it is untouched');
  // a multi-line paste into an empty checklist item keeps the checklist item
  const ck = D.newDoc([D.newBlock('check', '')]);
  D.insertText(ck, ck.blocks[0].id, 0, 'milk\neggs');
  eq(ck.blocks.map(b => [b.t, b.text]), [['check', 'milk'], ['p', 'eggs']], 'pasting lines into an empty checklist item keeps it a checklist item');
  // merging a styled line into a code block brings no marks
  const cd = D.newDoc([D.newBlock('code', 'x=1'), Object.assign(D.newBlock('p', 'bold'), { marks: [[0, 4, 'b']] })]);
  D.mergeBackward(cd, cd.blocks[1].id);
  eq(cd.blocks[0].marks, [], 'a code block takes no marks from a merged line');
  // indentation stops at the deepest level the CSS draws
  const li = D.newDoc([0, 1, 2, 3, 4].map(() => D.newBlock('li', 'x')));
  for (let k = 1; k < 5; k++) for (let n = 0; n < 6; n++) D.indent(li, li.blocks[k].id, 1);
  eq(Math.max(...li.blocks.map(b => b.depth)), 3, 'indent stops at depth 3');
  // cutting a selection keeps marks on the characters they covered
  const cut = { text: 'hello world', marks: [[6, 11, 'b']] };
  D.cutRange(cut, 0, 6);
  eq([cut.text, cut.marks], ['world', [[0, 5, 'b']]], 'cutRange keeps the bold on "world"');
}
{
  const M = await import('../js/model/merge.js');
  // a routine repeated under two days in the older note, copied once into the newer
  const older = ['Mon', 'stretch for ten minutes', 'walk the dog around', 'make a big breakfast', '',
                 'Tue', 'stretch for ten minutes', 'walk the dog around', 'make a big breakfast'];
  const newer = ['Wed', 'stretch for ten minutes', 'walk the dog around', 'make a big breakfast'];
  const r = M.mergeNotes(older, newer);
  eq(r.doc.blocks.filter(b => b.text === 'walk the dog around').length, 2,
     'one copy in the newer note stands for ONE older day: the other day keeps its routine');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
