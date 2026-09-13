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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
