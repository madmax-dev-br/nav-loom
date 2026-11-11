import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import ts from 'typescript';
import {Runtime} from '../../agent/runtime.mjs';
import {planRoute} from '../../agent/graph.mjs';
import {CallLog,normalizePath,parseHttpLog,mergeApis,recordingProxy} from '../../agent/network.mjs';
import {parseDeeplinks,parseHierarchy} from '../../agent/executors/android.mjs';
import {briefStep,briefMemory,briefStart} from '../../agent/brief.mjs';
const config={version:2,kind:'navloom-agent-project',id:'test',name:'Test app',targets:{web:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:[],pluginCapabilities:['read_graph'],pluginImages:[]}};

class Shop{
 constructor(){this.state='home';this.calls=new CallLog();}
 async capabilities(){return {available:['capture','interact','hierarchy','logs'],missing:[]};}async start(){this.state='home';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){return {route:'/',screenKey:this.state,stateKey:'ready',title:this.state,heading:this.state,text:`Welcome\n${this.state}`,xml:'<hierarchy/>'.repeat(500),elements:[{id:'0123456789abcdef',identity:'next',name:'Next',actions:['click'],visible:true,bounds:{x:.1,y:.1,width:.2,height:.1}}],viewport:{width:400,height:800},scroll:{y:0}};}
 async act(a){if(a.type==='click'){this.calls.end(this.calls.begin({method:'POST',url:'http://api.test/api/orders/123?token=secret'}),201);this.state=this.state==='home'?'cart':'receipt';}if(a.type==='deeplink')this.state='cart';if(a.type==='back')this.state='home';}
 async network(){return this.calls.drain();}async deeplinks(){return [{pattern:'shop://app',match:'prefix',activity:'a/.Main'}];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t){const root=await mkdtemp(join(tmpdir(),'navloom-eff-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new Shop()}).init();await r.configure({...config,permissions:{...config.permissions,deeplinkPrefixes:[]}});return r;}

test('steps record API calls without secrets and agents receive a compact result',async t=>{const r=await setup(t);const run=await r.start({target:'web',mode:'exploratory',objective:'Buy'});
 const result=await r.step(run.id,{type:'click',elementId:'01234567'});assert.equal(result.status,'completed');
 assert.deepEqual(result.step.network.map(c=>[c.method,c.host,c.path,c.status]),[['POST','api.test','/api/orders/{id}',201]]);
 const graph=await r.store.graph();assert.deepEqual(graph.transitions[0].apis,[{method:'POST',host:'api.test',path:'/api/orders/{id}',statuses:[201],count:1}]);
 const brief=await briefStep(result,r.store),full=JSON.stringify(result),small=JSON.stringify(brief);
 assert.deepEqual(brief.api,['POST /api/orders/{id} 201']);assert.equal(brief.changed,'screen');assert.equal(brief.elements[0].id,'01234567');assert.ok(!small.includes('hierarchy/'));assert.ok(small.length<full.length/2,`${small.length} vs ${full.length}`);
 // The raw hierarchy stays in the evidence file only.
 assert.equal((await r.store.run(run.id)).observations.at(-1).xml,undefined);assert.ok((await r.store.resource(`evidence/${result.observation.id}.json`)).toString().includes('<hierarchy/>'));
 await r.finish(run.id);});

test('goto reaches a known screen in one call and declared deeplinks are permitted',async t=>{const r=await setup(t);const first=await r.start({target:'web',mode:'exploratory',objective:'Learn'});
 assert.equal((await r.store.graph()).declaredDeeplinks.web[0].pattern,'shop://app');
 await r.step(first.id,{type:'click',elementId:'0123456789abcdef'});await r.step(first.id,{type:'click',elementId:'0123456789abcdef'});
 await assert.rejects(r.step(first.id,{type:'deeplink',url:'other://app/cart'}),/not permitted/);
 const linked=await r.step(first.id,{type:'deeplink',url:'shop://app/cart'});assert.equal(linked.status,'completed');
 assert.equal((await r.store.graph()).screens.find(s=>s.name==='Cart').deeplinks[0].url,'shop://app/cart');
 await r.organize({screens:[{id:'Receipt',name:'Comprovante',description:'Confirma a compra.'}],flows:[{id:'buy',name:'Compra',screenIds:['Home','Cart','Comprovante'],runIds:[first.id]}]});await r.finish(first.id);
 const memory=briefMemory(await r.memory({detail:'full'}));assert.ok(memory.transitions.some(line=>line.includes('Home —Next→ Cart [POST /api/orders/{id}]')),memory.transitions.join('\n'));assert.deepEqual(memory.flows[0].screens,['Home','Cart','Comprovante']);assert.ok(JSON.stringify(memory).length<2500);
 const second=await r.start({target:'web',mode:'focused',objective:'Again'});assert.ok((await briefStart(second,r.store)).deeplinks.includes('shop://app*'));
 const moved=await r.goto({runId:second.id,screen:'Comprovante'});assert.equal(moved.status,'arrived');assert.equal(moved.steps,2);assert.equal(moved.observation.screenKey,'receipt');
 const done=await r.finish(second.id);assert.equal(done.metrics.agentCalls,0);assert.equal(done.metrics.replayedSteps,2);assert.equal((await r.goto({runId:(await r.start({target:'web',mode:'focused',objective:'Here'})).id,screen:'Home'})).status,'already_there');await r.close();});

test('routes avoid undependable transitions: stack-dependent back, ambiguous outcomes, inconsistent deeplinks',()=>{
 const edge=(id,from,to,action,evidence=1)=>({id,from,to,target:'a',profile:'p',preconditions:{},version:{fingerprint:'v'},confirmed:true,cost:1,action,evidence:Array.from({length:evidence},()=>({}))});
 const args={target:'a',profile:'p',preconditions:{},version:{fingerprint:'v'}};
 const back={transitions:[edge('open','list','item',{type:'click',elementIdentity:'row'}),edge('back','item','list',{type:'back'})]};
 assert.equal(planRoute(back,{...args,from:'item',to:'list'}).found,false);assert.deepEqual(planRoute(back,{...args,from:'list',to:'list2'}).steps,[]);
 const undo={transitions:[...back.transitions,edge('more','list','more',{type:'click',elementIdentity:'more'})]};assert.equal(planRoute(undo,{...args,from:'list',to:'more'}).steps.length,1);
 const ambiguous={transitions:[edge('ok','login','home',{type:'click',elementIdentity:'go'},3),edge('odd','login','promo',{type:'click',elementIdentity:'go'},1)]};
 assert.equal(planRoute(ambiguous,{...args,from:'login',to:'home'}).found,true);assert.equal(planRoute(ambiguous,{...args,from:'login',to:'promo'}).found,false);
 const link={transitions:[edge('dl','cart','cards',{type:'deeplink',url:'app://cards'})]};
 assert.equal(planRoute(link,{...args,from:'home',to:'cards'}).found,false);assert.equal(planRoute(link,{...args,from:'home',to:'cards',allowDeeplinks:true}).found,true);
 link.transitions.push(edge('dl2','login','login',{type:'deeplink',url:'app://cards'}));assert.equal(planRoute(link,{...args,from:'home',to:'cards',allowDeeplinks:true}).found,false);
});

test('network helpers: path templates, late results, OkHttp logs and the adb-reverse recording proxy',async t=>{
 assert.equal(normalizePath('/api/users/42/orders/order-0007?x=1'),'/api/users/{id}/orders/{id}');assert.equal(normalizePath('/api/products/tote'),'/api/products/tote');
 const log=new CallLog(),slow=log.begin({method:'GET',url:'https://h.test/slow'});let drained=log.drain();assert.equal(drained.calls[0].status,null);log.end(slow,200);drained=log.drain();assert.equal(drained.calls.length,0);assert.equal(drained.late[0].status,200);
 const both=new CallLog();both.end(both.begin({method:'POST',host:'127.0.0.1:4791',path:'/api/login',source:'proxy'}),401);both.complete({url:'/api/login',status:401,source:'logcat'});assert.equal(both.drain().calls.length,1,'proxy and log line describe one call');
 assert.deepEqual(parseHttpLog('D OkHttp: --> POST https://h.test/api/login'),{phase:'request',method:'POST',url:'https://h.test/api/login'});assert.equal(parseHttpLog('D OkHttp: <-- 401 Unauthorized https://h.test/api/login (35ms, 12-byte body)').status,401);assert.equal(parseHttpLog('I App: hello'),null);
 assert.deepEqual(mergeApis([{method:'GET',host:'h',path:'/a',statuses:[200]}],[{method:'GET',host:'h',path:'/a',status:500},{method:'GET',host:'h',path:'/b',status:null}]),[{method:'GET',host:'h',path:'/a',statuses:[200,500],count:1},{method:'GET',host:'h',path:'/b',statuses:[],count:1}]);
 const backend=createServer((req,res)=>{res.statusCode=req.url==='/api/missing'?404:200;res.end('{"ok":true}');});await new Promise(r=>backend.listen(0,'127.0.0.1',r));const proxied=new CallLog(),proxy=await recordingProxy(`http://127.0.0.1:${backend.address().port}`,proxied);t.after(async()=>{await proxy.close();backend.close();});
 assert.equal(await (await fetch(`http://127.0.0.1:${proxy.port}/api/home?session=abc`)).text(),'{"ok":true}');assert.equal((await fetch(`http://127.0.0.1:${proxy.port}/api/missing`)).status,404);
 assert.deepEqual(proxied.drain().calls.map(c=>`${c.method} ${c.path} ${c.status}`),['GET /api/home 200','GET /api/missing 404']);
});

test('Android: declared deeplinks from the resolver table and readable labels for Compose rows',()=>{
 const dump=`Activity Resolver Table:\n  Schemes:\n      shop:\n        5fb3de1 dev.shop/.MainActivity filter 583d1c7\n          Action: "android.intent.action.VIEW"\n          Category: "android.intent.category.BROWSABLE"\n          Scheme: "shop"\n          Authority: "app": -1\n          Path: "PatternMatcher{PREFIX: /product}"\n      https:\n        aa11 other.app/.Main filter bb22\n          Scheme: "https"\n          Authority: "x.test": -1\n\n  Non-Data Actions:\n      android.intent.action.MAIN:\n        5fb3de1 dev.shop/.MainActivity filter 5da1706\n          Action: "android.intent.action.MAIN"\n`;
 assert.deepEqual(parseDeeplinks(dump,'dev.shop'),[{pattern:'shop://app/product',match:'prefix',activity:'dev.shop/.MainActivity'}]);
 const nodes=parseHierarchy('<hierarchy><node index="0" text="" resource-id="product_tote" class="android.view.View" clickable="true" enabled="true" bounds="[0,0][400,100]"><node index="0" text="Bolsa &#128092;" class="android.widget.TextView" bounds="[10,10][100,50]" /></node><node index="1" text="ana@x.test" resource-id="auth_email" class="android.widget.EditText" enabled="true" bounds="[0,100][400,160]" /></hierarchy>',{width:400,height:800});
 assert.equal(nodes[0].label,'Bolsa 👜');assert.equal(nodes[0].name,'product_tote');assert.equal(nodes[2].label,'auth_email: ana@x.test');assert.equal(nodes[0].box,undefined);
});

test('map layout: columns follow navigation depth and returns are classified',async()=>{
 const source=await readFile(new URL('../../lib/agent-map-layout.ts',import.meta.url),'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});const {layoutColumns,linkDirection}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
 const link=(fromScreen,toScreen)=>({fromScreen,toScreen}),links=[link('login','home'),link('home','products'),link('home','pix'),link('products','product'),link('product','home')];
 const {columns,depth}=layoutColumns(['login','home','products','product','pix','orphan'],links);assert.deepEqual(columns,[['login','orphan'],['home'],['products','pix'],['product']]);
 assert.equal(linkDirection(depth,link('home','pix')),'forward');assert.equal(linkDirection(depth,link('product','home')),'back');assert.equal(linkDirection(depth,link('products','pix')),'lateral');
});

test('harness: learned scripts stay inert until approved, then recognise requests, screens and paths deterministically',async t=>{
 const {Harness}=await import('../../agent/harness.mjs');const {AndroidExecutor}=await import('../../agent/executors/android.mjs');
 const root=await mkdtemp(join(tmpdir(),'navloom-harness-'));t.after(()=>rm(root,{recursive:true,force:true}));
 class Plain extends Shop{async observe(){const o=await super.observe();delete o.screenKey;delete o.stateKey;o.heading=`Olá, visitante ${Math.random()}`;o.text=`Saldo\n${o.heading}`;o.platform='android';return o;}}
 const r=await new Runtime(root,{executorFactory:()=>new Plain()}).init();await r.configure(config);const h=r.harness;
 const logcat={id:'lab-http',kind:'logcat',name:'HTTP do app',description:'Linhas "HTTP <status> <path>" do app.',code:'function run(input){const m=input.line.match(/NavloomLab.*?: HTTP (\\d{3}) (\\/\\S+)/);return m?{url:m[2],status:Number(m[1])}:null;}',samples:[{input:{line:'E/NavloomLab( 123): HTTP 401 /api/auth/login'},expect:{url:'/api/auth/login',status:401}},{input:{line:'I/Other: hello'},expect:null}]};
 const proposed=await h.propose(logcat,'agent');assert.equal(proposed.status,'proposed');assert.equal(h.apply('logcat',{line:'E/NavloomLab( 1): HTTP 500 /api/cart'}),null,'unapproved code never runs');
 assert.equal((await h.review('lab-http','approve')).status,'active');assert.deepEqual(h.apply('logcat',{line:'E/NavloomLab( 1): HTTP 500 /api/cart'}).value,{url:'/api/cart',status:500});
 // The Android executor feeds unrecognised log lines to the learned script.
 const android=new AndroidExecutor({adb:'adb',serial:'emulator-5554',package:'dev.test.app'},{runCommand:async(file,args)=>args.some(a=>a.includes('logcat'))?'1700000001.500  42  42 E NavloomLab: HTTP 503 /api/products\n1700000001.600  42  42 I Other: noise':''});android.harness=h;android.networkCursor=1700000000;
 assert.deepEqual((await android.network()).calls.map(c=>`${c.path} ${c.status}`),['/api/products 503']);
 // A wrong sample keeps a script off; hostile-looking code cannot reach the host through the context.
 await h.propose({...logcat,id:'bad',samples:[{input:{line:'x'},expect:{url:'/never'}}]},'agent');assert.equal((await h.review('bad','approve')).status,'failed');
 await h.propose({id:'escape',kind:'path',name:'escape',code:'function run(){return typeof require+typeof process+typeof globalThis.fetch;}',samples:[{input:{},expect:'/x'}]},'agent');const escaped=await h.review('escape','approve');assert.equal(escaped.status,'failed');assert.match(JSON.stringify(escaped.results),/Invalid|undefinedundefinedundefined/);
 await h.propose({id:'evil',kind:'path',name:'eval',code:'function run(){return new Function("return 1")();}',samples:[{input:{},expect:'/x'}]},'agent');assert.match((await h.review('evil','approve')).results[0].error,/Code generation/);
 // Screen identity and path templates.
 await h.propose({id:'home-screen',kind:'screen',name:'Início',code:'function run(i){return i.texts.includes("Saldo")?{screen:"home",state:"ready",name:"Início"}:null;}',samples:[{input:{texts:['Saldo']},expect:{screen:'home',state:'ready',name:'Início'}}]},'agent');await h.review('home-screen','approve');
 await h.propose({id:'orders',kind:'path',name:'Pedidos',code:'function run(i){return i.path.startsWith("/api/orders/")?"/api/orders/{order}":null;}',samples:[{input:{path:'/api/orders/{id}'},expect:'/api/orders/{order}'}]},'agent');await h.review('orders','approve');
 const run=await r.start({target:'web',mode:'exploratory',objective:'Identity'});const first=run.observations[0];assert.equal(first.screenKey,'home');assert.equal(first.identifiedBy,'home-screen');assert.equal((await r.store.graph()).screens[0].name,'Início');
 const step=await r.step(run.id,{type:'click',elementId:'0123456789abcdef'});assert.equal(step.status,'completed','a changing greeting no longer looks like a different screen');assert.equal(step.observation.screenId,first.screenId);assert.equal(step.step.network[0].path,'/api/orders/{order}');
 const status=await r.status({detail:'full'});assert.ok(status.harness.activity.some(a=>a.event==='match'&&a.scriptId==='home-screen'));assert.ok(status.harness.scripts.find(s=>s.id==='orders').stats.matches>=1);
 // Persisted in the project and reloaded.
 await r.finish(run.id);const again=await new Harness(r.store).load();assert.equal(again.list().find(s=>s.id==='lab-http').status,'active');assert.match(await readFile(join(root,'.navloom/harness/lab-http.js'),'utf8'),/function run/);
});

test('screens are named by the app itself (fragment, header) and described for an agent in a few lines',async t=>{
 const {findHeader,parseFragment}=await import('../../agent/executors/android.mjs');const {screenContext,unmappedActions}=await import('../../lib/screen-context.mjs');
 const text=(value,y,height,extra={})=>({text:value,visible:true,actions:[],bounds:{x:.1,y,width:.4,height},...extra});
 assert.equal(findHeader([text('ACME',.063,.031),text('Meus cartões',.093,.031),text('Sair',.083,.022),text('R$ 1.500,00',.211,.041)]),'Meus cartões','the title sits under the brand line, in the app bar');
 assert.equal(findHeader([text('Checkout',.2,.02,{resourceId:'app:id/toolbar_title'}),text('BIG',.1,.05)]),'Checkout','an id that says title wins over size');assert.equal(findHeader([text('Pedido',.05,.02,{resourceId:'app:id/toolbar_title'}),text('BIG',.06,.05)]),'Pedido');assert.equal(findHeader([text('🎧',.05,.09)]),'');
 assert.equal(parseFragment('  Added Fragments:\n    #0: NavHostFragment{abc} (id=0x1)\n    Child FragmentManager:\n      Added Fragments:\n        #0: com.shop.ProductDetailFragment{def} (uuid id=0x7f)\n      Back Stack Index: 0\n'),'ProductDetailFragment');assert.equal(parseFragment('ACTIVITY com.shop/.Main\n  no fragments here'),null);
 // A fragment gives the screen its identity and a readable name; the header is kept beside it.
 const root=await mkdtemp(join(tmpdir(),'navloom-name-'));t.after(()=>rm(root,{recursive:true,force:true}));
 class Fragments extends Shop{async observe(){const o=await super.observe();delete o.screenKey;delete o.stateKey;o.fragment=this.state==='home'?'HomeFragment':'ProductDetailFragment';o.header=this.state==='home'?'Olá, Ana':'Detalhes';o.heading=o.header;o.elements.push({id:'fedcba9876543210',identity:'fav',name:'Salvar',label:'♡ Salvar',resourceId:'app:id/favorite',actions:['click'],visible:true,bounds:{x:.5,y:.5,width:.2,height:.1}});return o;}}
 const r=await new Runtime(root,{executorFactory:()=>new Fragments()}).init();await r.configure(config);const run=await r.start({target:'web',mode:'exploratory',objective:'Names'});
 const step=await r.step(run.id,{type:'click',elementId:'0123456789abcdef'});assert.equal(step.status,'completed');const graph=await r.store.graph();
 assert.deepEqual(graph.screens.map(s=>[s.name,s.identity,s.fragment]),[['Home','fragment','HomeFragment'],['Product detail','fragment','ProductDetailFragment']]);assert.equal(graph.screens[1].header,'Detalhes');
 assert.deepEqual(unmappedActions(graph,run.observations[0]).map(u=>[u.label,u.tag]),[['♡ Salvar','favorite']]);
 const context=await r.screenContext({screen:'Home'});
 assert.match(context,/^Tela: Home \(id [0-9a-f]{8}\) · web http/);assert.match(context,/Fragment: HomeFragment/);assert.match(context,/- "Next" → Product detail \[POST \/api\/orders\/\{id\} 201\]/);assert.match(context,/Ações não mapeadas \(1\): "♡ Salvar"/);assert.ok(context.length<700,String(context.length));
 assert.equal(screenContext(graph,graph.screens[1],{}).includes('Ações não mapeadas'),false);await r.finish(run.id);
});

test('keyboard-open and scrolled views are states of their own, and a scroll records what it loaded',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-view-'));t.after(()=>rm(root,{recursive:true,force:true}));
 class Feed extends Shop{constructor(){super();this.offset=0;this.keyboard=false;}
  async observe(){const o=await super.observe();o.platform='android';o.keyboard=this.keyboard;o.scroll={position:'unknown'};o.elements=[...o.elements,...[0,1,2].map(i=>({id:`row${this.offset+i}`.padEnd(16,'0'),identity:`row-${this.offset+i}`,name:`Item ${this.offset+i}`,actions:['click'],visible:true,bounds:{x:0,y:.2+i*.2,width:1,height:.2}})),{id:'field00000000000',identity:'field',name:'Busca',actions:['click','fill'],visible:true,bounds:{x:0,y:0,width:1,height:.1}}];return o;}
  async act(a){if(a.type==='scroll'){const next=Math.max(0,Math.min(6,this.offset+(a.direction==='up'?-3:3)));if(next!==this.offset&&a.direction!=='up')this.calls.end(this.calls.begin({method:'GET',url:`http://api.test/api/items?page=${next/3+1}`}),200);this.offset=next;}else if(a.type==='fill')this.keyboard=true;else if(a.type==='back')this.keyboard=false;else await super.act(a);}}
 const r=await new Runtime(root,{executorFactory:()=>new Feed()}).init();await r.configure(config);const run=await r.start({target:'web',mode:'exploratory',objective:'Views'}),top=run.observations[0];
 // Typing opens the keyboard: a separate state, so the clean capture of the base state is kept.
 const typed=await r.step(run.id,{type:'fill',elementId:'field00000000000',value:'bolsa'});assert.notEqual(typed.observation.stateId,top.stateId);let graph=await r.store.graph();
 assert.deepEqual(graph.states.map(s=>[s.name,!!s.keyboard]),[['ready',false],['ready · teclado',true]]);assert.equal((await r.step(run.id,{type:'back'})).observation.stateId,top.stateId);
 // Scrolling: a new state per view, the call it triggered on the transition, the same state when nothing moves, and the base state back at the top.
 const page2=await r.step(run.id,{type:'scroll',direction:'down'}),page3=await r.step(run.id,{type:'scroll',direction:'down'}),end=await r.step(run.id,{type:'scroll',direction:'down'});
 assert.equal(new Set([top.stateId,page2.observation.stateId,page3.observation.stateId]).size,3);assert.equal(end.observation.stateId,page3.observation.stateId,'end of the list');assert.equal(page3.observation.scrollBase,top.stateId);
 graph=await r.store.graph();const scroll=graph.transitions.find(t=>t.kind==='scroll'&&t.from===top.stateId);assert.equal(scroll.to,page2.observation.stateId);assert.deepEqual(scroll.apis.map(a=>`${a.method} ${a.path}`),['GET /api/items']);assert.equal(graph.states.find(s=>s.id===page2.observation.stateId).name,'ready · rolado');
 // Observing or acting while scrolled stays on the scrolled state.
 assert.equal((await r.observe(run.id)).stateId,page3.observation.stateId);await r.step(run.id,{type:'scroll',direction:'up'});assert.equal((await r.step(run.id,{type:'scroll',direction:'up'})).observation.stateId,top.stateId);
 const {mappedActions}=await import('../../lib/screen-context.mjs');assert.ok(mappedActions(await r.store.graph(),top.screenId).some(m=>m.name==='(rolar down)'&&m.target==='estado ready · rolado'&&[...m.apis][0]==='GET /api/items 200'));await r.finish(run.id);
});

test('the proxy keeps the full exchange of a call with secrets masked, and a step points at it',async t=>{
 const {gzipSync}=await import('node:zlib');const {redactValue,readBody}=await import('../../agent/network.mjs');
 const backend=createServer((req,res)=>{let body='';req.on('data',c=>body+=c).on('end',()=>{res.setHeader('content-type','application/json');res.setHeader('set-cookie','sid=abc');if(req.url.startsWith('/zip')){res.setHeader('content-encoding','gzip');return res.end(gzipSync(JSON.stringify({items:[1,2,3]})));}res.end(JSON.stringify({token:'session-0001',name:'Ana',echo:JSON.parse(body||'{}')}));});});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));const log=new CallLog(),proxy=await recordingProxy(`http://127.0.0.1:${backend.address().port}`,log);t.after(async()=>{await proxy.close();backend.close();});
 await (await fetch(`http://127.0.0.1:${proxy.port}/api/auth/login?apiKey=k1&page=2`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer abc'},body:JSON.stringify({email:'ana@x.test',password:'hunter2'})})).json();
 assert.deepEqual(await (await fetch(`http://127.0.0.1:${proxy.port}/zip`)).json(),{items:[1,2,3]},'the device still receives the original bytes');
 const [login,zip]=log.drain().calls;assert.equal(login.detail.url,'/api/auth/login?apiKey=[REDACTED]&page=2');assert.equal(login.detail.requestHeaders.authorization,'[REDACTED]');assert.equal(login.detail.responseHeaders['set-cookie'],'[REDACTED]');
 assert.deepEqual(login.detail.requestBody.json,{email:'ana@x.test',password:'[REDACTED]'});assert.deepEqual(login.detail.responseBody.json,{token:'[REDACTED]',name:'Ana',echo:{email:'ana@x.test',password:'[REDACTED]'}});assert.equal(login.detail.status,200);assert.ok(login.detail.ms>=0);
 assert.deepEqual(zip.detail.responseBody.json,{items:[1,2,3]},'compressed bodies are read');assert.equal(zip.detail.requestBody,null);
 assert.deepEqual(redactValue({a:[{senha:'x',ok:1}],client_secret:'y'}),{a:[{senha:'[REDACTED]',ok:1}],client_secret:'[REDACTED]'});assert.match(readBody({buffer:Buffer.from('x'),size:9,truncated:false},{'content-type':'image/png'}).note,/image\/png/);
 const quiet=new CallLog(),plain=await recordingProxy(`http://127.0.0.1:${backend.address().port}`,quiet,{bodies:false});t.after(()=>plain.close());await fetch(`http://127.0.0.1:${plain.port}/api/x`);assert.equal(quiet.drain().calls[0].detail,undefined);
 // In a mission, the exchange is written to its own evidence file and the step keeps only the path.
 const root=await mkdtemp(join(tmpdir(),'navloom-body-'));t.after(()=>rm(root,{recursive:true,force:true}));
 class Detailed extends Shop{async act(a){if(a.type==='click'){const call=this.calls.begin({method:'POST',url:'http://api.test/api/orders'});call.detail={method:'POST',url:'/api/orders',status:201,responseBody:{json:{orderId:'ord_1'}}};this.calls.end(call,201);this.state='cart';}}}
 const r=await new Runtime(root,{executorFactory:()=>new Detailed()}).init();await r.configure(config);const run=await r.start({target:'web',mode:'exploratory',objective:'Bodies'}),step=await r.step(run.id,{type:'click',elementId:'0123456789abcdef'});
 const pointer=step.step.network[0].detail;assert.match(pointer,/^evidence\/net-[\w-]+\.json$/);const stored=JSON.parse((await r.store.resource(pointer)).toString());assert.equal(stored.responseBody.json.orderId,'ord_1');assert.equal(stored.pathTemplate,'/api/orders');
 assert.ok(!JSON.stringify((await r.store.graph()).transitions).includes('ord_1'),'bodies never enter the graph');await r.finish(run.id);
});
