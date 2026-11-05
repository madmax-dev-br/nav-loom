import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {AndroidExecutor} from '../../agent/executors/android.mjs';
import {encodePng} from '../../agent/png.mjs';
/**
 * A simulated device answering the exact adb commands the Android executor issues: uiautomator dumps with real
 * bounds, taps by coordinate, dumpsys activity focus, logcat with the device's own clock, screencap, dumpsys
 * package intent filters and deeplinks via `am start -a VIEW`. It exercises the real executor, not a stand-in.
 */
const PKG='dev.navloom.sim',W=1080,H=2280,DEVICE_CLOCK_OFFSET=5400;// device clock 90 minutes ahead of the host
class SimDevice{
 constructor(){this.screen=null;this.stack=[];this.favorite=false;this.logs=[];this.calls=[];this.taps=[];}
 now(){return (Date.now()/1000+DEVICE_CLOCK_OFFSET).toFixed(3);}
 log(message){this.logs.push(`${this.now()}  4242  4242 I NavloomSim: ${message}`);}
 request(method,path,status=200){this.log(`${method} ${path} -> ${status}`);}
 launch(){this.screen='home';this.stack=[];this.request('GET','/api/me');}
 open(screen){if(this.screen)this.stack.push(this.screen);this.screen=screen;if(screen==='products')this.request('GET','/api/products');if(screen==='product')this.request('GET','/api/products/tote');}
 back(){if(this.screen==='pix'||this.stack.length===0){this.screen=null;return;}this.screen=this.stack.pop();}
 nodes(){const node=(id,text,y,{clickable=true,cls='android.widget.Button',h=140,desc=''}={})=>({id,text,y,clickable,cls,h,desc});
  switch(this.screen){
   case 'home':return [node('title','Olá, Ana',120,{clickable:false,cls:'android.widget.TextView',desc:'navloom:screen:home:state:ready'}),node('btn_products','Produtos',500),node('btn_pix','Pix',700),node('btn_logout','Sair',900)];
   case 'products':return [node('title','Produtos',120,{clickable:false,cls:'android.widget.TextView',desc:'navloom:screen:products:state:ready'}),node('item_tote','Bolsa tote',500),node('tab_home','Início',2100)];
   case 'product':return [node('title','Detalhes do produto',120,{clickable:false,cls:'android.widget.TextView',desc:`navloom:screen:product:state:${this.favorite?'favorite':'ready'}`}),node('btn_fav',this.favorite?'Remover favorito':'Favoritar',600),node('btn_add','Adicionar ao carrinho',800)];
   case 'pix':return [node('title','Transferir Pix',120,{clickable:false,cls:'android.widget.TextView',desc:'navloom:screen:pix:state:ready'}),node('pix_key','Chave Pix',500,{cls:'android.widget.EditText',clickable:true})];
   default:return [];}}
 xml(){const rows=this.nodes().map((n,i)=>`<node index="${i}" text="${n.text}" resource-id="${PKG}:id/${n.id}" class="${n.cls}" content-desc="${n.desc}" clickable="${n.clickable}" enabled="true" scrollable="false" password="false" bounds="[80,${n.y}][1000,${n.y+n.h}]" />`).join('');return `<?xml version='1.0'?><hierarchy rotation="0">${rows}</hierarchy>`;}
 tap(x,y){this.taps.push([x,y]);const hit=this.nodes().find(n=>n.clickable&&x>=80&&x<=1000&&y>=n.y&&y<=n.y+n.h);if(!hit)return;
  if(hit.id==='btn_products')this.open('products');else if(hit.id==='item_tote')this.open('product');else if(hit.id==='btn_fav'){this.favorite=!this.favorite;this.request('POST','/api/favorites',this.favorite?201:200);}else if(hit.id==='btn_pix')this.open('pix');else if(hit.id==='tab_home'){this.stack=[];this.screen='home';}else if(hit.id==='btn_logout'){this.screen=null;}}
 async adb(file,args){const a=args.slice(2),cmd=a.join(' ');
  if(cmd==='get-state')return 'device\n';
  if(cmd===`shell pm path ${PKG}`)return `package:/data/app/${PKG}/base.apk\n`;
  if(cmd==='shell wm size')return 'Physical size: 1080x2280\n';
  if(cmd.startsWith('shell am start -n')){this.launch();return 'Starting: Intent\n';}
  if(cmd.startsWith('shell am start -a android.intent.action.VIEW')){const url=a[6].replace(/^'|'$/g,'');const path=url.replace(/^navloomsim:\/\/app\/?/,'');if(!url.startsWith('navloomsim://'))return 'Error: Activity not started, unable to resolve Intent\n';if(!this.screen)this.launch();this.open(path==='products'?'products':path==='pix'?'pix':'home');return 'Starting: Intent\n';}
  const focus=()=>`  mResumedActivity: ActivityRecord{1a2b u0 ${this.screen?PKG+'/.MainActivity':'com.android.launcher3/.Launcher'} t42}\n`;
  if(cmd.startsWith('shell dumpsys activity activities')&&cmd.includes('uiautomator dump'))return focus()+'__NAVLOOM_SPLIT__\n'+this.xml();
  if(cmd.startsWith('shell dumpsys activity activities'))return focus();
  if(cmd.startsWith('shell uiautomator dump'))return this.xml();
  if(cmd==='exec-out screencap -p'){const color={home:[240,236,255],products:[230,245,240],product:this.favorite?[200,40,40]:[255,245,230],pix:[230,236,255]}[this.screen]??[0,0,0];const pixels=new Uint8Array(60*120*4);for(let i=0;i<60*120;i++){pixels[i*4]=color[0];pixels[i*4+1]=color[1];pixels[i*4+2]=color[2];pixels[i*4+3]=255;}return encodePng({width:60,height:120,pixels});}
  if(cmd===`shell pidof ${PKG}`)return '4242\n';
  if(cmd.startsWith('shell pid=$(pidof')||cmd.startsWith('logcat -d -v epoch'))return this.logs.join('\n')+'\n';
  if(cmd.startsWith('shell input tap')){this.tap(Number(a[3]),Number(a[4]));return '';}
  if(cmd==='shell input keyevent 4'){this.back();return '';}
  if(cmd===`shell dumpsys package ${PKG}`)return `Packages:\n  Package [${PKG}] (abc):\n    versionCode=7 minSdk=26 targetSdk=35\n    versionName=1.2.0\nActivity Resolver Table:\n  Non-Data Actions:\n      android.intent.action.MAIN:\n        43e2e0b ${PKG}/.MainActivity filter 6e9c3e8\n          Action: "android.intent.action.MAIN"\n          Category: "android.intent.category.LAUNCHER"\n  Schemes:\n      navloomsim:\n        43e2e0b ${PKG}/.MainActivity filter 2f8a1c1\n          Action: "android.intent.action.VIEW"\n          Category: "android.intent.category.DEFAULT"\n          Category: "android.intent.category.BROWSABLE"\n          Scheme: "navloomsim"\n          Authority: "app": -1\n          Path: "PatternMatcher{PREFIX: /}"\n`;
  if(cmd.startsWith('shell sha256sum'))return 'deadbeef  /data/app/base.apk\n';
  throw Error('Unexpected adb command: '+cmd);}
}
const config={version:2,kind:'navloom-agent-project',id:'sim',name:'Simulated Android app',targets:{android:{platform:'android',serial:'emulator-5554',package:PKG,activity:'.MainActivity',adb:'adb'}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:['navloomsim://app/'],pluginCapabilities:[]}};
test('simulated Android device: deterministic exploration with the real executor, logcat API calls, back recovery, deeplinks and map export',async t=>{
 const device=new SimDevice();const root=await mkdtemp(join(tmpdir(),'navloom-android-sim-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const r=await new Runtime(root,{executorFactory:target=>new AndroidExecutor(target,{runCommand:(file,args)=>device.adb(file,args)})}).init();await r.configure(config);
 const capabilities=await r.capabilities('android');assert.ok(capabilities.available.includes('interact'));assert.ok(capabilities.conditional.includes('network'));
 const run=await r.start({target:'android',mode:'exploratory',objective:'Explorar o app simulado'});assert.equal(run.status,'running',run.stopReason);assert.equal(run.observations[0].screenKey,'home');assert.equal(run.observations[0].hierarchy,'available');
 const entry=run.observations[0];assert.equal(entry.xml,undefined,'raw hierarchy XML never travels with the observation');assert.match(entry.digest,/^screen=home state=ready route=dev\.navloom\.sim\/\.MainActivity viewport=1080x2280 nodes=4/);assert.match(entry.digest,/btn "Produtos" @80,500 920x140 #btn_products \[click\] id=/);assert.equal(entry.preview,`evidence/${entry.id}.jpg`);await r.flushPreviews();assert.equal((await r.store.resource(entry.preview)).subarray(0,2).toString('hex'),'ffd8');const {leanObservation}=await import('../../agent/lean.mjs');const lean=leanObservation(entry,{candidates:true});assert.ok(JSON.stringify(lean).length<JSON.stringify(entry).length/2,'compact view is less than half of the full observation');assert.deepEqual(lean.candidates.map(c=>[c.name,c.rid,c.actions]),[['Produtos','btn_products',['click']],['Pix','btn_pix',['click']],['Sair','btn_logout',['click']]]);
 assert.deepEqual(run.observations[0].network.map(c=>[c.method,c.path,c.status]),[['GET','/api/me',200]],'entry calls read from the device clock, not the host clock');
 const explored=await r.explore(run.id,{maxCandidates:12,settleMs:10});
 // Stable order: home buttons top-down, Pix back leaves the app and is recovered, other states reached by confirmed routes,
 // a dead end tries one back, "Remover favorito" is skipped by the avoid list, and the pre-favorite state becomes unreachable
 // because the app persisted the favorite (reported, not hidden).
 assert.deepEqual(explored.results.map(x=>[x.label,x.outcome??null,x.returned??null]),[['Produtos','navigation',true],['Pix','navigation',false],['Bolsa tote','navigation',true],['Início','navigation',null],['Chave Pix','none',null],['(voltar)',null,null],['Favoritar','state',null],['Adicionar ao carrinho','none',null],['(voltar)','navigation',null],['Adicionar ao carrinho',null,null]]);
 assert.equal(explored.stopReason,'route_recovery_required');assert.equal(explored.results.at(-1).status,'unreachable');assert.equal(explored.results.at(-1).replay.status,'diverged');
 const sameAgain=new SimDevice();const again=await new Runtime(await mkdtemp(join(tmpdir(),'navloom-android-sim2-')),{executorFactory:target=>new AndroidExecutor(target,{runCommand:(file,args)=>sameAgain.adb(file,args)})}).init();await again.configure(config);const second=await again.start({target:'android',mode:'exploratory',objective:'Repetir'});const repeat=await again.explore(second.id,{maxCandidates:5,settleMs:10});assert.deepEqual(repeat.results.map(x=>x.label),['Produtos','Pix','Bolsa tote','Início','Chave Pix'],'same device, same order');await again.close();await rm(again.store.root,{recursive:true,force:true});
 const saved=await r.store.run(run.id);assert.equal(saved.status,'running','back leaving the app and diverging preparation replays are recovered, not fatal');assert.equal(saved.frontier.find(f=>f.label==='Sair').status,'skipped');
 const pixProbe=explored.results[1];assert.equal(pixProbe.summary.startsWith('Toque em "Pix" abre a tela "Transferir Pix"'),true);
 const recovered=saved.steps.find(s=>s.action.type==='back'&&s.status==='failed');assert.match(recovered.error,/relaunched/);
 assert.ok(device.taps.every(([x,y])=>x===540&&y>0&&y<H),'taps land in the centre of real bounds');
 const graph=await r.store.graph();
 const products=graph.transitions.find(e=>e.name==='Produtos');assert.deepEqual(products.network.map(n=>[n.method,n.path,n.statuses]),[['GET','/api/products',[200]]]);assert.equal(products.network[0].count,products.evidence.length,'one call per traversal of the transition');
 const favorite=graph.transitions.find(e=>e.name==='Favoritar');assert.equal(favorite.kind,'state');assert.ok(graph.transitions.some(e=>e.name==='Bolsa tote'&&graph.states.find(s=>s.id===e.to)?.name==='favorite'),'the diverged preparation replay was recorded as a new transition');assert.deepEqual(favorite.network.map(n=>[n.method,n.path,n.statuses]),[['POST','/api/favorites',[201]]]);assert.ok(favorite.imageChange.changedRatio>.9);
 const links=await r.deeplinks({runId:run.id});assert.equal(links.declared[0].schemes[0],'navloomsim');assert.deepEqual(links.declared[0].examples,['navloomsim://app/']);
 const viaLink=await r.step(run.id,{type:'deeplink',url:'navloomsim://app/pix'});assert.equal(viaLink.status,'completed');assert.equal(viaLink.observation.screenKey,'pix');
 await assert.rejects(r.step(run.id,{type:'deeplink',url:'https://outside.test/'}),/not permitted/);
 const verified=(await r.deeplinks({runId:run.id})).verified;assert.equal(verified.length,1);assert.equal(verified[0].url,'navloomsim://app/pix');
 const finished=await r.finish(run.id);assert.equal(finished.coverage.visited>=6,true);
 const map=await readFile(join(root,'navloom-map','map.yaml'),'utf8');assert.match(map,/navloomsim:\/\/app\/pix/);assert.match(map,/path: \/api\/favorites/);const readme=await readFile(join(root,'navloom-map','README.md'),'utf8');assert.match(readme,/Transferir Pix/);
 const stored=await r.store.graph();assert.ok(stored.states.every(s=>s.thumbnail),'Android captures become thumbnails');assert.ok(stored.states.find(s=>s.name==='ready'&&s.hotspots.some(h=>h.name==='Produtos')));
});
