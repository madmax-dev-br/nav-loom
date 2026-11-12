import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Projects} from '../../agent/projects.mjs';
import {Store} from '../../agent/store.mjs';
const config={version:2,kind:'navloom-agent-project',review:'auto',id:'original',name:'Original',targets:{web:{platform:'web',url:'http://localhost:4790',origins:['http://localhost:4790']}}};
test('projects retain separate configuration, graph and history; reject outside paths',async()=>{const root=await mkdtemp(join(tmpdir(),'navloom-projects-'));try{const original=new Store(root);await original.init();await original.saveConfig(config);await original.saveGraph({...await original.graph(),screens:[{id:'original-screen'}]});const projects=new Projects(root);const created=await projects.create({...config,id:'new',name:'Second'});assert.equal((await projects.list()).length,2);assert.equal(await projects.resolve('default'),root);const other=new Store(await projects.resolve(created.id));assert.equal((await other.config()).name,'Second');assert.deepEqual((await other.graph()).screens,[]);assert.deepEqual(await other.runs(),[]);assert.equal((await original.graph()).screens[0].id,'original-screen');await assert.rejects(()=>projects.resolve('../escape'));await assert.rejects(()=>projects.create({...config,targets:{}}));assert.equal((await projects.list()).length,2);assert.ok(await readFile(join(created.root,'navloom.yaml'),'utf8'));}finally{await rm(root,{recursive:true,force:true});}});

test('a project is imported by pointing at its folder; invalid folders are refused',async t=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {Projects}=await import('../../agent/projects.mjs');const {Store}=await import('../../agent/store.mjs');
 const base=await mkdtemp(join(tmpdir(),'navloom-base-')),other=await mkdtemp(join(tmpdir(),'navloom-other-')),empty=await mkdtemp(join(tmpdir(),'navloom-empty-'));t.after(()=>Promise.all([base,other,empty].map(dir=>rm(dir,{recursive:true,force:true}))));
 const store=new Store(other);await store.init();await store.saveConfig({version:2,kind:'navloom-agent-project',review:'auto',id:'shop',name:'Loja',targets:{android:{platform:'android',serial:'emulator-5554',package:'com.example.shop'}}});
 const projects=new Projects(base),imported=await projects.import(other);assert.match(imported.id,/^imp-[0-9a-f]{12}$/);assert.equal(imported.name,'Loja');
 assert.equal((await projects.import(other)).id,imported.id,'importing twice keeps one entry');assert.equal((await projects.imported()).length,1);
 assert.equal(await projects.resolve(imported.id),imported.root);assert.ok((await projects.list()).some(p=>p.id===imported.id&&p.imported));
 await assert.rejects(projects.import(empty),/navloom\.yaml/);await assert.rejects(projects.import('relative/path'),/absoluto/);await assert.rejects(projects.import(join(empty,'missing')),/não encontrada/);await assert.rejects(projects.resolve('imp-000000000000'),/não encontrado/);
 await writeFile(join(empty,'navloom.yaml'),'version: 1\nname: legacy\n');await assert.rejects(projects.import(empty),/não é um projeto de agente válido/);
});
