import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const main = fs.readFileSync(new URL('../src/main.cjs', import.meta.url), 'utf8');
const batch = main.slice(main.indexOf('async function requestClozeBatch'), main.indexOf('ipcMain.handle("openai:generate-cloze"'));
async function run(cards, existing=[]) {
 const context = vm.createContext({ responseText: d=>d.output_text, fetch: async()=>({ok:true,json:async()=>({output_text:JSON.stringify({cards})})}) });
 vm.runInContext(batch, context);
 return JSON.parse(JSON.stringify(await context.requestClozeBatch('test', [], 5, existing)));
}
test('batch accepts fewer supported facts, including none', async()=>{
 assert.deepEqual(await run([]), {cards:[]});
 assert.equal((await run(['A is {{c1::B}}.'])).cards.length,1);
});
test('batch removes repeated statements despite punctuation or cloze placement', async()=>{
 assert.deepEqual(await run(['A is {{c1::B}}.', '{{c1::A}} is B!', 'C is {{c1::D}}.'], ['A is {{c1::B}}.']), {cards:['C is {{c1::D}}.']});
});

test('Study Profile is included only for Interpretative requests', () => {
 const start = main.indexOf('function profileInstruction');
 const end = main.indexOf('ipcMain.handle("openai:improve-card"', start);
 const context = vm.createContext({}); vm.runInContext(main.slice(start,end),context);
 assert.equal(context.profileInstruction({studyProfile:'Radiology resident'}, 'verbatim'),'');
 assert.match(context.profileInstruction({studyProfile:'Radiology resident'}, 'interpretative'), /Radiology resident/);
 assert.equal(context.profileInstruction({studyProfile:''}, 'interpretative'),'');
});

test('placement preserves image occlusion and supports front/back/neither', () => {
 const app=fs.readFileSync(new URL('../src/renderer/app.mjs', import.meta.url),'utf8');
 const context=vm.createContext({}); vm.runInContext(app.match(/function placement\(item\) \{[^\n]+/)[0],context);
 assert.equal(context.placement({frontImageId:'masked',imagePlacement:'none'}),'occlusion');
 assert.equal(context.placement({originalImageId:'source'}),'front-below');
 assert.equal(context.placement({imagePlacement:'back'}),'back');
 assert.equal(context.placement({imagePlacement:'none'}),'none');
});
