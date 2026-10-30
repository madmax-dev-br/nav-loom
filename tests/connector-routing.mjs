import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const code=ts.transpileModule(await readFile(new URL('../lib/connector-routing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {splitRoute,overlappingLength}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const box={x:40,y:20,width:20,height:60};
for(const points of [[{x:0,y:50},{x:100,y:50}],[{x:100,y:50},{x:0,y:50}],[{x:50,y:0},{x:50,y:100}],[{x:50,y:100},{x:50,y:0}]]){
 const route=splitRoute(points,[box],'4');assert.equal(route.segments.length,2);assert.equal(route.continuations.length,1);assert.equal(route.continuations[0].label,'4.1');assert.deepEqual(route.segments[0].end,route.continuations[0].start);assert.deepEqual(route.segments[1].start,route.continuations[0].end);
}
const bent=splitRoute([{x:0,y:50},{x:50,y:50},{x:50,y:100}],[box],'8');assert.deepEqual(bent.continuations,[{start:{x:40,y:50},end:{x:50,y:80},label:'8.1'}]);
const merged=splitRoute([{x:0,y:50},{x:100,y:50}],[box,{...box,x:50}],'2');assert.equal(merged.continuations.length,1);assert.equal(merged.continuations[0].end.x,70);
assert.equal(splitRoute([{x:0,y:10},{x:100,y:10}],[box],'1').continuations.length,0);
assert.equal(overlappingLength({start:{x:0,y:10},end:{x:100,y:10}},{start:{x:120,y:10},end:{x:30,y:10}}),70);
assert.equal(overlappingLength({start:{x:0,y:10},end:{x:100,y:10}},{start:{x:50,y:0},end:{x:50,y:100}}),0);
console.log('Forward, reverse, vertical, overlapping obstacle clipping and shared lane detection passed.');
