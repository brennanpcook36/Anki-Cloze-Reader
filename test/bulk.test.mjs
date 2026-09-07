import test from 'node:test';
import assert from 'node:assert/strict';
import bulk from '../src/bulk-utils.cjs';
const pages=[{page:20,text:'A meningioma is T1 hypointense.'},{page:21,text:'A meningioma is T2 bright.'}];
test('bulk rejects invalid ranges, duplicate pages and count limits',()=>{
 for(const payload of [{count:0,pages},{count:51,pages},{count:2,pages:[pages[0],pages[0]]},{count:2,pages:[]}])assert.throws(()=>bulk.validateBulk(payload));
 assert.equal(bulk.validateBulk({count:10,pages}).pages.length,2);
});
test('bulk keeps only valid source page references and cloze cards',()=>{
 const cards=[{page:20,cloze:'A meningioma is {{c1::T1 hypointense}}.'},{page:99,cloze:'This is {{c1::unsupported}}.'},{page:21,cloze:'No deletion.'}];
 assert.deepEqual(bulk.filterBulkCards(cards,pages,5),[cards[0]]);
});
test('bulk excludes facts already in the deck and duplicate candidates',()=>{
 const c={page:20,cloze:'A meningioma is {{c1::T1 hypointense}}.'};
 assert.deepEqual(bulk.filterBulkCards([c,c],pages,5,[c.cloze]),[]);
});
test('text-only Verbatim accepts exact source excerpts and rejects rewrites',()=>{
 const good={page:20,cloze:'A meningioma is {{c1::T1 hypointense}}.'};
 const rewrite={page:20,cloze:'Low T1 signal indicates a {{c1::lesion}}.'};
 assert.deepEqual(bulk.filterBulkCards([good,rewrite],pages,5,[],'verbatim'),[good]);
});
test('Interpretative cards must explicitly identify their subject',()=>{
 assert.equal(bulk.isSelfContainedCloze('The lesion is {{c1::T1 hypointense}}.'),false);
 assert.equal(bulk.isSelfContainedCloze('It most commonly affects the {{c1::frontal lobe}}.'),false);
 assert.equal(bulk.isSelfContainedCloze('A meningioma is typically {{c1::isointense to gray matter}} on T1-weighted MRI.'),true);
 assert.deepEqual(bulk.filterBulkCards([
  {page:20,cloze:'The lesion is {{c1::T1 hypointense}}.'},
  {page:20,cloze:'A meningioma is {{c1::T1 hypointense}}.'}
 ],pages,5,[],'interpretative'),[{page:20,cloze:'A meningioma is {{c1::T1 hypointense}}.'}]);
});
test('bulk handles insufficient source information without padding',()=>{
 assert.deepEqual(bulk.filterBulkCards([],pages,10),[]);
 assert.throws(()=>bulk.filterBulkCards([{},{}],pages,1));
});
