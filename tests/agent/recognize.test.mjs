import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Runtime} from '../../agent/runtime.mjs';
import {operations} from '../../agent/operations.mjs';
import {briefObservation} from '../../agent/brief.mjs';
import {locate,selectedTab,tokensOf,semanticMarkers} from '../../agent/recognize.mjs';
import {parseHierarchy,parseNavigation,windowOwner} from '../../agent/executors/android.mjs';

/**
 * A Compose-like Android shop that declares no screen ids: no `navloom:screen` tag, no fragment, no resource ids.
 * Rows are clickable containers labelled by their children and known only by their position, like a real hierarchy dump.
 */
const PRODUCTS=[{name:'Fone Pulse',price:'R$ 299,90',about:'Cancelamento de ruído e 30 horas de bateria.'},{name:'Bolsa Everyday',price:'R$ 189,00',about:'Couro sintético, alça regulável.'},{name:'Garrafa Térmica',price:'R$ 79,90',about:'Mantém a temperatura por 12 horas.'}];
const TABS=['Início','Produtos','Favoritos'];
function screen(world){
 const s=world.screen,items=[];let index=0;
 const node=(e)=>{const role=e.role??'android.view.View',name=e.text||e.role||role,identity=[`${role}:${index++}`,role,e.fill?'field':name].join('|');items.push({id:createHash('sha256').update(identity).digest('hex').slice(0,24),identity,name,role,resourceId:'',contentDescription:'',text:e.text??'',disabled:false,sensitive:!!e.secret,actions:e.fill?['fill']:e.click?['click']:[],bounds:{x:e.x??.1,y:e.y,width:e.w??.8,height:e.h??.05},visible:true,label:e.label??e.text??role.split('.').pop(),...(e.selected?{selected:true}:{})});};
 const button=(label,y,extra={})=>{node({click:true,y,label,...extra});node({role:'android.widget.TextView',text:label,y:y+.01,h:.03,x:(extra.x??.1)+.05,w:.3});};
 const text=(t,y,h=.03)=>node({role:'android.widget.TextView',text:t,y,h});
 const header=t=>{text('LOJA LAB',.04,.025);text(t,.08,.035);button('Sair',.06,{x:.85,w:.12});};
 const tabs=active=>TABS.forEach((tab,i)=>{node({click:tab!==active,y:.9,h:.09,w:.3,x:i*.33,label:tab});node({role:'android.widget.TextView',text:tab,y:.94,h:.02,w:.15,x:i*.33+.08});});
 const product=PRODUCTS[world.product??0];
 if(s==='login'){text('Bem-vindo',.1,.04);text('Sua loja de teste.',.16);node({fill:true,role:'android.widget.EditText',text:world.email??'',label:'E-mail',y:.3});node({fill:true,secret:true,role:'android.widget.EditText',text:'',label:'Senha',y:.38});button('Entrar',.48);if(world.loginError)text('Não foi possível continuar',.56);}
 if(s==='home'){header(`Olá, ${world.user??'Ana'}`);text('Saldo disponível',.2);text(world.balance??'R$ 1.500,00',.24,.04);button('Ver produtos',.32);button(`Carrinho (${world.cart??0})`,.4);tabs('Início');}
 if(s==='products'||s==='favorites'){header(s==='products'?'Produtos':'Favoritos');const list=s==='products'?PRODUCTS.slice(world.offset??0):PRODUCTS.slice(1,3);list.forEach((p,i)=>{node({click:true,y:.2+i*.18,h:.16,label:`${p.name} · ${p.price}`});text(p.name,.21+i*.18);text(p.price,.25+i*.18);button('Ver detalhes',.3+i*.18,{w:.4});});tabs(s==='products'?'Produtos':'Favoritos');}
 if(s==='product'){header('Detalhes do produto');text(product.name,.2,.04);text(product.price,.26);text(product.about,.31);button('Adicionar ao carrinho',.5);button('‹ Voltar',.58);}
 if(s==='dialog'){return {platform:'android',route:'dev.shop/.MainActivity',activity:'dev.shop/.MainActivity',overlay:true,header:'',heading:'Remover item?',text:'Remover item?',elements:[{id:'d1'.padEnd(24,'0'),identity:'android.view.View:0|android.view.View|android.view.View',name:'android.view.View',role:'android.view.View',text:'',actions:[],bounds:{x:.1,y:.4,width:.8,height:.2},visible:true,label:'Remover item?'},{id:'d2'.padEnd(24,'0'),identity:'android.view.View:1|android.view.View|android.view.View',name:'android.view.View',role:'android.view.View',text:'',actions:['click'],bounds:{x:.6,y:.52,width:.3,height:.05},visible:true,label:'Remover'}],viewport:{width:1080,height:2400},scroll:{position:'unknown'},hierarchy:'available',xml:''};}
 if(s==='blank')return {platform:'android',route:'dev.shop',activity:null,header:'',heading:'',text:'',elements:[],viewport:{width:1080,height:2400},scroll:{position:'unknown'},hierarchy:'available',xml:''};
 const head=items.filter(e=>e.text&&e.bounds.y<.14).sort((a,b)=>b.bounds.height-a.bounds.height)[0]?.text??'';
 return {platform:'android',route:'dev.shop/.MainActivity',activity:'dev.shop/.MainActivity',header:head,heading:head||items.find(e=>e.text)?.text||'',keyboard:!!world.keyboard,text:items.map(e=>e.text).filter(Boolean).join('\n'),elements:items,viewport:{width:1080,height:2400},scroll:{position:'unknown'},hierarchy:'available',xml:'<hierarchy/>'};
}
class Shop{
 constructor(world){this.world=world;}
 async capabilities(){return {available:['capture','interact','hierarchy','logs','back','scroll'],missing:[]};}
 async start(){this.world.screen=this.world.entry??'home';}async restart(){this.world.screen=this.world.entry??'home';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){return screen(this.world);}
 async act(action,element){const w=this.world,label=element?.label??'';
  if(action.type==='back'){w.screen={product:w.from??'products',products:'home',favorites:'home',dialog:'home'}[w.screen]??w.screen;w.keyboard=false;return;}
  if(action.type==='fill'){w.keyboard=true;w.loginError=false;if(label==='E-mail')w.email=action.value;return;}
  if(action.type==='scroll'){w.offset=1;return;}
  if(action.type!=='click')return;
  if(label==='Ver produtos'||label==='Produtos'){w.screen='products';w.offset=0;}else if(label==='Favoritos')w.screen='favorites';else if(label==='Início')w.screen='home';
  else if(label==='Ver detalhes'||PRODUCTS.some(p=>label.startsWith(p.name))){w.from=w.screen;w.screen='product';}
  else if(label==='Entrar'){w.keyboard=false;if(w.email==='ana@shop.test')w.screen='home';else w.loginError=true;}
  else if(label.startsWith('Carrinho'))w.screen='dialog';else if(label==='Remover')w.screen='home';}
 async network(){return {calls:[],late:[]};}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
const config={version:2,kind:'navloom-agent-project',id:'shop',name:'Shop',review:'auto',targets:{shop:{platform:'android',serial:'emulator-5554',package:'dev.shop',adb:'adb'}},permissions:{actions:['open','click','fill','scroll','back','wait'],deeplinkPrefixes:[],pluginCapabilities:['read_graph'],pluginImages:[]}};
async function setup(t,world,{review='auto'}={}){const root=await mkdtemp(join(tmpdir(),'navloom-recognize-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new Shop(world)}).init();await r.configure({...config,review});return r;}
/** Click the visible control with this label (the agent's choice), as an element id of the current capture. */
async function tap(r,runId,label){const run=await r.store.run(runId),o=run.observations.at(-1),e=o.elements.find(x=>x.actions.includes('click')&&x.label===label);assert.ok(e,`no "${label}" on ${o.heading}`);return r.step(runId,{type:'click',elementId:e.id});}
const screensNamed=(graph,name)=>graph.screens.filter(s=>s.name===name);
function pieces(graph){const of=id=>graph.states.find(s=>s.id===id)?.screenId,adj=new Map(graph.screens.map(s=>[s.id,new Set()]));for(const t of graph.transitions){const a=of(t.from),b=of(t.to);if(a&&b){adj.get(a).add(b);adj.get(b).add(a);}}const seen=new Set();let n=0;for(const s of graph.screens){if(seen.has(s.id))continue;n++;const q=[s.id];while(q.length){const x=q.pop();if(!seen.has(x)){seen.add(x);q.push(...adj.get(x));}}}return n;}

test('the same screen showing other content is one screen, and two lists that look alike stay two',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'shop',mode:'record',objective:'Mapear a loja'});
 await tap(r,run.id,'Ver produtos');await tap(r,run.id,'Fone Pulse · R$ 299,90');await r.step(run.id,{type:'back'});
 world.product=1;await tap(r,run.id,'Bolsa Everyday · R$ 189,00');const second=(await r.store.run(run.id)).observations.at(-1);await r.step(run.id,{type:'back'});
 await tap(r,run.id,'Favoritos');world.product=2;await tap(r,run.id,'Garrafa Térmica · R$ 79,90');await r.step(run.id,{type:'back'});
 world.user='Bruno';world.balance='R$ 20,00';await tap(r,run.id,'Início');await r.finish(run.id);
 const graph=await r.store.graph();
 assert.equal(screensNamed(graph,'Detalhes do produto').length,1,'three products, one detail screen');
 assert.equal(second.recognition.how,'similar');assert.ok(second.recognition.score>=.6);
 assert.equal(graph.states.filter(s=>s.screenId===screensNamed(graph,'Detalhes do produto')[0].id).length,1,'and one state of it');
 assert.equal(screensNamed(graph,'Produtos').length,1);assert.equal(screensNamed(graph,'Favoritos').length,1,'the favourites list shows the same products, but its own tab is selected');
 assert.equal(graph.screens.filter(s=>/^Olá/.test(s.name)).length,1,'another account and balance is the same home');
 assert.equal(graph.screens.length,4);assert.equal(pieces(graph),1,'the map is one connected piece');await r.close();});

test('typing, the keyboard, an error, a blank frame and a dialog all stay on their screen',async t=>{const world={entry:'login'},r=await setup(t,world);
 const run=await r.start({target:'shop',mode:'record',objective:'Entrar'});const field=run.observations[0].elements.find(e=>e.label==='E-mail');
 await r.step(run.id,{type:'fill',elementId:field.id,value:'errado@shop.test'});await tap(r,run.id,'Entrar');
 const again=(await r.store.run(run.id)).observations.at(-1).elements.find(e=>e.label==='E-mail');await r.step(run.id,{type:'fill',elementId:again.id,value:'ana@shop.test'});
 // A frame with nothing drawn yet, then the form again.
 world.screen='blank';await r.observe(run.id);world.screen='login';await r.observe(run.id);await tap(r,run.id,'Entrar');
 await tap(r,run.id,'Carrinho (0)');await tap(r,run.id,'Remover');await r.finish(run.id);
 const graph=await r.store.graph(),login=screensNamed(graph,'Bem-vindo');assert.equal(login.length,1,'one login screen');
 const states=graph.states.filter(s=>s.screenId===login[0].id).map(s=>s.name).sort();assert.deepEqual(states,['carregando','erro','padrão','padrão · teclado'],'ready, typing, error and the blank frame are states of the login');
 const home=graph.screens.filter(s=>/^Olá/.test(s.name));assert.equal(home.length,1);assert.ok(graph.states.some(s=>s.screenId===home[0].id&&s.name==='diálogo'),'the dialog is a state of the home it covers');
 assert.equal(graph.screens.length,2);await r.close();});

test('the agent is told how sure the recognition is, the way it came and what a new screen looks like',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'shop',mode:'record',objective:'Ver'});await tap(r,run.id,'Ver produtos');const step=await tap(r,run.id,'Fone Pulse · R$ 299,90');
 const graph=await r.store.graph(),brief=briefObservation(step.observation,graph);assert.equal(brief.trail,'Olá, Ana → Produtos → Detalhes do produto');assert.equal(brief.screen.new,true);
 // A redesign of the detail page: same title and data, other controls. Navloom cannot be sure; the agent decides.
 await r.step(run.id,{type:'back'});world.product=1;world.screen='product';const o=await r.observe(run.id);const fresh=briefObservation(o,await r.store.graph());assert.ok(!fresh.screen.new,'the second product is the known detail screen');
 const ops=operations(r,{list:()=>[]}),similar=await ops.similar.call({min:.3});assert.ok(Array.isArray(similar.pairs));await r.close();});

test('merge folds a screen recorded twice: states, transitions, flows, entries and later captures all follow',async t=>{const world={},r=await setup(t,world,{review:'required'});
 const first=await r.start({target:'shop',mode:'record',objective:'Mapear'});await tap(r,first.id,'Ver produtos');await tap(r,first.id,'Fone Pulse · R$ 299,90');await r.finish(first.id);await r.decideReview({runId:first.id,decision:'approve'});
 // An app update renames everything on the detail page: Navloom records it as a new screen that looks like the old one.
 const redesign=PRODUCTS.map(p=>({...p,about:'Novo layout'}));PRODUCTS.splice(0,3,...redesign);
 const graph0=await r.store.graph(),old=screensNamed(graph0,'Detalhes do produto')[0];
 const forced=JSON.parse(JSON.stringify(graph0));const copy={...old,id:'d'.repeat(24),name:'Detalhes (novo)',profile:old.profile};forced.screens.push(copy);const st=forced.states.find(s=>s.screenId===old.id);forced.states.push({...st,id:'e'.repeat(24),screenId:copy.id});
 forced.transitions.push({...forced.transitions.find(e=>e.to===st.id),id:'t2',to:'e'.repeat(24)});forced.flows=[{id:'buy',name:'Compra',description:'',screenIds:[copy.id],runIds:[]}];forced.entries={shop:'e'.repeat(24)};await r.store.saveRecorded(forced);
 const run=await r.start({target:'shop',mode:'record',objective:'Unificar'});const ops=operations(r,{list:()=>[]});
 const merged=await ops.merge.call({into:old.id.slice(0,8),from:['dddddddd']});assert.deepEqual(merged.merged,['Detalhes (novo)']);assert.equal(merged.pending,true,'inside a record mission it waits for approval');
 const done=await r.finish(run.id);assert.equal(done.review.status,'pending');assert.ok(done.changes.items.some(i=>i.kind==='merge'&&/Telas unificadas: Detalhes \(novo\)/.test(i.text)));
 assert.ok((await r.store.recorded()).screens.some(s=>s.id===copy.id),'the recorded map is unchanged until a person approves');
 await r.decideReview({runId:run.id,decision:'approve'});const graph=await r.store.recorded();
 assert.equal(graph.screens.filter(s=>s.id===copy.id).length,0);assert.equal(graph.states.filter(s=>s.screenId===old.id).length,1,'the copied state was folded into the old one');assert.equal(graph.aliases[copy.id],old.id);
 assert.deepEqual(graph.flows[0].screenIds,[old.id]);assert.equal(graph.states.find(s=>s.id===graph.entries.shop)?.screenId,old.id);
 assert.equal(new Set(graph.transitions.map(e=>e.signature)).size,graph.transitions.length,'transitions that became the same are one');await r.close();});

test('a map recorded before profiles existed is still recognised: profiles come from its evidence',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'shop',mode:'record',objective:'Mapear'});await tap(r,run.id,'Ver produtos');await r.finish(run.id);
 const legacy=await r.store.graph();for(const s of legacy.screens)delete s.profile;await r.store.saveRecorded(legacy);
 world.user='Bruno';const again=await r.start({target:'shop',mode:'record',objective:'De novo'});assert.equal(again.observations[0].recognition.how,'similar');await tap(r,again.id,'Ver produtos');await r.finish(again.id);
 const graph=await r.store.graph();assert.equal(graph.screens.length,2,'no screen was recorded twice');assert.ok(graph.screens.every(s=>s.profile?.n>=1));await r.close();});

test('the screen script written from the map is checked on real captures and names the known screens',async t=>{const world={},r=await setup(t,world);
 const run=await r.start({target:'shop',mode:'record',objective:'Mapear'});await tap(r,run.id,'Ver produtos');await tap(r,run.id,'Fone Pulse · R$ 299,90');await r.step(run.id,{type:'back'});await tap(r,run.id,'Favoritos');await r.finish(run.id);
 const ops=operations(r,{list:()=>[]}),suggestion=await ops.harness.call({suggest:'screen'});assert.ok(suggestion.script,'a script was written');assert.equal(suggestion.covered.length,4);assert.ok(suggestion.script.code.length<8000);
 const proposed=await ops.harness_propose.call(suggestion.script,'mcp');assert.equal(proposed.status,'proposed');const reviewed=await r.harness.review(proposed.id,'approve');assert.equal(reviewed.status,'active','every sample matched');
 const before=(await r.store.graph()).screens.map(s=>s.id).sort();world.product=2;
 const next=await r.start({target:'shop',mode:'record',objective:'Com script'});await tap(r,next.id,'Ver produtos');const detail=await tap(r,next.id,'Garrafa Térmica · R$ 79,90');await r.finish(next.id);
 assert.equal(detail.observation.recognition.how,'script');assert.deepEqual((await r.store.graph()).screens.map(s=>s.id).sort(),before,'the script names the screens already on the map');await r.close();});

test('locate finds a control that moved or whose counter changed, and refuses to guess between two',()=>{
 const els=[{id:'a',identity:'android.view.View:7|android.view.View|android.view.View',role:'android.view.View',name:'android.view.View',label:'Carrinho (2)',actions:['click'],visible:true},{id:'b',identity:'cart_btn|android.widget.Button|Carrinho',role:'android.widget.Button',name:'Carrinho',resourceId:'cart_btn',actions:['click'],visible:true},{id:'c',identity:'android.view.View:9|android.view.View|android.view.View',role:'android.view.View',name:'android.view.View',label:'Ver detalhes',actions:['click'],visible:true},{id:'d',identity:'android.view.View:11|android.view.View|android.view.View',role:'android.view.View',name:'android.view.View',label:'Ver detalhes',actions:['click'],visible:true}];
 assert.equal(locate(els,'android.view.View:3|android.view.View|android.view.View','Carrinho (0)').id,'a','same label once the counter is taken out, at another position');
 assert.equal(locate(els,'cart_btn|android.widget.Button|Carrinho (9)','x').id,'b','same resource id and role');
 assert.equal(locate(els,'android.view.View:2|android.view.View|android.view.View','Ver detalhes'),null,'two rows read the same: no guess');});

test('Android: what the system says about navigation, field identity without its value, and the selected tab',()=>{
 const nav=parseNavigation('  mResumedActivity: ActivityRecord{e2 u0 dev.app/.DetailActivity t3}\n    * Hist  #1: ActivityRecord{a u0 dev.app/.DetailActivity t3}\n    * Hist  #0: ActivityRecord{b u0 dev.app/.MainActivity t3}','  mCurrentFocus=Window{f u0 dev.app/dev.app.DetailActivity}','dev.app');
 assert.deepEqual(nav,{activity:'dev.app/.DetailActivity',stack:['DetailActivity','MainActivity'],window:'dev.app/dev.app.DetailActivity',overlay:false});
 assert.equal(parseNavigation('','  mCurrentFocus=Window{f u0 PopupWindow:1a}','dev.app').overlay,true,'a popup menu is drawn over the screen');
 assert.equal(parseNavigation('topResumedActivity=null','','dev.app').activity,null,'unknown while nothing is resumed');
 const xml=v=>`<hierarchy><node text="${v}" resource-id="" class="android.widget.EditText" content-desc="" clickable="true" enabled="true" password="false" scrollable="false" bounds="[0,0][100,50]" hint="E-mail"/></hierarchy>`;
 assert.equal(parseHierarchy(xml(''),{width:100,height:100})[0].identity,parseHierarchy(xml('ana@x.dev'),{width:100,height:100})[0].identity,'typing does not change which field it is');
 const home=screen({screen:'home'});assert.equal(selectedTab(home),'início');assert.ok(tokensOf(home).has('n:início'));
 assert.deepEqual(semanticMarkers(screen({screen:'login',loginError:true})),['error']);assert.deepEqual(semanticMarkers(screen({screen:'home'})),[],'a section note is not the state of the screen');});

test('Android: a window of another app is never taken for a screen; a system sheet over the app is an overlay',()=>{
 const dump=pkg=>`<hierarchy><node package="${pkg}" class="android.widget.FrameLayout" bounds="[0,0][100,100]"/></hierarchy>`;
 assert.deepEqual(windowOwner(dump('dev.app'),'dev.app'),{own:true});
 assert.deepEqual(windowOwner(dump('dev.other.tool'),'dev.app'),{own:false,other:'dev.other.tool'},'seen on the emulator: another app came to the front while ours was still the resumed activity');
 assert.deepEqual(windowOwner(dump('com.google.android.gms'),'dev.app'),{own:false,system:'com.google.android.gms'},'autofill drawn over the app');});
