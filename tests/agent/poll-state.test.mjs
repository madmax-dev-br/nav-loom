import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {takeStatus,usable,shrinks,sequencer,linkState,pollDelay,unknownProject,CONFIRM_EMPTY,SHOW_AFTER} from '../../lib/poll-state.mjs';
import {Projects} from '../../agent/projects.mjs';
import {Store} from '../../agent/store.mjs';
import {createService} from '../../agent/service.mjs';
const status=(over={})=>({config:{name:'Loja'},graph:{screens:[{id:'home'}],states:[],transitions:[]},runs:[],activeRun:null,service:{root:'/p'},...over});
const answer=data=>({data,text:JSON.stringify(data)});
const empty={text:'',doubt:0};
test('a poll answer that is not a complete status never replaces what is shown',()=>{
 const held={...takeStatus(empty,answer(status()))};assert.equal(held.verdict,'new');
 for(const bad of [undefined,null,'',[],{error:'Local agent service unavailable'},{config:{name:'Loja'}},{graph:{screens:[]},runs:[]},{...status(),runs:undefined},{...status(),graph:{screens:[{id:'home'}]}}]){
  assert.equal(usable(bad),false);const taken=takeStatus(held,{data:bad,text:JSON.stringify(bad)??''});assert.equal(taken.verdict,'invalid');assert.equal(taken.data,held.data,'the shown data is kept');}
 assert.equal(takeStatus(empty,undefined).verdict,'invalid');
});
test('an identical answer keeps the very same object, so nothing re-renders',()=>{
 const first=takeStatus(empty,answer(status())),again=takeStatus(first,answer(status()));
 assert.equal(again.verdict,'same');assert.equal(again.data,first.data);
 const changed=takeStatus(again,answer(status({activeRun:'run-1'})));assert.equal(changed.verdict,'new');assert.equal(changed.data.activeRun,'run-1');
});
test('"no project" and "empty map" replace a loaded project only when confirmed in a row, or right after the person acted',()=>{
 const loaded=takeStatus(empty,answer(status()));
 for(const less of [status({config:null,configurationError:'bad yaml'}),status({graph:{screens:[],states:[],transitions:[]}})]){
  assert.equal(shrinks(loaded.data,less),true);let held=loaded;
  for(let poll=1;poll<CONFIRM_EMPTY;poll++){held=takeStatus(held,answer(less));assert.equal(held.verdict,'held');assert.equal(held.data,loaded.data);assert.equal(held.doubt,poll);}
  const confirmed=takeStatus(held,answer(less));assert.equal(confirmed.verdict,'new');assert.deepEqual(confirmed.data,less);assert.equal(confirmed.doubt,0);
  assert.equal(takeStatus(loaded,answer(less),{trusted:true}).verdict,'new','saving, switching or retrying is believed at once');
 }
 // One good answer in between clears the doubt: a blip every other poll never empties the workspace.
 let held=loaded;const less=status({config:null});
 for(let round=0;round<6;round++){held=takeStatus(held,answer(less));assert.equal(held.verdict,'held');held=takeStatus(held,answer(status()));assert.equal(held.verdict,'same');assert.equal(held.doubt,0);}
 // Nothing loaded yet, another project, or a map that merely changed: taken as is.
 assert.equal(takeStatus(empty,answer(less)).verdict,'new');
 assert.equal(takeStatus(loaded,answer(status({config:null,service:{root:'/other'}}))).verdict,'new');
 assert.equal(takeStatus(loaded,answer(status({graph:{screens:[{id:'home'},{id:'cart'}],states:[],transitions:[]}}))).verdict,'new');
});
test('an older answer landing after a newer one is dropped',()=>{
 const polls=sequencer(),slow=polls.next(),fast=polls.next();
 assert.equal(polls.accept(fast),true);assert.equal(polls.current(slow),false);assert.equal(polls.accept(slow),false,'stale success is not applied');
 const later=polls.next();assert.equal(polls.current(later),true,'a failure is judged without consuming its turn');assert.equal(polls.accept(later),true);assert.equal(polls.accept(later),false);
});
test('the connection indicator ignores a single hiccup and never claims "offline" over data that is on screen',()=>{
 assert.equal(linkState(0,true),'online');assert.equal(linkState(0,false),'online');
 for(let n=1;n<SHOW_AFTER;n++)assert.equal(linkState(n,true),'online');
 assert.equal(linkState(SHOW_AFTER,true),'reconnecting');assert.equal(linkState(50,true),'reconnecting');assert.equal(linkState(1,false),'offline');
 assert.equal(pollDelay(0),5000);assert.ok(pollDelay(1)<5000);assert.ok(pollDelay(99)<=5000);
 assert.equal(unknownProject(Object.assign(Error('x'),{code:'unknown_project'})),true);assert.equal(unknownProject(Error('Local agent service unavailable')),false);assert.equal(unknownProject(undefined),false);
});
const config={version:2,kind:'navloom-agent-project',review:'auto',id:'shop',name:'Loja',targets:{web:{platform:'web',url:'http://localhost:4790',origins:['http://localhost:4790']}}};
test('only a project that is positively unknown is reported as such; one that fails to load is not',async t=>{
 const base=await mkdtemp(join(tmpdir(),'navloom-base-')),other=await mkdtemp(join(tmpdir(),'navloom-other-'));t.after(()=>Promise.all([base,other].map(dir=>rm(dir,{recursive:true,force:true}))));
 const store=new Store(other);await store.init();await store.saveConfig(config);const projects=new Projects(base),imported=await projects.import(other);
 for(const id of ['imp-000000000000','missing-folder','../escape'])await assert.rejects(projects.resolve(id),e=>e.code==='unknown_project',id);
 // The configuration being rewritten by an editor (or a share that dropped) is a failure to load, not a missing project.
 await writeFile(join(other,'navloom.yaml'),'version: 2\nkind: navloom-agent-pro');await assert.rejects(projects.resolve(imported.id),e=>e.code!=='unknown_project');
 await store.atomic(join(other,'navloom.yaml'),(await import('yaml')).stringify(config));assert.equal(await projects.resolve(imported.id),imported.root);
});
test('the files the interface reads on every poll are replaced whole, never rewritten in place',async t=>{
 const base=await mkdtemp(join(tmpdir(),'navloom-base-')),roots=await Promise.all(Array.from({length:12},()=>mkdtemp(join(tmpdir(),'navloom-many-'))));t.after(()=>Promise.all([base,...roots].map(dir=>rm(dir,{recursive:true,force:true}))));
 for(const root of roots){const store=new Store(root);await store.init();await store.saveConfig(config);}
 const projects=new Projects(base);await projects.import(roots[0]);
 // Readers running while the registry is rewritten always parse a complete list.
 let reading=true,reads=0;const reader=(async()=>{while(reading){const list=await projects.imported();assert.ok(Array.isArray(list)&&list.length>=1);reads++;}})();
 for(const root of roots.slice(1))await projects.import(root);reading=false;await reader;assert.ok(reads>0);
 assert.equal((await projects.imported()).length,roots.length);assert.deepEqual((await readdir(join(base,'.navloom'))).filter(name=>name.endsWith('.tmp')),[],'no temporary file is left behind');
 // The graph and a run, under the same kind of reader.
 const store=new Store(roots[0]);let watching=true,seen=0;const watcher=(async()=>{while(watching){const graph=await store.recorded();assert.ok(Array.isArray(graph.screens));seen++;}})();
 for(let n=1;n<=40;n++)await store.saveRecorded({...await store.recorded(),screens:Array.from({length:n*50},(_,i)=>({id:'screen-'+i,name:'Screen '+i}))});watching=false;await watcher;assert.ok(seen>0);assert.equal((await store.recorded()).screens.length,2000);
});
test('the service descriptor is written whole and removed on close',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-service-')),service=await createService({root,port:0});let closed=false;t.after(async()=>{if(!closed)await service.close();await rm(root,{recursive:true,force:true});});
 const descriptor=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));assert.equal(descriptor.port,service.port);assert.equal(descriptor.token,service.token);assert.equal(descriptor.pid,process.pid);
 assert.deepEqual((await readdir(join(root,'.navloom'))).filter(name=>name.endsWith('.tmp')),[]);
 // A project without configuration answers a complete status that says so: that, repeated, is what "no project" means.
 const answer=await (await fetch(`http://127.0.0.1:${service.port}/status`,{method:'POST',headers:{authorization:'Bearer '+service.token,'content-type':'application/json'},body:'{}'})).json();assert.equal(usable(answer),true);assert.equal(answer.config,null);assert.ok(answer.configurationError);
 await service.close();closed=true;await assert.rejects(readFile(join(root,'.navloom/runtime.json')),{code:'ENOENT'});
});
