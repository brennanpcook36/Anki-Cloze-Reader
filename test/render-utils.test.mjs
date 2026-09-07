import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSequence, renderIsCurrent } from '../src/renderer/render-utils.mjs';

test('PDF page slots are always created in source order',()=>{
 assert.deepEqual(pageSequence(5),[1,2,3,4,5]);
 assert.deepEqual(pageSequence(0),[]);
 assert.deepEqual(pageSequence(-1),[]);
});

test('stale PDF render sessions cannot update the active viewer',()=>{
 const firstPdf={},secondPdf={};
 assert.equal(renderIsCurrent(3,3,firstPdf,firstPdf),true);
 assert.equal(renderIsCurrent(2,3,firstPdf,firstPdf),false);
 assert.equal(renderIsCurrent(3,3,firstPdf,secondPdf),false);
});
