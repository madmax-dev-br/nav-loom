import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const load=async name=>{const source=await readFile(new URL(`../../lib/${name}.ts`,import.meta.url),'utf8'),{outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));};
const {pendingStep,PENDING_SCREEN}=await load('agent-screen-routes'),{layoutColumns,placePending,COLUMN_GAP}=await load('agent-map-layout');
const capture=(id,screenId,stateId)=>({id,screenId,stateId,elements:[{id:'e1',identity:'buy',label:'Comprar'}]});
test('a live mission says which screen it is on and which action is still waiting for its capture',()=>{
 const run={status:'running',observations:[capture('o1','A','a')],steps:[]};
 assert.deepEqual(pendingStep(run),{fromScreen:'A',fromState:'a',acting:false,actionType:undefined,elementIdentity:undefined,name:undefined},'on a screen with nothing dispatched: the next screen is unknown but coming');
 run.steps.push({before:'o1',status:'running',action:{type:'click',elementId:'e1'}});
 assert.deepEqual(pendingStep(run),{fromScreen:'A',fromState:'a',acting:true,actionType:'click',elementIdentity:'buy',name:'Comprar'});
 // The capture is recorded before the step is closed: from then on the placeholder leaves from the new screen.
 run.observations.push(capture('o2','B','b'));
 assert.equal(pendingStep(run).fromScreen,'B');assert.equal(pendingStep(run).acting,false);
});
test('no placeholder without a running mission or before its first capture',()=>{
 for(const status of ['paused','blocked','completed'])assert.equal(pendingStep({status,observations:[capture('o1','A','a')],steps:[]}),null);
 assert.equal(pendingStep({status:'running',observations:[],steps:[]}),null);assert.equal(pendingStep(undefined),null);assert.equal(pendingStep(null),null);
});
test('the placeholder takes no place in the columns, so it moves no known screen',()=>{
 const ids=['A','B','C','D'],links=[{fromScreen:'A',toScreen:'B'},{fromScreen:'A',toScreen:'C'},{fromScreen:'B',toScreen:'D'}];
 const plain=layoutColumns(ids,links);
 for(const from of ['A','B','D','unknown']){const live=layoutColumns(ids,links,{id:PENDING_SCREEN,from});assert.deepEqual(live.columns,plain.columns,`from ${from}`);for(const id of ids)assert.equal(live.depth.get(id),plain.depth.get(id));}
 assert.equal(layoutColumns(ids,links,{id:PENDING_SCREEN,from:'A'}).depth.get(PENDING_SCREEN),1,'it still counts as one step after its source');
 assert.equal(layoutColumns(ids,links,{id:PENDING_SCREEN,from:'unknown'}).depth.has(PENDING_SCREEN),false,'a screen that is not on display gets no placeholder');
});
test('the placeholder sits right beside its source, level with it, and never over a card',()=>{
 // Three columns 656 apart, cards 216x545; the middle column has two cards, the last one only at the top.
 const card=(x,y)=>({x,y,width:216,height:545}),size={width:216,height:545},A=card(80,44),B=card(736,44),B2=card(736,645),C=card(1392,44),cards=[A,B,B2,C];
 const hits=(spot,other)=>spot.x<other.x+other.width&&spot.x+size.width>other.x&&spot.y<other.y+other.height&&spot.y+size.height>other.y;
 // Free slot in the next column, level with the source: taken as is.
 assert.deepEqual(placePending(B2,size,{columnX:1392,cards}),{x:1392,y:645,slot:'column'});
 // Slot taken: it stays level with the source, in the gap between the two columns, over no card.
 const gap=placePending(A,size,{columnX:736,cards});
 assert.equal(gap.slot,'gap');assert.equal(gap.y,A.y);assert.ok(gap.x>=A.x+A.width+64&&gap.x+size.width<=736-24,'inside the gap');assert.ok(cards.every(other=>!hits(gap,other)));
 // Labels in the gap are avoided when another spot in the gap is free of them, but never at the cost of covering a card.
 const labelled=placePending(A,size,{columnX:736,cards,labels:[{x:380,y:100,width:60,height:30}]});
 assert.equal(labelled.slot,'gap');assert.ok(labelled.x>gap.x,'steps away from the label');assert.ok(cards.every(other=>!hits(labelled,other)));
 // From the last column a new column opens at the usual distance.
 assert.deepEqual(placePending(C,size,{cards}),{x:C.x+C.width+COLUMN_GAP,y:C.y,slot:'column'});
 // Wherever the source is, the result is at most one gap away from it horizontally.
 for(const source of cards){const spot=placePending(source,size,{columnX:source===C?undefined:source.x+656,cards});assert.ok(spot.x-(source.x+source.width)<=COLUMN_GAP);assert.ok(cards.every(other=>!hits(spot,other)));}
});
