import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {briefMove} from '../../agent/brief.mjs';
import {operations} from '../../agent/operations.mjs';
import {CallLog} from '../../agent/network.mjs';

const config={version:2,kind:'navloom-agent-project',review:'auto',id:'nav',name:'Nav app',targets:{app:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:['app://'],pluginCapabilities:['read_graph'],pluginImages:[]}};
const CONTROLS={home:['list','account'],list:['item','home_tab'],detail:['buy','home_tab'],promo:['later'],login:['email','enter'],account:['logout','orders'],error:['retry'],receipt:['done'],maintenance:['continue'],orders:['order','home_tab']};
const BACK={promo:'home',list:'home',detail:'list',login:'home',account:'home',orders:'home'};
const elementId=name=>Buffer.from(name.padEnd(8,'_')).toString('hex').slice(0,16);
/** A small app whose behaviour the test changes between launches: `world` outlives the executor of each mission. */
class App{
 constructor(world){this.world=world;this.screen='home';this.typed='';this.calls=new CallLog();}
 async capabilities(){return {available:['capture','interact','hierarchy','logs'],missing:[]};}
 async start(){this.screen=this.world.entry??'home';this.typed='';this.world.launches=(this.world.launches??0)+1;}async restart(){this.world.restarts=(this.world.restarts??0)+1;this.screen=this.world.entry??'home';this.typed='';}
 async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){const names=[...CONTROLS[this.screen],...(this.screen==='home'&&this.world.banner?['banner']:[])];
  return {route:'/',screenKey:this.screen,title:this.screen,heading:this.screen,text:this.screen,xml:'<hierarchy/>',elements:names.map((name,i)=>({id:elementId(name),identity:name,name,actions:name==='email'?['fill']:['click'],visible:true,bounds:{x:.1,y:.1+i*.1,width:.3,height:.08}})),viewport:{width:400,height:800},scroll:{y:0}};}
 async act(a,element){this.world.acts=(this.world.acts??0)+1;
  if(a.type==='back'){this.screen=BACK[this.screen]??this.screen;return;}if(a.type==='deeplink'){this.screen=this.world.session?'orders':'login';return;}
  if(a.type==='fill'){this.typed=a.value;return;}if(a.type!=='click')return;
  const next={list:()=>this.world.promo-->0?'promo':'list',item:()=>'detail',buy:()=>{this.world.bought=(this.world.bought??0)+1;this.calls.end(this.calls.begin({method:'POST',url:'http://api.test/api/orders'}),201);return 'receipt';},done:()=>'home',home_tab:()=>'home',account:()=>'login',enter:()=>{if(!this.typed)return 'error';this.world.session=true;return 'account';},continue:()=>'home',orders:()=>'orders',later:()=>'home',retry:()=>'login'}[element.identity];if(next)this.screen=next();}
 async network(){return this.calls.drain();}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t,world={}){const root=await mkdtemp(join(tmpdir(),'navloom-nav-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new App(world)}).init();await r.configure(config);return r;}
const click=(r,run,name)=>r.step(run.id,{type:'click',elementId:elementId(name)});
/** What an agent does once: walk to the product, then log in. */
async function learn(r){const run=await r.start({target:'app',mode:'exploratory',objective:'Learn'});await click(r,run,'list');await click(r,run,'item');await r.step(run.id,{type:'back'});await r.step(run.id,{type:'back'});
 await click(r,run,'account');await r.step(run.id,{type:'fill',elementId:elementId('email'),value:'ana@test.dev'});await click(r,run,'enter');return r.finish(run.id);}

test('goto opens the app by itself and reaches a learned screen without one agent call',async t=>{const world={},r=await setup(t,world);await learn(r);
 const plan=await r.goto({mode:'record',target:'app',screen:'Detail',plan:true});assert.equal(plan.status,'planned');assert.deepEqual(plan.decisions.map(d=>[d.from,d.do,d.to]),[['List','click item','Detail'],['Home','click list','List']]);assert.equal(world.launches,1,'a plan touches no device');
 const moved=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(moved.status,'arrived');assert.equal(moved.started,true);assert.equal(moved.steps,2);assert.equal(moved.recoveries,0);assert.equal(moved.observation.screenKey,'detail');
 const brief=await briefMove(moved,r.store);assert.equal(brief.runId,moved.runId);assert.equal(brief.status,'arrived');
 const run=await r.finish(moved.runId);assert.equal(run.metrics.agentCalls,0);assert.equal(run.metrics.replayedSteps,2);assert.match(run.objective,/Detail/);
 const memo=(await r.store.graph()).routes[(await r.store.graph()).screens.find(s=>s.name==='Detail').id];assert.equal(memo.runs,1);assert.equal(memo.arrived,1);assert.equal(memo.bestSteps,2);assert.equal(memo.lastStatus,'arrived');await r.close();});

test('a screen whose content changed is still recognised and its known control used',async t=>{const world={},r=await setup(t,world);await learn(r);world.banner=true;
 const moved=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(moved.status,'arrived');assert.equal(moved.steps,2);
 const graph=await r.store.graph(),home=graph.screens.find(s=>s.name==='Home');assert.equal(graph.states.filter(s=>s.screenId===home.id).length,2,'the changed home is a new state of the same screen');
 // The new state is now known in its own right: the second time it is an exact decision.
 await r.finish(moved.runId);const again=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(again.status,'arrived');assert.ok(again.results.every(x=>x.status==='completed'));await r.close();});

test('a detour through a screen never seen is left with back and the walk continues',async t=>{const world={},r=await setup(t,world);await learn(r);world.promo=1;
 const moved=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(moved.status,'arrived');assert.equal(moved.recoveries,1);assert.equal(moved.observation.screenKey,'detail');
 const graph=await r.store.graph();assert.ok(graph.screens.some(s=>s.name==='Promo'),'the detour itself became part of the map');assert.ok(graph.transitions.some(e=>e.evidence.some(x=>x.diverged)),'the divergence is kept as evidence');await r.close();});

test('a form is filled again with what was typed when the route was learned',async t=>{const world={},r=await setup(t,world);await learn(r);
 const moved=await r.goto({mode:'record',target:'app',screen:'Account'});assert.equal(moved.status,'arrived');assert.equal(moved.observation.screenKey,'account');assert.deepEqual(moved.results.map(x=>x.step.action.type),['click','fill','click']);
 assert.equal((await r.finish(moved.runId)).metrics.agentCalls,0);await r.close();});

test('stuck on unknown ground: the agent takes a step, and the next goto has learned it',async t=>{const world={entry:'maintenance'},r=await setup(t,world);world.entry='home';await learn(r);world.entry='maintenance';
 const first=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(first.status,'stuck');assert.equal(first.steps,0);assert.equal(first.observation.screenKey,'maintenance');assert.match(first.reason,/No known action/);assert.ok(first.hint);assert.equal(first.runStatus,'running','the mission stays open for the agent');assert.equal(world.restarts,1,'its own mission begins with a cold start, once');
 const graph=await r.store.graph(),detail=graph.screens.find(s=>s.name==='Detail');assert.equal(graph.routes[detail.id].stuckAt,graph.screens.find(s=>s.name==='Maintenance').id);
 // One step by the agent, then the same mission is carried on without it.
 await click(r,{id:first.runId},'continue');const rest=await r.goto({screen:'Detail'});assert.equal(rest.status,'arrived');assert.equal(rest.runId,first.runId);assert.equal(rest.started,false);assert.equal((await r.finish(first.runId)).metrics.agentCalls,1);
 const second=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(second.status,'arrived');assert.equal(second.steps,3,'maintenance → home → list → detail');assert.equal((await r.finish(second.runId)).metrics.agentCalls,0);
 const memo=(await r.store.graph()).routes[detail.id];assert.equal(memo.runs,3);assert.equal(memo.arrived,2);assert.equal(memo.stuckAt,undefined);await r.close();});

test('a deeplink that needs a session falls back to the taps, and the miss is remembered',async t=>{const world={},r=await setup(t,world);await learn(r);
 const run=await r.start({target:'app',mode:'exploratory',objective:'Orders'});await click(r,run,'account');await r.step(run.id,{type:'fill',elementId:elementId('email'),value:'ana@test.dev'});await click(r,run,'enter');await click(r,run,'orders');await r.step(run.id,{type:'back'});
 assert.equal((await r.step(run.id,{type:'deeplink',url:'app://orders'})).observation.screenKey,'orders');await r.finish(run.id);
 // A new launch has no session: the link, the shortest way, lands on login. The walk carries on from there with what it knows.
 world.session=false;const cold=await r.goto({mode:'record',target:'app',screen:'Orders'});assert.equal(cold.status,'arrived');assert.deepEqual(cold.results.map(x=>[x.step.action.type,x.status]),[['deeplink','diverged'],['fill','completed'],['click','completed'],['click','completed']]);
 const link=(await r.store.graph()).transitions.find(e=>e.action.type==='deeplink'&&e.walks);assert.equal(link.misses,1);
 await r.finish(cold.runId);const next=await r.goto({mode:'record',target:'app',screen:'Orders'});assert.equal(next.status,'arrived');assert.notEqual(next.results[0].step.action.type,'deeplink','the steadier taps are preferred after the miss');await r.close();});

test('getting somewhere never buys anything on the way: a write off the needed route is not followed',async t=>{const world={},r=await setup(t,world);await learn(r);
 // The only recorded way forward from the product is buying it, which ends at home.
 const run=await r.start({target:'app',mode:'exploratory',objective:'Buy'});await click(r,run,'list');await click(r,run,'item');const bought=await click(r,run,'buy');assert.equal(bought.step.network[0].method,'POST');await click(r,run,'done');await click(r,run,'list');await click(r,run,'item');
 assert.equal(world.bought,1);const plan=await r.goto({runId:run.id,screen:'Account',plan:true});assert.ok(!plan.decisions.some(d=>d.do==='click buy'),JSON.stringify(plan.decisions));
 const moved=await r.goto({runId:run.id,screen:'Account'});assert.equal(moved.status,'arrived');assert.equal(world.bought,1,'no second purchase');assert.ok(moved.recoveries>=1);await r.close();});

test('a tab that leads home from two screens is used from a third where it was never tapped',async t=>{const world={},r=await setup(t,world);await learn(r);
 const tabs=await r.start({target:'app',mode:'exploratory',objective:'Tabs'});for(const name of ['list','home_tab','list','item','home_tab'])await click(r,tabs,name);await r.finish(tabs.id);
 const run=await r.start({target:'app',mode:'exploratory',objective:'Orders'});await click(r,run,'account');await r.step(run.id,{type:'fill',elementId:elementId('email'),value:'ana@test.dev'});await click(r,run,'enter');await click(r,run,'orders');
 const moved=await r.goto({runId:run.id,screen:'Detail'});assert.equal(moved.status,'arrived');assert.equal(moved.recoveries,0);assert.deepEqual(moved.results.map(x=>x.observation.screenKey),['home','list','detail']);await r.close();});

test('the goto tool needs no mission id and tells the agent which mission it opened',async t=>{const world={},r=await setup(t,world);await learn(r);const ops=operations(r,{list:()=>[]});
 const args=ops.goto.schema.parse({screen:'Detail'}),full=await ops.goto.call(args,'mcp-test'),brief=await ops.goto.brief(full,args);
 assert.equal(brief.status,'arrived');assert.equal(brief.runId,full.runId);assert.equal(brief.screen.name,'Detail');assert.equal((await r.store.run(full.runId)).owner,'mcp-test');assert.ok(JSON.stringify(brief).length<700,JSON.stringify(brief));await r.close();});
