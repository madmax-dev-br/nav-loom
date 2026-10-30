import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Projects} from '../../agent/projects.mjs';
import {Store} from '../../agent/store.mjs';
const config={version:2,kind:'navloom-agent-project',id:'original',name:'Original',targets:{web:{platform:'web',url:'http://localhost:4790',origins:['http://localhost:4790']}}};
test('projects retain separate configuration, graph and history; reject outside paths',async()=>{const root=await mkdtemp(join(tmpdir(),'navloom-projects-'));try{const original=new Store(root);await original.init();await original.saveConfig(config);await original.saveGraph({...await original.graph(),screens:[{id:'original-screen'}]});const projects=new Projects(root);const created=await projects.create({...config,id:'new',name:'Second'});assert.equal((await projects.list()).length,2);assert.equal(await projects.resolve('default'),root);const other=new Store(await projects.resolve(created.id));assert.equal((await other.config()).name,'Second');assert.deepEqual((await other.graph()).screens,[]);assert.deepEqual(await other.runs(),[]);assert.equal((await original.graph()).screens[0].id,'original-screen');await assert.rejects(()=>projects.resolve('../escape'));await assert.rejects(()=>projects.create({...config,targets:{}}));assert.equal((await projects.list()).length,2);assert.ok(await readFile(join(created.root,'navloom.yaml'),'utf8'));}finally{await rm(root,{recursive:true,force:true});}});
