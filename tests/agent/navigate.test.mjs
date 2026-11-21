import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {briefMove,briefMemory} from '../../agent/brief.mjs';
import {operations} from '../../agent/operations.mjs';
import {CallLog} from '../../agent/network.mjs';

const config={version:2,kind:'navloom-agent-project',review:'auto',id:'nav',name:'Nav app',targets:{app:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:['app://'],pluginCapabilities:['read_graph'],pluginImages:[]}};
const CONTROLS={home:['list','account'],list:['item','home_tab'],detail:['buy','home_tab'],promo:['later'],login:['email','enter'],account:['logout','orders'],error:['retry'],receipt:['done'],maintenance:['continue'],orders:['order','home_tab']};
const BACK={promo:'home',list:'home',detail:'list',login:'home',account:'home',orders:'home'};
const elementId=name=>Buffer.from(name.padEnd(8,'_')).toString('hex').slice(0,16);
/** A small app whose behaviour the test changes between launches: `world` outlives the executor of each mission. */
class App{
 constructor(world,target){this.world=world;this.target=target;this.screen='home';this.typed='';this.calls=new CallLog();}
 /** The mock environment (port 4791) opens straight at the product list and is always signed in. */
 get mock(){return this.target?.url?.includes(':4791');}
 get entry(){return this.mock?'list':this.world.entry??'home';}
 async capabilities(){return {available:['capture','interact','hierarchy','logs'],missing:[]};}
 async start(){this.screen=this.entry;this.typed='';this.world.launches=(this.world.launches??0)+1;}async restart(){this.world.restarts=(this.world.restarts??0)+1;this.screen=this.entry;this.typed='';}
 async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){const names=[...CONTROLS[this.screen],...(this.screen==='home'&&this.world.banner?['banner']:[])];
  const down=this.screen==='list'&&this.world.listDown?[{id:elementId('down'),identity:'down',name:'Não foi possível carregar os produtos',text:'Não foi possível carregar os produtos',actions:[],visible:true,bounds:{x:.1,y:.5,width:.8,height:.04}}]:[];
  return {route:'/',screenKey:this.screen,title:this.screen,heading:this.screen,text:this.screen,xml:'<hierarchy/>',elements:[...names.map((name,i)=>({id:elementId(name),identity:name,name,actions:name==='email'?['fill']:['click'],visible:true,bounds:{x:.1,y:.1+i*.1,width:.3,height:.08}})),...down],viewport:{width:400,height:800},scroll:{y:0}};}
 async act(a,element){this.world.acts=(this.world.acts??0)+1;
  if(a.type==='back'){this.screen=BACK[this.screen]??this.screen;return;}if(a.type==='deeplink'){this.screen=this.world.session?'orders':'login';return;}
  if(a.type==='fill'){this.typed=a.value;return;}if(a.type!=='click')return;
  const next={list:()=>this.world.promo-->0?'promo':'list',item:()=>'detail',buy:()=>{this.world.bought=(this.world.bought??0)+1;this.calls.end(this.calls.begin({method:'POST',url:'http://api.test/api/orders'}),201);return 'receipt';},done:()=>'home',home_tab:()=>'home',account:()=>this.mock?'orders':'login',enter:()=>{if(!this.typed)return 'error';this.world.session=true;return 'account';},continue:()=>'home',orders:()=>'orders',later:()=>'home',retry:()=>'login'}[element.identity];if(next)this.screen=next();}
 async network(){return this.calls.drain();}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t,world={}){const root=await mkdtemp(join(tmpdir(),'navloom-nav-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:target=>new App(world,target)}).init();await r.configure(config);return r;}
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
 const graph=await r.store.graph(),home=graph.screens.find(s=>s.name==='Home');assert.equal(graph.states.filter(s=>s.screenId===home.id).length,1,'a banner more is the same state of the same screen: its controls are nearly the same');
 // The changed home is the known state, so the second time is an exact decision too.
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

/** Two places for the same app: staging starts at Home and needs the sign-in, the mock opens at the product list already signed in. */
const environments={staging:{description:'Real backend'},mock:{description:'Mock backend, opens at products',targets:{app:{url:'http://127.0.0.1:4791',origins:['http://127.0.0.1:4791']}}}};
test('environments share screens and routes; each keeps where it opens',async t=>{const world={},r=await setup(t,world);await r.configure({...config,environments});
 const learned=await learn(r);assert.equal(learned.environment,'staging','the first declared environment is the default');
 const moved=await r.goto({mode:'record',target:'app',environment:'mock',screen:'Detail'});assert.equal(moved.status,'arrived');assert.equal(moved.steps,1,'the mock opens at the list: one tap, learned in staging');
 const run=await r.finish(moved.runId);assert.equal(run.environment,'mock');assert.equal(run.metrics.agentCalls,0);
 const graph=await r.store.graph(),screen=name=>graph.screens.find(s=>s.name===name),state=id=>graph.states.find(s=>s.id===id);
 assert.equal(graph.entries.app,undefined,'entries are kept per environment');assert.equal(state(graph.entries['app@mock'])?.screenId,screen('List').id);
 assert.deepEqual(screen('List').environments.sort(),['mock','staging']);assert.deepEqual(screen('Login').environments,['staging']);
 const edges=graph.transitions.filter(e=>e.name==='item');assert.deepEqual(edges.map(e=>e.environment??'staging').sort(),['mock','staging'],'the tap is now confirmed in the mock too');
 const memory=briefMemory(await r.memory({detail:'full'}));assert.equal(memory.project.environments.mock.opensAt,'List');assert.deepEqual(memory.screens.find(s=>s.name==='Login').onlyEnvironments,['staging']);
 await assert.rejects(r.start({target:'app',environment:'prod',mode:'walk',objective:'x'}),/Unknown environment/);await r.close();});

test('validating in another environment reports how it differs as a variation, not as a regression',async t=>{const world={},r=await setup(t,world);await r.configure({...config,review:'required',environments});await learn(r);await r.decideReview?.({runId:(await r.store.runs())[0].id,decision:'approve'}).catch(()=>{});
 const run=await r.start({target:'app',environment:'mock',mode:'validate',objective:'Check the mock'});await r.step(run.id,{type:'back'});await click(r,run,'account');const done=await r.finish(run.id);
 const items=done.changes.items;assert.ok(items.some(i=>i.type==='variant'&&/Varia por ambiente/.test(i.text)&&/mock/.test(i.text)),JSON.stringify(items));assert.equal(done.changes.counts.different,0,'nothing contradicts the same environment');
 assert.ok(!items.some(i=>i.kind==='transition'&&/List para Home/.test(i.text)),'a way already recorded elsewhere to the same screen is just confirmed');await r.close();});

test('the agent asks which account to use; a person creates it and the sign-in stays local',async t=>{const r=await setup(t,{});
 const asked=await r.ask({kind:'account',question:'Preciso de uma conta premium'});assert.equal(asked.status,'pending');assert.deepEqual(asked.request.options,['default']);
 await assert.rejects(r.answer({requestId:asked.request.id,account:{id:'premium',password:'x'},via:'chat'},'mcp-x'),/Only a person/);
 const answered=await r.answer({requestId:asked.request.id,account:{id:'premium',description:'Conta premium',login:'pri@test.dev',password:'s3cret'}},'interface');assert.deepEqual(answered.entry.answer,{type:'profile',profile:'premium'});
 const config=await r.store.config();assert.deepEqual(Object.keys(config.profiles.premium.secrets).sort(),['premium_login','premium_password']);assert.ok(!JSON.stringify(config).includes('s3cret'));assert.ok(!JSON.stringify(await r.store.graph()).includes('s3cret'));
 const again=await r.ask({kind:'account',question:'Preciso de uma conta premium'});assert.equal(again.status,'known');
 const run=await r.start({target:'app',profile:'premium',mode:'walk',objective:'Entrar'});await click(r,run,'account');const filled=await r.step(run.id,{type:'fill',elementId:elementId('email'),secretRef:'premium_login'});assert.equal(filled.status,'completed');await r.finish(run.id);await r.close();});

test('entry points: every screen says where it starts, and a stalled walk says why, for the agent to judge',async t=>{const world={},r=await setup(t,world);await learn(r);
 const {entryPoints,entryLines}=await import('../../agent/flowgraph.mjs');let points=entryPoints(await r.store.graph(),{target:'app'});
 const named=name=>Object.values(points.screens).find(s=>s.name===name);
 assert.deepEqual(points.entries.map(e=>e.screen),['Home']);assert.deepEqual(named('Detail').start.default.path,['Home','List','Detail']);assert.equal(named('Detail').start.default.steps,2);
 assert.deepEqual(named('Account').start.default.path,['Home','Login','Account'],'the form on the login screen is part of the way');assert.deepEqual(named('Detail').from,['List']);
 // A deeplink that always lands on one screen, and a flow named by the agent, are entry points too.
 const run=await r.start({target:'app',mode:'record',objective:'Atalhos'});world.session=true;await r.step(run.id,{type:'deeplink',url:'app://orders'});await r.finish(run.id);
 await r.organize({flows:[{id:'buy',name:'Compra',screenIds:['List','Detail']}]});points=entryPoints(await r.store.graph(),{target:'app'});
 assert.deepEqual(named('Orders').deeplinks,['app://orders']);assert.equal(points.flows[0].startsAt,'List');
 const lines=entryLines(points);assert.ok(lines.some(l=>l.startsWith('abre em Home')));assert.ok(lines.some(l=>/^Detail ← 2 passos desde a abertura: Home → List → Detail/.test(l)));assert.ok(lines.includes('fluxo Compra começa em List'));
 const memory=briefMemory(await r.memory({detail:'full'}));assert.ok(memory.entryPoints.some(l=>l.startsWith('Orders ← ')&&l.includes('deeplink app://orders')));
 assert.match(await r.screenContext({screen:'Detail'}),/Como chegar: 2 passos desde a abertura, Home → List → Detail/);
 // The app opens somewhere the graph has never been: goto stops and says so; only then is the agent's judgement needed.
 world.entry='maintenance';const stuck=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(stuck.status,'stuck');
 assert.equal(stuck.diagnosis.cause,'unknown_state');assert.equal(stuck.diagnosis.destination,'Detail');assert.match(stuck.hint,/navloom_ask kind=decision/);
 const brief=await briefMove(stuck,r.store);assert.equal(brief.diagnosis.cause,'unknown_state');await r.finish(stuck.runId);await r.close();});

test('an error on the way stops the walk at once and is handed to the agent, instead of being walked around',async t=>{const world={},r=await setup(t,world);await learn(r);world.listDown=true;
 const moved=await r.goto({mode:'record',target:'app',screen:'Detail'});assert.equal(moved.status,'stuck');assert.equal(moved.steps,1,'one tap, then it stops');assert.equal(moved.recoveries,0);
 assert.equal(moved.diagnosis.cause,'app_error');assert.equal(moved.diagnosis.appSays,'Não foi possível carregar os produtos');assert.match(moved.diagnosis.unexpected,/"list" em Home devia levar a List/);
 assert.equal((await r.finish(moved.runId)).metrics.agentCalls,0);world.listDown=false;assert.equal((await r.goto({mode:'record',target:'app',screen:'Detail'})).status,'arrived','once the app answers again, the walk is the same');await r.close();});
