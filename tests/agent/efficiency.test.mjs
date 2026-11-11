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
 const graph=await r.store.graph();assert.deepEqual(graph.transitions[0].apis,[{method:'POST',host:'api.test',path:'/api/orders/{id}',statuses:[201]}]);
 const brief=await briefStep(result,r.store),full=JSON.stringify(result),small=JSON.stringify(brief);
 assert.deepEqual(brief.api,['POST /api/orders/{id} 201']);assert.equal(brief.changed,'screen');assert.equal(brief.elements[0].id,'01234567');assert.ok(!small.includes('hierarchy/'));assert.ok(small.length<full.length/2,`${small.length} vs ${full.length}`);
 // The raw hierarchy stays in the evidence file only.
 assert.equal((await r.store.run(run.id)).observations.at(-1).xml,undefined);assert.ok((await r.store.resource(`evidence/${result.observation.id}.json`)).toString().includes('<hierarchy/>'));
 await r.finish(run.id);});

test('goto reaches a known screen in one call and declared deeplinks are permitted',async t=>{const r=await setup(t);const first=await r.start({target:'web',mode:'exploratory',objective:'Learn'});
 assert.equal((await r.store.graph()).deeplinks.web[0].pattern,'shop://app');
 await r.step(first.id,{type:'click',elementId:'0123456789abcdef'});await r.step(first.id,{type:'click',elementId:'0123456789abcdef'});
 await assert.rejects(r.step(first.id,{type:'deeplink',url:'other://app/cart'}),/not permitted/);
 const linked=await r.step(first.id,{type:'deeplink',url:'shop://app/cart'});assert.equal(linked.status,'completed');
 assert.equal((await r.store.graph()).screens.find(s=>s.name==='Cart').deeplinks[0].url,'shop://app/cart');
 await r.organize({screens:[{id:'Receipt',name:'Comprovante',description:'Confirma a compra.'}],flows:[{id:'buy',name:'Compra',screenIds:['Home','Cart','Comprovante'],runIds:[first.id]}]});await r.finish(first.id);
 const memory=briefMemory(await r.memory());assert.ok(memory.transitions.some(line=>line.includes('Home —Next→ Cart [POST /api/orders/{id}]')),memory.transitions.join('\n'));assert.deepEqual(memory.flows[0].screens,['Home','Cart','Comprovante']);assert.ok(JSON.stringify(memory).length<2500);
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
 assert.deepEqual(parseHttpLog('D OkHttp: --> POST https://h.test/api/login'),{phase:'request',method:'POST',url:'https://h.test/api/login'});assert.equal(parseHttpLog('D OkHttp: <-- 401 Unauthorized https://h.test/api/login (35ms, 12-byte body)').status,401);assert.equal(parseHttpLog('I App: hello'),null);
 assert.deepEqual(mergeApis([{method:'GET',host:'h',path:'/a',statuses:[200]}],[{method:'GET',host:'h',path:'/a',status:500},{method:'GET',host:'h',path:'/b',status:null}]),[{method:'GET',host:'h',path:'/a',statuses:[200,500]},{method:'GET',host:'h',path:'/b',statuses:[]}]);
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
