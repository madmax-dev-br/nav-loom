import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerStep,ruled,reattribute,apiDoubts} from '../../agent/apis.mjs';
import {CallLog} from '../../agent/network.mjs';

/** Home → (tap Produtos at t=1000) → Produtos → (tap item at t=3000) → Detalhe. */
const run=()=>({observations:[{id:'o0',screenId:'home'},{id:'o1',screenId:'list'},{id:'o2',screenId:'detail'}],steps:[{id:'s1',actedAt:1000,before:'o0',after:'o1',transitionId:'t1',network:[]},{id:'s2',actedAt:3000,before:'o1',after:'o2',transitionId:'t2',network:[]}]});
const graph=()=>({screens:[{id:'home',name:'Home'},{id:'list',name:'Produtos'},{id:'detail',name:'Detalhe'}],states:[{id:'h',screenId:'home'},{id:'l',screenId:'list'},{id:'d',screenId:'detail'}],transitions:[{id:'t1',from:'h',to:'l',name:'Produtos',confirmed:true,action:{type:'click'},apis:[]},{id:'t2',from:'l',to:'d',name:'item',confirmed:true,action:{type:'click'},apis:[]}]});

test('a call belongs to the last action before it started, not to the step whose drain read it',()=>{
 const r=run();assert.equal(ownerStep(r,{at:1400}).id,'s1','the list loading after the first tap');
 assert.equal(ownerStep(r,{at:3200}).id,'s2');assert.equal(ownerStep(r,{at:2950}).id,'s2','a call a moment before the tap is within the clock skew');
 assert.equal(ownerStep(r,{at:500}),undefined,'before any action: startup');assert.equal(ownerStep(r,{}).id,'s2','no time of its own: the latest step, as before');
 // A log line written after the response, read much later: begin is moved back by the duration.
 const log=new CallLog();const call=log.complete({method:'GET',url:'http://api/x',status:200,ms:300,source:'logcat',at:1700});assert.equal(call.t0,1400);assert.equal(log.drain().calls[0].at,1400);});

test('a rule moves an endpoint to the screen it belongs to, now and backwards from evidence',()=>{
 const g=graph(),r=run();r.steps[1].network=[{id:'c1',method:'GET',path:'/api/products',status:200,at:3100}];g.transitions[1].apis=[{method:'GET',path:'/api/products',statuses:[200],count:1}];
 g.apiRules=[{endpoint:'GET /api/products',screenId:'list',role:'load'}];
 assert.equal(ruled(g,r,r.steps[1].network[0],r.steps[1]).id,'s1','load of Produtos: the step that arrived there');
 const result=reattribute(g,[r]);assert.equal(result.moved,1);assert.deepEqual(g.transitions[0].apis.map(a=>a.path),['/api/products']);assert.deepEqual(g.transitions[1].apis,[]);assert.equal(r.steps[0].network[0].id,'c1');});

test('doubts: an endpoint usually loaded by one screen and seen once somewhere else',()=>{
 const g=graph();g.transitions[0].apis=[{method:'GET',path:'/api/products',statuses:[200],count:5}];g.transitions[1].apis=[{method:'GET',path:'/api/products',statuses:[200],count:1}];
 const [doubt]=apiDoubts(g);assert.equal(doubt.endpoint,'GET /api/products');assert.equal(doubt.usual,'ao chegar em Produtos');assert.equal(doubt.odd,'ao chegar em Detalhe');});
