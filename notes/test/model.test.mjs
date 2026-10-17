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
eq(coerce(null).blocks.length,1,'coerce null'); eq(coerce({blocks:[{t:'bogus',text:'q'}]}).blocks[0].t,'p','coerce bad type');
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
try { jsonToDoc(nf([{ id: 'z', t: 'bogus', text: 'q', marks: [] }])); } catch (e) { refused = e.message; }
eq(/refused/.test(refused), true, 'a block coerce() would rewrite is refused, not silently changed');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
