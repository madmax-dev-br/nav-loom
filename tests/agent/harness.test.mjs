import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {operations} from '../../agent/operations.mjs';
import {searchSource,screenTerms,guessRole} from '../../agent/sources.mjs';
const button=(id,name,y,extra={})=>({id,identity:id,name,actions:['click'],bounds:{x:.1,y,width:.6,height:.08},visible:true,...extra});
/** Login gate: the password field is sensitive; after a correct secret the app shows home with an API-backed list. */
class Gate{
 constructor(){this.screen='login';this.email='';this.password='';this.calls=[];}
 async capabilities(){return {available:['capture','interact','hierarchy','network'],missing:[]};}async start(){this.screen='login';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){if(this.screen==='login')return {route:'/login',screenKey:'login',stateKey:this.error?'error':'ready',title:'Login',heading:'Entrar',text:'Entrar\nE-mail\nSenha'+(this.error?'\nCredenciais inválidas':''),stateMarkers:[],elements:[button('email','E-mail',.2,{actions:['fill'],resourceId:'auth_email'}),button('password','Senha',.3,{actions:['fill'],sensitive:true,resourceId:'auth_password'}),button('submit','Entrar',.5,{resourceId:'auth_submit'})],viewport:{width:400,height:800},scroll:{y:0}};
  return {route:'/home',screenKey:'home',stateKey:'ready',title:'Home',heading:'Olá, Ana',text:'Olá, Ana\nProdutos',stateMarkers:[],elements:[button('products','Produtos',.4,{resourceId:'tab_products'})],viewport:{width:400,height:800},scroll:{y:0}};}
 async act(a,element){if(a.type==='fill'&&element?.id==='email')this.email=a.value;if(a.type==='fill'&&element?.id==='password')this.password=a.value;if(a.type==='click'&&element?.id==='submit'){if(this.password==='s3cret!'){this.screen='home';this.error=false;this.calls.push({method:'POST',url:'http://api.test/api/login',status:200},{method:'GET',url:'http://api.test/api/me',status:200});}else{this.error=true;this.calls.push({method:'POST',url:'http://api.test/api/login',status:401});}}}
 async drainNetwork(){const c=this.calls;this.calls=[];return c;}async diagnostics(){return {availability:'available',logs:[{level:'info',message:'password=s3cret! should be redacted'}]};}async close(){}
}
const config={version:2,kind:'navloom-agent-project',id:'gate',name:'Gated app',targets:{web:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},repositories:[{id:'code',path:'repo',description:'App and API'}],permissions:{actions:['open','click','fill','scroll','back','wait'],pluginCapabilities:[]}};
async function setup(t){const root=await mkdtemp(join(tmpdir(),'navloom-harness-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'repo/app/src/main/java/dev/app'),{recursive:true});await mkdir(join(root,'repo/server/routes'),{recursive:true});
 await writeFile(join(root,'repo/app/src/main/java/dev/app/LoginScreen.kt'),'package dev.app\n// Login screen\nfun LoginScreen() { TextField(Modifier.testTag("auth_email")); TextField(Modifier.testTag("auth_password")); Button(Modifier.testTag("auth_submit")) { api.post("/api/login") } }\n');
 await writeFile(join(root,'repo/app/src/main/java/dev/app/HomeScreen.kt'),'package dev.app\nfun HomeScreen() { Text("Olá, Ana"); Tab(Modifier.testTag("tab_products")); api.get("/api/me") }\n');
 await writeFile(join(root,'repo/server/routes/auth.mjs'),"router.post('/api/login', login);\nrouter.get('/api/me', me);\n");
 await writeFile(join(root,'repo/server/.env'),'SECRET=do-not-read\n');
 const r=await new Runtime(root,{executorFactory:()=>new Gate()}).init();await r.configure(config);return r;}
test('the agent asks for a credential, a person answers, the secret stays local and the harness remembers',async t=>{
 const r=await setup(t);const run=await r.start({target:'web',mode:'exploratory',objective:'Entrar e explorar'});
 const entry=run.observations[0];assert.equal(entry.help.needs.length,1);assert.equal(entry.help.needs[0].kind,'credential');assert.equal(entry.help.needs[0].known,null,'nothing known yet');
 await assert.rejects(r.step(run.id,{type:'fill',elementId:'password',value:'x'}),/secretRef/);
 await assert.rejects(r.step(run.id,{type:'fill',elementId:'password',secretRef:'login_password'}),/not configured in the profile nor answered/);
 const asked=await r.ask({runId:run.id,kind:'credential',question:'Qual é a senha da conta de teste?',why:'A tela de login exige senha e nenhum perfil tem esse segredo.',screenId:entry.screenId,stateId:entry.stateId,elementIdentity:'password',secretRef:'login_password'});
 assert.equal(asked.status,'pending');const again=await r.ask({runId:run.id,kind:'credential',question:'Qual é a senha da conta de teste?',screenId:entry.screenId,elementIdentity:'password'});assert.equal(again.request.id,asked.request.id,'duplicates collapse');
 assert.equal((await r.status()).requests.length,1);
 const waiting=await r.awaitAnswer({requestId:asked.request.id,timeoutMs:1200,intervalMs:100});assert.equal(waiting.status,'pending');
 await assert.rejects(r.answer({requestId:asked.request.id,value:'s3cret!'},'mcp-agent'),/Only a person/);
 const timer=setTimeout(()=>void r.answer({requestId:asked.request.id,value:'s3cret!'},'interface'),300);t.after(()=>clearTimeout(timer));
 const answered=await r.awaitAnswer({requestId:asked.request.id,timeoutMs:5000,intervalMs:100});assert.equal(answered.status,'answered');assert.deepEqual(answered.entry.answer,{type:'secretRef',secretRef:'login_password'});
 assert.match(await readFile(join(r.store.dir,'secrets.json'),'utf8'),/s3cret!/);
 await r.step(run.id,{type:'fill',elementId:'email',value:'ana@test'});await r.step(run.id,{type:'fill',elementId:'password',secretRef:'login_password'});const login=await r.step(run.id,{type:'click',elementId:'submit'});
 assert.equal(login.status,'completed');assert.equal(login.observation.screenKey,'home');assert.deepEqual(login.step.network.map(c=>[c.method,c.path,c.status]),[['POST','/api/login',200],['GET','/api/me',200]]);
 const saved=await r.store.run(run.id);assert.equal(saved.steps[1].action.value,undefined,'secret value is not persisted on the step');
 const graph=await r.store.graph();assert.equal(graph.harness.length,1);assert.deepEqual(graph.harness[0].uses,[run.id]);
 const memory=await r.memory();assert.equal(memory.harness[0].answer.secretRef,'login_password');assert.equal(JSON.stringify(memory).includes('s3cret!'),false,'memory never carries the value');
 const finished=await r.finish(run.id);assert.equal(JSON.stringify(finished.diagnostics).includes('s3cret!'),false,'diagnostics are redacted with local secrets');
 const map=await readFile(join(r.store.root,'navloom-map','map.yaml'),'utf8');assert.match(map,/secretRef: login_password/);assert.equal(map.includes('s3cret!'),false);assert.match(await readFile(join(r.store.root,'navloom-map','README.md'),'utf8'),/Harness: ajuda registrada/);
 // A later run already knows: the observation points at the secret and ask() returns the known entry.
 const second=await r.start({target:'web',mode:'focused',objective:'Entrar de novo'});const need=second.observations[0].help.needs[0];assert.equal(need.secretRef,'login_password');assert.ok(need.known);
 const known=await r.ask({runId:second.id,kind:'credential',question:'Senha?',screenId:second.observations[0].screenId,elementIdentity:'password'});assert.equal(known.status,'known');assert.equal(known.entries[0].answer.secretRef,'login_password');
 const asked2=await r.ask({runId:second.id,kind:'decision',question:'Posso criar uma conta nova?',screenId:second.observations[0].screenId,options:['sim','não']});await r.answer({requestId:asked2.request.id,option:'não'},'interface');
 assert.deepEqual((await r.store.graph()).harness.map(h=>h.answer.type),['secretRef','option']);const forgotten=await r.forgetHelp({id:(await r.store.graph()).harness[0].id});assert.equal(forgotten.answer.secretRef,'login_password');assert.equal(JSON.parse(await readFile(join(r.store.dir,'secrets.json'),'utf8')).login_password,undefined);
 await r.finish(second.id);
 // Imported map restores harness entries (public parts) for a fresh checkout.
 const {importMap}=await import('../../agent/map.mjs');const imported=await importMap(join(r.store.root,'navloom-map'));assert.equal(imported.harness.length,1);assert.equal(imported.harness[0].answer.type,'option');
});
test('source search, deterministic link suggestions and confirmed links for screens and endpoints',async t=>{
 const r=await setup(t);const run=await r.start({target:'web',mode:'exploratory',objective:'Linkar código'});
 const asked=await r.ask({runId:run.id,kind:'credential',question:'Senha?',screenId:run.observations[0].screenId,elementIdentity:'password',secretRef:'login_password'});await r.answer({requestId:asked.request.id,value:'s3cret!'},'interface');
 await r.step(run.id,{type:'fill',elementId:'password',secretRef:'login_password'});const home=await r.step(run.id,{type:'click',elementId:'submit'});await r.finish(run.id);
 const root=join(r.store.root,'repo');const found=await searchSource(root,{query:'auth_submit'});assert.deepEqual(found.hits.map(h=>[h.path,h.line]),[['app/src/main/java/dev/app/LoginScreen.kt',3]]);assert.equal((await searchSource(root,{query:'do-not-read'})).hits.length,0,'.env is never read');
 assert.equal(guessRole('server/routes/auth.mjs'),'backend');assert.equal(guessRole('app/src/main/java/dev/app/LoginScreen.kt'),'frontend');
 const graph=await r.store.graph();const login=graph.screens.find(s=>s.screenKey==='login');const terms=screenTerms(graph,login);assert.equal(terms[0].term,'login');assert.ok(terms.some(x=>x.term==='auth_submit'));
 const suggestions=await r.suggestLinks({screenId:login.id});assert.equal(suggestions.screen.candidates[0].path,'app/src/main/java/dev/app/LoginScreen.kt');assert.equal(suggestions.screen.candidates[0].role,'frontend');
 assert.deepEqual(Object.keys(suggestions.endpoints).sort(),['GET /api/me','POST /api/login']);assert.equal(suggestions.endpoints['POST /api/login'].backend[0].path,'server/routes/auth.mjs');assert.equal(suggestions.endpoints['POST /api/login'].frontend[0].path,'app/src/main/java/dev/app/LoginScreen.kt');
 const linked=await r.link({kind:'screen',id:login.id,repository:'code',path:'app/src/main/java/dev/app/LoginScreen.kt',line:3,status:'confirmed'});assert.equal(linked.links[0].role,'frontend');assert.equal(linked.links[0].status,'confirmed');
 await assert.rejects(r.link({kind:'screen',id:login.id,repository:'code',path:'../outside'}),/outside/);
 const endpoint=await r.link({kind:'endpoint',id:'POST /api/login',repository:'code',path:'server/routes/auth.mjs',line:1,status:'confirmed'});assert.equal(endpoint.links[0].role,'backend');await assert.rejects(r.link({kind:'endpoint',id:'DELETE /nope',repository:'code',path:'server/routes/auth.mjs'}),/not observed/);
 const status=await r.status({detail:'full'});assert.equal(status.endpoints.find(e=>e.path==='/api/login').links[0].path,'server/routes/auth.mjs');const compact=await r.status();assert.ok(compact.endpoints.includes('POST /api/login 200'));assert.equal(compact.graph,undefined,'compact status carries no graph');
 const tree=await r.sourceTree({repository:'code',path:'server',depth:2});assert.ok(tree.entries.some(e=>e.path==='server/routes/auth.mjs'));assert.ok(!tree.entries.some(e=>e.path.endsWith('.env')));
 const readme=await readFile(join(r.store.root,'navloom-map','README.md'),'utf8');assert.match(readme,/Código: `code:app\/src\/main\/java\/dev\/app\/LoginScreen.kt:3` \(frontend, confirmed\)/);assert.match(readme,/`code:server\/routes\/auth.mjs:1` \(confirmed\)/);
 const names=Object.keys(operations(null,null));for(const name of ['ask','await','answer','help','forget_help','search_source','source_tree','link_suggestions','link'])assert.ok(names.includes(name),name);
 void home;
});
