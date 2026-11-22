import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {operations} from '../../agent/operations.mjs';
import {CallLog} from '../../agent/network.mjs';
import {answerOf,branchLines} from '../../agent/outcomes.mjs';
import {briefMemory} from '../../agent/brief.mjs';

const config={version:2,kind:'navloom-agent-project',id:'out',name:'Outcomes',targets:{app:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','scroll','back','wait'],deeplinkPrefixes:[],pluginCapabilities:['read_graph'],pluginImages:[]}};
const CONTROLS={cart:['pay'],receipt:['done'],declined:['retry']};
const elementId=name=>Buffer.from(name.padEnd(8,'_')).toString('hex').slice(0,16);
/** A checkout whose answer the test decides: approved leads to the receipt, declined to an error screen. Its log lines carry their own time. */
class Shop{
 constructor(world){this.world=world;this.screen='cart';this.calls=new CallLog();}
 async capabilities(){return {available:['capture','interact','hierarchy','logs'],missing:[]};}async start(){this.screen='cart';}async restart(){this.screen='cart';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){return {route:'/',screenKey:this.screen,title:this.screen,heading:this.screen,text:this.screen,xml:'<hierarchy/>',elements:CONTROLS[this.screen].map((name,i)=>({id:elementId(name),identity:name,name,actions:['click'],visible:true,bounds:{x:.1,y:.1+i*.1,width:.3,height:.08}})),viewport:{width:400,height:800},scroll:{y:0}};}
 async act(a,element){const name=element?.identity;if(name==='pay'){const declined=this.world.declined;const call=this.calls.begin({method:'POST',url:'http://api.test/api/checkout'});call.detail={responseBody:{json:{status:declined?'declined':'approved',orderId:'9f1c2a7e-0000-4000-8000-000000000000'}}};this.calls.end(call,declined?402:201);
  (this.lines??=[]).push({at:Date.now(),line:`I/Shop: checkout ${declined?'declined':'approved'}`});this.screen=declined?'declined':'receipt';}
  if(name==='done'||name==='retry')this.screen='cart';}
 linesBetween(from,to){return (this.lines??[]).filter(l=>l.at>=from&&l.at<to);}
 async network(){return this.calls.drain();}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t,world,review='auto'){const root=await mkdtemp(join(tmpdir(),'navloom-out-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new Shop(world)}).init();await r.configure({...config,review});return r;}
const pay=(r,run)=>r.step(run.id,{type:'click',elementId:elementId('pay')});

test('the deciding values of an answer: status fields, never ids, dates or masked values',()=>{
 assert.equal(answerOf({json:{status:'declined',orderId:'9f1c2a7e-0000-4000-8000-000000000000',createdAt:'2026-11-21T10:00:00Z',token:'[REDACTED]'}}),'status=declined');
 assert.equal(answerOf({json:{data:{result:'ok'},items:[]}}),'data.result=ok items=empty');assert.equal(answerOf({text:'plain'}),'');});

test('N answers, N states: each destination keeps the answer that explains it, and validation calls a new answer a variant',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'app',mode:'record',objective:'Comprar'});await pay(r,run);await r.finish(run.id);
 world.declined=true;const check=await r.start({target:'app',mode:'validate',objective:'Comprar de novo'});await pay(r,check);const done=await r.finish(check.id);
 const variant=done.changes.items.find(i=>i.kind==='response');assert.equal(variant.type,'variant');assert.match(variant.text,/POST \/api\/checkout 402 status=declined/);assert.match(variant.text,/201 status=approved/);
 const graph=await r.store.graph();const [line]=branchLines(graph);assert.match(line,/"pay" em Cart: POST \/api\/checkout 201 status=approved → Receipt .* \| POST \/api\/checkout 402 status=declined → Declined/);
 assert.ok(briefMemory(await r.memory({detail:'full'})).responseVariants[0].includes('status=declined'));
 assert.match(await r.screenContext({screen:'Cart'}),/Depende da resposta: "pay"/);await r.close();});

test('each step keeps the app log lines written while it happened, readable after the mission ends',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'app',mode:'record',objective:'Logs'});await pay(r,run);await r.finish(run.id);
 const ops=operations(r,{list:()=>[]}),logs=await ops.logs.call({runId:run.id,step:0});assert.equal(logs.action,'click');assert.equal(logs.lines.length,1);assert.match(logs.lines[0],/checkout approved$/);
 await assert.rejects(ops.logs.call({runId:run.id,step:5}),/Run has 1 steps/);await r.close();});

test('capture scripts written by a person show and keep what they want on each screen',async t=>{const world={},r=await setup(t,world);const ops=operations(r,{list:()=>[]});
 const code=`function run(input){const call=input.apis.find(a=>a.path==='/api/checkout');return call?{fields:{Pagamento:call.answer,Status:call.status},tags:call.status>=400?['recusado']:[]}:null;}`;
 const tried=await ops.harness_try.call({kind:'capture',code,input:{apis:[{method:'POST',path:'/api/checkout',status:402,answer:'status=declined'}]}});assert.deepEqual(tried,{ok:true,value:{fields:{Pagamento:'status=declined',Status:402},tags:['recusado']}});
 assert.equal((await ops.harness_try.call({kind:'capture',code:'function run(){ return {fields:1}; }'})).ok,false,'a wrong output is reported, not saved');
 const proposed=await ops.harness_propose.call({id:'pagamento',kind:'capture',name:'Pagamento',code,samples:[{input:{apis:[]},expect:null}]},'interface');assert.equal(proposed.author,'user');
 assert.equal((await r.harness.review('pagamento','approve')).status,'active');
 world.declined=true;const run=await r.start({target:'app',mode:'record',objective:'Recusado'});const step=await pay(r,run);await r.finish(run.id);
 assert.deepEqual(step.observation.info.pagamento.fields,{Pagamento:'status=declined',Status:402});
 const state=(await r.store.graph()).states.find(s=>s.id===step.observation.stateId);assert.deepEqual(state.info.pagamento.tags,['recusado']);await r.close();});
