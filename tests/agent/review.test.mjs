import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {operations,TIERS} from '../../agent/operations.mjs';
import {CallLog} from '../../agent/network.mjs';
import {briefRun} from '../../agent/brief.mjs';

const config={version:2,kind:'navloom-agent-project',id:'rev',name:'Review app',targets:{app:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:[],pluginCapabilities:['read_graph'],pluginImages:[]}};
const CONTROLS={home:['list','about'],list:['item'],detail:['buy'],about:['ok'],soldout:['ok'],receipt:['done']};
const elementId=name=>Buffer.from(name.padEnd(8,'_')).toString('hex').slice(0,16);
/** `world` is how a test changes the application between missions: what an action calls, where it leads, what a screen shows. */
class App{
 constructor(world){this.world=world;this.screen='home';this.calls=new CallLog();}
 async capabilities(){return {available:['capture','interact','hierarchy','logs'],missing:[]};}async start(){this.screen='home';}async restart(){this.screen='home';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){const names=[...CONTROLS[this.screen],...(this.screen==='list'&&this.world.banner?['banner']:[])];return {route:'/',screenKey:this.screen,title:this.screen,heading:this.screen,text:this.screen,xml:'<hierarchy/>',elements:names.map((name,i)=>({id:elementId(name),identity:name,name,actions:['click'],visible:true,bounds:{x:.1,y:.1+i*.1,width:.3,height:.08}})),viewport:{width:400,height:800},scroll:{y:0}};}
 call(method,path,status=200){this.calls.end(this.calls.begin({method,url:'http://api.test'+path}),status);}
 async act(a,element){if(a.type==='back'){this.screen='home';return;}if(a.type!=='click')return;const name=element.identity;
  if(name==='list'){this.call('GET','/api/products',this.world.productsStatus??200);if(this.world.recommendations)this.call('GET','/api/recommendations');this.screen='list';}
  if(name==='item'){if(!this.world.noStock)this.call('GET','/api/stock');this.screen=this.world.soldOut?'soldout':'detail';}
  if(name==='about')this.screen='about';if(name==='ok'||name==='done')this.screen='home';if(name==='buy'){this.call('POST','/api/orders',201);this.screen='receipt';}}
 async network(){return this.calls.drain();}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t,world={},review='required'){const root=await mkdtemp(join(tmpdir(),'navloom-rev-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new App(world)}).init();await r.configure({...config,review});return r;}
const click=(r,run,name)=>r.step(run.id,{type:'click',elementId:elementId(name)});
const names=graph=>graph.screens.map(s=>s.name).sort();
/** Record home → list → detail and approve it: the recorded map every other test starts from. */
async function recorded(r){const run=await r.start({target:'app',mode:'record',objective:'Mapear compra'});await click(r,run,'list');await click(r,run,'item');await r.finish(run.id);await r.decideReview({runId:run.id,decision:'approve'});return run;}

test('record: the map only changes when a person approves, and a discarded mission leaves nothing',async t=>{const r=await setup(t);
 const run=await r.start({target:'app',mode:'record',objective:'Mapear compra'});await click(r,run,'list');assert.deepEqual(names(await r.store.graph()),['Home','List'],'the mission sees its own draft');assert.deepEqual(names(await r.store.recorded()),[],'the recorded map is untouched while it runs');
 await click(r,run,'item');const done=await r.finish(run.id);assert.equal(done.review.status,'pending');assert.equal(done.changes.counts.new,5,'three screens and two connections');assert.equal(done.changes.counts.different,0);
 assert.deepEqual(names(await r.store.graph()),[],'after the mission, reading the graph is reading the recorded map');assert.match(briefRun(done,await r.store.graph()).reviewNote,/approve/);
 const view=await r.review({runId:run.id});assert.deepEqual(names(view.graph),['Detail','Home','List']);
 const approved=await r.decideReview({runId:run.id,decision:'approve'});assert.equal(approved.review.status,'approved');assert.deepEqual(names(await r.store.recorded()),['Detail','Home','List']);assert.equal((await r.store.recorded()).transitions.length,2);
 await assert.rejects(r.decideReview({runId:run.id,decision:'approve'}),/nothing waiting/);assert.deepEqual((await readdir(join(r.store.dir,'drafts'))),[]);
 const extra=await r.start({target:'app',mode:'record',objective:'Sobre'});await click(r,extra,'about');const stopped=await r.pause(extra.id);assert.equal(stopped.review.status,'pending');
 assert.equal((await r.decideReview({runId:extra.id,decision:'discard'})).review.status,'discarded');assert.deepEqual(names(await r.store.recorded()),['Detail','Home','List']);await r.close();});

test('validate: a walk that matches the recording needs no decision and says where it went',async t=>{const r=await setup(t);await recorded(r);
 const run=await r.start({target:'app',mode:'validate',objective:'Validar compra'});await click(r,run,'list');const done=await r.finish(run.id);
 assert.equal(done.review.status,'unchanged');assert.equal(done.changes.items.length,0);const graph=await r.store.recorded(),screen=id=>graph.screens.find(s=>s.id===id).name;
 assert.deepEqual(done.changes.walked.screens.map(screen).sort(),['Home','List']);assert.equal(done.changes.walked.transitions.length,1,'the step to the product was not walked');await r.close();});

test('validate: API calls that appeared, disappeared or answered differently are differences',async t=>{const world={},r=await setup(t,world);await recorded(r);
 world.recommendations=true;world.productsStatus=500;world.noStock=true;
 const run=await r.start({target:'app',mode:'validate',objective:'Validar APIs'});await click(r,run,'list');await click(r,run,'item');const done=await r.finish(run.id);
 assert.equal(done.review.status,'pending');const [list,item]=done.changes.items;assert.equal(done.changes.items.length,2);assert.equal(list.kind,'api');assert.equal(list.type,'different');
 assert.deepEqual(list.added,['GET /api/recommendations']);assert.match(list.status[0],/GET \/api\/products respondeu 500 \(gravado: 200\)/);assert.deepEqual(item.missing,['GET /api/stock']);
 const before=await r.store.recorded();assert.deepEqual(before.transitions.find(e=>e.id===item.transitionId).apis.map(a=>a.path),['/api/stock'],'still as recorded');
 // Approving makes what happened now the recording: the new call is expected, the missing one no longer is.
 await r.decideReview({runId:run.id,decision:'approve'});const after=await r.store.recorded();
 assert.deepEqual(after.transitions.find(e=>e.id===list.transitionId).apis.map(a=>a.path).sort(),['/api/products','/api/recommendations']);assert.deepEqual(after.transitions.find(e=>e.id===item.transitionId).apis,[]);
 const again=await r.start({target:'app',mode:'validate',objective:'De novo'});await click(r,again,'list');await click(r,again,'item');assert.equal((await r.finish(again.id)).review.status,'unchanged');await r.close();});

test('validate: another destination, a changed screen and a new screen are told apart',async t=>{const world={},r=await setup(t,world);await recorded(r);world.banner=true;world.soldOut=true;
 const run=await r.start({target:'app',mode:'validate',objective:'Validar telas'});await click(r,run,'list');await click(r,run,'item');const done=await r.finish(run.id);
 const by=kind=>done.changes.items.filter(i=>i.kind===kind);
 assert.equal(by('state')[0].type,'different','the list showed something that was not recorded');assert.match(by('state')[0].text,/List apareceu num estado que não estava gravado/);
 assert.equal(by('screen')[0].type,'new');assert.match(by('screen')[0].text,/Soldout/);
 // The banner made the list a state of its own, so the tap on the item starts from somewhere the recording never was: a new connection, not a contradiction.
 assert.equal(by('transition').length,2);assert.equal(done.changes.counts.different,1);await r.close();});

test('validate: the same action from the same state landing elsewhere is a different destination',async t=>{const world={},r=await setup(t,world);await recorded(r);world.soldOut=true;
 const run=await r.start({target:'app',mode:'validate',objective:'Validar destino'});await click(r,run,'list');await click(r,run,'item');const done=await r.finish(run.id);
 const item=done.changes.items.find(i=>i.kind==='destination');assert.equal(item.type,'different');assert.match(item.text,/“item” em List levou a Soldout; o gravado leva a Detail/);
 const graph=await r.store.recorded();assert.equal(graph.screens.find(s=>s.id===item.expectedScreen).name,'Detail');await r.close();});

test('walk: nothing is recorded or compared, whatever the app shows',async t=>{const world={},r=await setup(t,world);await recorded(r);const before=JSON.stringify((await r.store.recorded()).screens);
 world.soldOut=true;const run=await r.start({target:'app',mode:'walk',objective:'Só andar'});await click(r,run,'about');await click(r,run,'ok');await click(r,run,'list');await click(r,run,'item');
 const done=await r.finish(run.id);assert.equal(done.review.status,'walk');assert.equal(done.changes,undefined);assert.equal(JSON.stringify((await r.store.recorded()).screens),before);
 // goto opens a walk of its own unless told otherwise.
 world.soldOut=false;const moved=await r.goto({target:'app',screen:'Detail'});assert.equal(moved.status,'arrived');const walk=await r.finish(moved.runId);assert.equal(walk.mode,'walk');assert.equal(walk.review.status,'walk');
 const graph=await r.store.recorded();assert.equal(graph.routes[graph.screens.find(s=>s.name==='Detail').id].arrived,1,'how dependable the direct route is survives the walk');await r.close();});

test('review auto records as it goes and still reports what differed; old mode names keep working',async t=>{const world={},r=await setup(t,world,'auto');
 const run=await r.start({target:'app',mode:'exploratory',objective:'Mapear'});assert.equal(run.mode,'record');await click(r,run,'list');assert.deepEqual(names(await r.store.recorded()),['Home','List']);const done=await r.finish(run.id);assert.equal(done.review.status,'auto');assert.equal(done.changes.counts.new,3);
 world.productsStatus=503;const check=await r.start({target:'app',mode:'focused',objective:'Validar'});assert.equal(check.mode,'validate');await click(r,check,'list');const result=await r.finish(check.id);assert.equal(result.changes.counts.different,1);await r.close();});

test('edits made to the recorded map while a mission waits are kept when it is approved',async t=>{const r=await setup(t);await recorded(r);
 const run=await r.start({target:'app',mode:'record',objective:'Sobre'});await click(r,run,'about');await r.finish(run.id);
 await r.organize({screens:[{id:'List',name:'Catálogo',description:'Lista de produtos.'}]});await r.decideReview({runId:run.id,decision:'approve'});
 assert.deepEqual(names(await r.store.recorded()),['About','Catálogo','Detail','Home']);await r.close();});

test('only a person approves: the decision is not an MCP tool, and a blocked mission is settled when status is read',async t=>{const r=await setup(t);const ops=operations(r,{list:()=>[]});
 assert.equal(ops.review_decide.ui,true);assert.ok(!TIERS.core.includes('review_decide')&&!TIERS.extended.includes('review_decide'));assert.ok(TIERS.extended.includes('review'));
 class Broken extends App{async act(){throw Error('Target disappeared');}}r.factory=()=>Object.assign(new Broken({}),{harness:r.harness});
 const run=await r.start({target:'app',mode:'record',objective:'Quebra'});assert.equal((await click(r,run,'list')).status,'blocked');assert.equal((await r.store.run(run.id)).review.status,'open');
 const status=await r.status({detail:'full'});assert.equal(status.runs.find(x=>x.id===run.id).review.status,'pending','the entry screen it saw still waits for a decision');await r.close();});
