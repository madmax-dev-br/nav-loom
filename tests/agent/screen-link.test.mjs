import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {stringify} from 'yaml';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Runtime} from '../../agent/runtime.mjs';
import {createService} from '../../agent/service.mjs';
import {operations,resolveLinks} from '../../agent/operations.mjs';
import {resolveScreen,resolveState} from '../../agent/graph.mjs';
import {screenLink,parseScreenLink} from '../../lib/screen-link.mjs';

/**
 * The link a person copies from a screen of the interface and pastes to the agent. A three-screen Android app with no ids:
 * the home, a list, and a help page that is really the home with a panel open (the case "turn this screen into a state").
 */
function screen(world){
 const items=[];let index=0;
 const node=e=>{const role=e.role??'android.view.View',identity=[`${role}:${index++}`,role,e.text||role].join('|');items.push({id:createHash('sha256').update(world.screen+identity).digest('hex').slice(0,24),identity,name:e.text||role,role,resourceId:'',contentDescription:'',text:e.text??'',disabled:false,sensitive:false,actions:e.click?['click']:[],bounds:{x:.1,y:e.y,width:.8,height:.05},visible:true,label:e.label??e.text??role});};
 const text=(t,y)=>node({role:'android.widget.TextView',text:t,y}),button=(label,y)=>node({click:true,y,label});
 if(world.screen==='home'){text('Minha conta',.08);text('Saldo disponível',.2);button('Abrir lista',.3);button('Ajuda',.4);}
 if(world.screen==='list'){text('Pedidos',.08);text('Pedido 1',.2);text('Pedido 2',.3);button('Filtrar',.5);}
 if(world.screen==='help'){text('Central de ajuda',.08);text('Perguntas frequentes',.2);button('Falar com atendente',.3);button('Fechar',.4);}
 const head=items[0].text;
 return {platform:'android',route:'dev.conta/.MainActivity',activity:'dev.conta/.MainActivity',header:head,heading:head,keyboard:false,text:items.map(e=>e.text).filter(Boolean).join('\n'),elements:items,viewport:{width:1080,height:2400},scroll:{position:'unknown'},hierarchy:'available',xml:'<hierarchy/>'};
}
class App{
 constructor(world){this.world=world;}
 async capabilities(){return {available:['capture','interact','hierarchy','logs','back','scroll'],missing:[]};}
 async start(){this.world.screen='home';}async restart(){this.world.screen='home';}async build(){return {version:'1'};}async capture(){return Buffer.from('png');}
 async observe(){return screen(this.world);}
 async act(action,element){const w=this.world,label=element?.label??'';if(action.type==='back'){w.screen='home';return;}if(action.type!=='click')return;if(label==='Abrir lista')w.screen='list';else if(label==='Ajuda')w.screen='help';else if(label==='Fechar')w.screen='home';}
 async network(){return {calls:[],late:[]};}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
const config={version:2,kind:'navloom-agent-project',id:'conta',name:'Conta',review:'auto',targets:{app:{platform:'android',serial:'emulator-5554',package:'dev.conta',adb:'adb'}},permissions:{actions:['open','click','fill','scroll','back','wait'],deeplinkPrefixes:[],pluginCapabilities:['read_graph'],pluginImages:[]}};
async function setup(t,world,{review='auto'}={}){const root=await mkdtemp(join(tmpdir(),'navloom-link-'));t.after(()=>rm(root,{recursive:true,force:true}));const r=await new Runtime(root,{executorFactory:()=>new App(world)}).init();await r.configure({...config,review});return r;}
async function tap(r,runId,label){const run=await r.store.run(runId),o=run.observations.at(-1),e=o.elements.find(x=>x.actions.includes('click')&&x.label===label);assert.ok(e,`no "${label}" on ${o.heading}`);return r.step(runId,{type:'click',elementId:e.id});}
/** Home → list → home → help → home, approved: three screens, each with one state. */
async function mapped(t,world,options){const r=await setup(t,world,options),run=await r.start({target:'app',mode:'record',objective:'Mapear'});await tap(r,run.id,'Abrir lista');await r.step(run.id,{type:'back'});await tap(r,run.id,'Ajuda');await tap(r,run.id,'Fechar');await r.finish(run.id);if(options?.review==='required')await r.decideReview({runId:run.id,decision:'approve'});
 const graph=await r.store.graph(),named=name=>graph.screens.find(s=>s.name===name);return {r,ops:operations(r,{list:()=>[]}),home:named('Minha conta'),list:named('Pedidos'),help:named('Central de ajuda')};}

test('a screen link survives the ways a chat wraps it, and nothing else is taken for one',()=>{
 const id='a1b2c3d4e5f6a1b2c3d4e5f6',state='0f'.repeat(12);
 assert.equal(screenLink({screen:id}),`navloom://screen/${id}`);assert.deepEqual(parseScreenLink(screenLink({screen:id})),{screen:id});assert.deepEqual(parseScreenLink(screenLink({screen:id,state})),{screen:id,state});
 assert.deepEqual(parseScreenLink(screenLink({screen:'tela/1 ?x',state:'a&b'})),{screen:'tela/1 ?x',state:'a&b'},'ids are encoded both ways');
 for(const text of [`transforme navloom://screen/${id}?state=${state} em estado da home`,`Veja (navloom://screen/${id}?state=${state}).`,`\`navloom://screen/${id}?state=${state}\``,`**navloom://screen/${id}?state=${state}**`,`<navloom://screen/${id}?state=${state}>,`,`[tela](navloom://screen/${id}?state=${state})`,`"navloom://screen/${id}?state=${state}"`,`NAVLOOM://screen/${id}?from=map&state=${state}`])assert.deepEqual(parseScreenLink(text),{screen:id,state},text);
 assert.deepEqual(parseScreenLink(`é esta: navloom://screen/${id}.`),{screen:id},'the full stop ends the sentence, not the id');assert.deepEqual(parseScreenLink(`navloom://screen/${id}?state=`),{screen:id});
 for(const text of ['',null,undefined,'navloom://screen/','navloom://screen/%E0%A4%A','navloom://state/abc','https://navloom.dev/screen/abc',42])assert.equal(parseScreenLink(text),null,String(text));
});

test('a link becomes the id wherever an operation takes a screen or a state, following merges',()=>{
 const graph={screens:[{id:'home0000',name:'Home',target:'app'},{id:'list0000',name:'Lista',target:'app'}],states:[{id:'st-home',screenId:'home0000',name:'padrão'},{id:'st-list',screenId:'list0000',name:'padrão'}],aliases:{old00000:'mid00000',mid00000:'home0000',loop0000:'loop0000'},stateAliases:{'st-old':'st-home'}};
 const home=screenLink({screen:'home0000'}),homeState=screenLink({screen:'home0000',state:'st-home'}),list=screenLink({screen:'list0000',state:'st-list'});
 assert.deepEqual(resolveLinks(graph,{screen:home,detail:'compact'}),{screen:'home0000',detail:'compact'});
 assert.deepEqual(resolveLinks(graph,{into:` <${home}> `,from:[`"${list}"`,'list0000'],kind:'screen'}),{into:'home0000',from:['list0000','list0000'],kind:'screen'},'wrapped links, in lists, beside plain ids');
 assert.deepEqual(resolveLinks(graph,{into:homeState,from:[list],kind:'state'}),{into:'st-home',from:['st-list'],kind:'state'},'beside kind=state the link gives its state');
 assert.deepEqual(resolveLinks(graph,{screens:[{id:list,name:'Pedidos'}],flows:[{id:'compra',name:'Compra',screenIds:[home,list]}]}),{screens:[{id:'list0000',name:'Pedidos'}],flows:[{id:'compra',name:'Compra',screenIds:['home0000','list0000']}]},'nested arguments');
 assert.deepEqual(resolveLinks(graph,{kind:'state',id:list,description:'Lista de pedidos'}),{kind:'state',id:'st-list',description:'Lista de pedidos'});
 assert.deepEqual(resolveLinks(graph,{screen:homeState},{screen:1,state:1}),{screen:'home0000',state:'st-home'},'a link to a state aims an operation that has a state argument at it');
 assert.deepEqual(resolveLinks(graph,{screen:homeState,state:'st-other'},{screen:1,state:1}),{screen:'home0000',state:'st-other'},'an explicit state wins');assert.deepEqual(resolveLinks(graph,{screen:homeState},{screen:1}),{screen:'home0000'});
 assert.deepEqual(resolveLinks(graph,{screenId:homeState,question:'?'},{screenId:1,stateId:1}),{screenId:'home0000',stateId:'st-home',question:'?'});
 assert.deepEqual(resolveLinks(graph,{screen:screenLink({screen:'old00000',state:'st-old'}),state:screenLink({screen:'old00000',state:'st-old'})}),{screen:'home0000',state:'st-home'},'ids folded by a merge are followed through their aliases');
 assert.deepEqual(resolveLinks(graph,{screen:screenLink({screen:'gone0000',state:'st-list'})}),{screen:'list0000'},'a state that moved is found on the screen it has now');
 const prose={description:`Igual a ${home} mas sem saldo`,action:{type:'fill',value:home},question:`${home} é a home?`};assert.deepEqual(resolveLinks(graph,prose),prose,'a link inside a sentence, or typed into the app, stays text');
 assert.throws(()=>resolveLinks(graph,{screen:screenLink({screen:'gone0000aaaa'})}),/linked screen gone0000 no longer exists in the map/);assert.throws(()=>resolveLinks(graph,{screen:screenLink({screen:'loop0000'})}),/no longer exists/);
 assert.throws(()=>resolveLinks(graph,{state:home}),/names the screen "Home", not one of its states/);assert.throws(()=>resolveLinks(graph,{state:screenLink({screen:'home0000',state:'st-gone'})}),/linked state st-gone no longer exists.*its screen "Home" does/);
});

test('the bare id of a merged screen or state, full or short, follows the same trail as its link',()=>{
 const graph={screens:[{id:'home0000aaaa',name:'Home',target:'app'},{id:'list0000aaaa',name:'Lista',target:'app'}],states:[{id:'st-home-0001',screenId:'home0000aaaa',name:'padrão'},{id:'st-home-0002',screenId:'home0000aaaa',name:'erro'},{id:'st-list-0001',screenId:'list0000aaaa',name:'padrão'}],aliases:{old00000aaaa:'mid00000aaaa',mid00000aaaa:'home0000aaaa',old00000bbbb:'list0000aaaa',loop0000aaaa:'loop0000aaaa',lost0000aaaa:'gone0000aaaa'},stateAliases:{'st-old-00001':'st-mid-00001','st-mid-00001':'st-home-0002'}};
 for(const ref of ['home0000aaaa','home0000','old00000aaaa','mid00000aaaa','old00000a','mid000','Home',screenLink({screen:'old00000aaaa'})])assert.equal(ref.startsWith('navloom')?resolveLinks(graph,{screen:ref}).screen:resolveScreen(graph,ref).id,'home0000aaaa',ref);
 assert.equal(resolveScreen(graph,'old00000b').id,'list0000aaaa');assert.throws(()=>resolveScreen(graph,'old00000'),/ambiguous/,'a short id two merged screens share, now different screens');assert.equal(resolveScreen({...graph,aliases:{...graph.aliases,old00000bbbb:'home0000aaaa'}},'old00000').id,'home0000aaaa','both were folded into the same screen: no doubt');
 for(const ref of ['loop0000aaaa','lost0000aaaa','lost0000','nope0000','old0'])assert.throws(()=>resolveScreen(graph,ref),/Unknown screen/,ref);assert.throws(()=>resolveScreen(graph,'old00000aaaa','other'),/Unknown screen/,'the screen it became is of another target');
 for(const ref of ['st-home-0002','st-home-0002'.slice(0,12),'st-old-00001','st-old','st-mid-0'])assert.equal(resolveState(graph,ref).id,'st-home-0002',ref);assert.equal(resolveLinks(graph,{state:screenLink({screen:'home0000aaaa',state:'st-old-00001'})}).state,resolveState(graph,'st-old-00001').id);
 assert.throws(()=>resolveState(graph,'st-home'),/Unknown or ambiguous state "st-home"/);assert.throws(()=>resolveState(graph,'erro'),/Unknown or ambiguous state/,'a name alone names no state');assert.equal(resolveState(graph,'Erro','home0000aaaa').id,'st-home-0002','beside its screen it does');assert.throws(()=>resolveState(graph,'st-list-0001','home0000aaaa'),/Unknown or ambiguous state/);
});

test('after a merge the operations take the old id bare as they take its link',async t=>{const world={},{r,ops,home,list,help}=await mapped(t,world);
 const before=await r.store.graph(),helpState=before.states.find(s=>s.screenId===help.id),homeState=before.states.find(s=>s.screenId===home.id),listState=before.states.find(s=>s.screenId===list.id);
 await ops.merge.call({into:home.id,from:[help.id],as:'state'});await ops.merge.call({kind:'state',into:homeState.id,from:[listState.id]});
 const graph=await r.store.graph();assert.equal(graph.aliases[help.id],home.id);assert.equal(graph.stateAliases[listState.id],homeState.id);
 const viaLink=await ops.screen.call({screen:screenLink({screen:help.id})});assert.match(viaLink,/^Tela: Minha conta/);
 for(const ref of [help.id,help.id.slice(0,8)]){assert.equal(await ops.screen.call({screen:ref}),viaLink,ref);assert.equal((await ops.screen.call({screenId:ref,detail:'full'})).id,home.id);assert.equal((await ops.goto.call({screen:ref,plan:true})).screen,'Minha conta');}
 await ops.organize.call({screens:[{id:help.id.slice(0,8),description:'Conta e ajuda.'}],flows:[{id:'f',name:'F',description:'',screenIds:[help.id,home.id]}]});const organized=await r.store.graph();assert.equal(organized.screens.find(s=>s.id===home.id).description,'Conta e ajuda.');assert.deepEqual(organized.flows.find(f=>f.id==='f').screenIds,[home.id]);
 // States alike: the id of a state folded into another reaches the one that kept it.
 for(const ref of [listState.id,listState.id.slice(0,8),screenLink({screen:list.id,state:listState.id})])assert.equal((await ops.goto.call({state:ref,plan:true})).screen,'Minha conta',ref);
 await r.describe({kind:'state',id:listState.id.slice(0,8),description:'Saldo e atalhos.'});assert.equal((await r.store.graph()).states.find(s=>s.id===homeState.id).description,'Saldo e atalhos.');
 await assert.rejects(ops.screen.call({screen:'f'.repeat(24)}),/Unknown screen/);await r.close();});

test('a link to one state of a screen shows that state, not the latest one',async t=>{const world={},{r,ops,home,help}=await mapped(t,world);
 const before=await r.store.graph(),helpState=before.states.find(s=>s.screenId===help.id),homeState=before.states.find(s=>s.screenId===home.id);await ops.merge.call({into:home.id,from:[help.id],as:'state'});
 const graph=await r.store.graph(),states=graph.states.filter(s=>s.screenId===home.id),last=states.at(-1),first=states.find(s=>s.id!==last.id);assert.equal(states.length,2);assert.notEqual(first.name,last.name);
 const shown=text=>/^Estado exibido: (.*?)(?: \(estados conhecidos: .*\))?$/m.exec(text)?.[1],untried=text=>/^Ações não mapeadas.*$/m.exec(text)?.[0]??'';
 assert.equal(shown(await ops.screen.call({screen:home.id})),last.name,'no state asked: the latest');
 for(const state of states){const link=screenLink({screen:home.id,state:state.id});
  for(const args of [{screen:link},{screenId:link},{screen:home.id,state:state.id},{screen:home.id,state:state.id.slice(0,8)},{screen:home.id,state:state.name},{state:state.id},{screen:link,state:link}]){assert.equal(shown(await ops.screen.call(args)),state.name,JSON.stringify(args));assert.equal((await ops.screen.call({...args,detail:'full'})).shownState,state.id);}}
 // What it says about untried controls is read from the capture of the state shown.
 const texts=await Promise.all([homeState,helpState].map(s=>ops.screen.call({screen:screenLink({screen:home.id,state:s.id})})));assert.equal(shown(texts[1]),'Central de ajuda');assert.match(untried(texts[1]),/Falar com atendente/);assert.doesNotMatch(untried(texts[0]),/Falar com atendente/);
 assert.equal(shown(await ops.screen.call({screen:screenLink({screen:home.id,state:homeState.id}),state:helpState.id})),'Central de ajuda','an explicit state wins over the link\'s');
 assert.equal(shown(await ops.screen.call({screen:screenLink({screen:home.id,state:'0'.repeat(24)})})),last.name,'a linked state that no longer exists: the screen, as before');
 await assert.rejects(ops.screen.call({screen:home.id,state:'0'.repeat(24)}),/Unknown or ambiguous state/);assert.equal((await ops.screen.call({screen:home.id,detail:'full'})).shownState,undefined);await r.close();});

test('a pasted link shows the screen, and turns it into a state of another screen once a person approves',async t=>{const world={},{r,ops,home,list,help}=await mapped(t,world,{review:'required'});
 const before=await r.store.graph(),helpState=before.states.find(s=>s.screenId===help.id),homeState=before.states.find(s=>s.screenId===home.id),edges=before.transitions.map(e=>({id:e.id,from:e.from,to:e.to})).sort((a,b)=>a.id.localeCompare(b.id));
 const link=screenLink({screen:help.id,state:helpState.id}),shown=await ops.screen.call({screen:link});
 assert.match(shown,/^Tela: Central de ajuda/);assert.ok(shown.includes(`Estados (id): ${helpState.name} ${helpState.id.slice(0,8)}`),'its states, by id');assert.match(shown,/Entra-se por: .*Minha conta/);assert.match(shown,/"Fechar" → Minha conta/);
 assert.equal((await ops.screen.call({screenId:link,detail:'full'})).id,help.id);assert.equal((await ops.goto.call({screen:screenLink({screen:list.id}),plan:true})).screen,'Pedidos');
 await ops.organize.call({screens:[{id:link,description:'Perguntas frequentes e atendimento.'}],flows:[{id:'suporte',name:'Suporte',description:'',screenIds:[screenLink({screen:home.id}),link]}]});
 const run=await r.start({target:'app',mode:'record',objective:'Organizar'});
 const merged=await ops.merge.call({into:screenLink({screen:home.id}),from:[link],as:'state'});
 assert.deepEqual(merged.merged,['Central de ajuda']);assert.deepEqual(merged.becameStates,[{id:helpState.id,name:'Central de ajuda'}]);assert.equal(merged.states,2);assert.equal(merged.pending,true,'inside a record mission it waits for approval');
 const done=await r.finish(run.id);assert.equal(done.review.status,'pending');assert.ok(done.changes.items.some(i=>i.kind==='merge'&&/Tela virou estado: Central de ajuda agora é estado de Minha conta/.test(i.text)));
 assert.ok((await r.store.recorded()).screens.some(s=>s.id===help.id),'the recorded map is unchanged until a person approves');
 await r.decideReview({runId:run.id,decision:'approve'});const graph=await r.store.recorded();
 assert.deepEqual(graph.screens.map(s=>s.name).sort(),['Minha conta','Pedidos'],'the help screen is gone');assert.equal(graph.aliases[help.id],home.id);
 const states=graph.states.filter(s=>s.screenId===home.id);assert.deepEqual(states.map(s=>s.id).sort(),[homeState.id,helpState.id].sort(),'its state was kept apart, with its id');
 const state=graph.states.find(s=>s.id===helpState.id);assert.equal(state.name,'Central de ajuda');assert.equal(state.description,'Perguntas frequentes e atendimento.');assert.equal(state.firstSeen,helpState.firstSeen,'evidence kept');
 assert.deepEqual(graph.transitions.map(e=>({id:e.id,from:e.from,to:e.to})).sort((a,b)=>a.id.localeCompare(b.id)),edges,'every transition still joins the same states');
 assert.deepEqual(graph.flows.find(f=>f.id==='suporte').screenIds,[home.id]);assert.ok(graph.states.every(s=>graph.screens.some(x=>x.id===s.screenId)),'no state is left without a screen');
 // The link the person copied before still works: it now names the home, and the state it pointed at.
 assert.match(await ops.screen.call({screen:link}),/^Tela: Minha conta/);const plan=await ops.goto.call({screen:link,plan:true});assert.equal(plan.status,'planned');assert.equal(plan.screen,'Minha conta');
 // Later captures of the panel land on the state, not on a new screen.
 const again=await r.start({target:'app',mode:'walk',objective:'Ver'});const step=await tap(r,again.id,'Ajuda');assert.equal(step.observation.screenId,home.id);assert.equal(step.observation.stateId,helpState.id);await r.finish(again.id);
 assert.equal((await r.store.graph()).screens.length,2);await r.close();});

test('a plain merge of the same two screens folds states that look alike; as=state never does',async t=>{const world={},{r,ops,home,help}=await mapped(t,world);
 const graph=await r.store.graph(),helpState=graph.states.find(s=>s.screenId===help.id),homeState=graph.states.find(s=>s.screenId===home.id);helpState.controls=[...homeState.controls];helpState.hotspots=homeState.hotspots;await r.store.saveRecorded(graph);
 const kept=await ops.merge.call({into:home.id,from:[screenLink({screen:help.id})],as:'state'});assert.equal(kept.states,2);assert.equal(kept.pending,false);
 const after=await r.store.graph();assert.equal(after.states.find(s=>s.id===helpState.id).screenId,home.id);
 // Another screen folded into the home later does not swallow the state a person asked to keep.
 const list=after.screens.find(s=>s.name==='Pedidos');await ops.merge.call({into:home.id,from:[list.id]});assert.ok((await r.store.graph()).states.some(s=>s.id===helpState.id));await r.close();});

test('through the MCP bridge a link reaches the operation as the screen it names',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-mcp-link-'));await writeFile(join(root,'navloom.yaml'),stringify(config));const service=await createService({root,port:0});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const graph=await service.runtime.store.graph(),at=new Date().toISOString();
 graph.screens.push({id:'a'.repeat(24),target:'app',name:'Minha conta',route:'dev.conta/.MainActivity',identity:'structural',description:'',links:[],sources:[],createdAt:at},{id:'b'.repeat(24),target:'app',name:'Central de ajuda',route:'dev.conta/.MainActivity',identity:'structural',description:'',links:[],sources:[],createdAt:at});
 graph.states.push({id:'c'.repeat(24),screenId:'a'.repeat(24),name:'padrão',description:'',markers:[],hotspots:[]},{id:'d'.repeat(24),screenId:'b'.repeat(24),name:'padrão',description:'',markers:[],hotspots:[]});
 graph.transitions.push({id:'t1',from:'c'.repeat(24),to:'d'.repeat(24),name:'Ajuda',action:{type:'click',elementIdentity:'x'},target:'app',profile:'default',confirmed:true,evidence:[],apis:[]});await service.runtime.store.saveRecorded(graph);
 const client=new Client({name:'test-client',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('scripts/agent-mcp.mjs'),root],env:{...process.env}}));t.after(()=>client.close());
 const read=result=>result.content.find(c=>c.type==='text').text,link=screenLink({screen:'b'.repeat(24),state:'d'.repeat(24)});
 assert.match(client.getInstructions(),/9\. A navloom:\/\/screen\/<id>.*navloom_screen.*navloom_merge.*as:"state"/);
 const shown=read(await client.callTool({name:'navloom_screen',arguments:{screen:link}}));assert.match(shown,/^Tela: Central de ajuda \(id bbbbbbbb\)/);assert.match(shown,/Estados \(id\): padrão dddddddd/);
 const merged=JSON.parse(read(await client.callTool({name:'navloom_merge',arguments:{into:screenLink({screen:'a'.repeat(24)}),from:[link],as:'state'}})));assert.deepEqual(merged.into,{id:'a'.repeat(24),name:'Minha conta'});assert.deepEqual(merged.becameStates,[{id:'d'.repeat(24),name:'Central de ajuda'}]);assert.equal(merged.pending,false);
 const after=await service.runtime.store.graph();assert.equal(after.screens.length,1);assert.equal(after.transitions[0].to,'d'.repeat(24));
 const old=read(await client.callTool({name:'navloom_screen',arguments:{screen:link}}));assert.match(old,/^Tela: Minha conta/,'the old link follows the merge');assert.match(old,/^Estado exibido: Central de ajuda \(/m,'and shows the state it names');
 assert.match(read(await client.callTool({name:'navloom_screen',arguments:{screen:screenLink({screen:'a'.repeat(24),state:'c'.repeat(24)})}})),/^Estado exibido: padrão \(/m);assert.equal(read(await client.callTool({name:'navloom_screen',arguments:{screen:'bbbbbbbb'}})).split('\n')[0],old.split('\n')[0],'the bare short id of the merged screen too');
 const gone=await client.callTool({name:'navloom_screen',arguments:{screen:'navloom://screen/ffffffffffffffffffffffff'}});assert.equal(gone.isError,true);assert.match(read(gone),/linked screen ffffffff no longer exists in the map/);
});
