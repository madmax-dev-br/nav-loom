import {mkdir,readdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,uid,safePath} from './store.mjs';
import {configSchema} from './schema.mjs';

// The original project keeps its daemon; additional projects have isolated roots and daemons.
export class Projects {
 constructor(root){this.root=resolve(root);this.folder=join(this.root,'projects');this.registry=join(this.root,'.navloom','imported.json');this.starting=new Map();}
 /** Folders the person imported: a project lives wherever its navloom.yaml is, and is loaded by pointing at that folder. */
 async imported(){try{return JSON.parse(await readFile(this.registry,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 async import(path){if(typeof path!=='string'||!isAbsolute(path.trim()))throw Error('Informe o caminho absoluto da pasta do projeto');const root=await realpath(path.trim()).catch(()=>{throw Error('Pasta não encontrada');});if(!(await stat(root)).isDirectory())throw Error('O caminho não é uma pasta');
  const config=await new Store(root).config().catch(e=>{throw Error(e.code==='ENOENT'?'A pasta não tem um navloom.yaml':'O navloom.yaml desta pasta não é um projeto de agente válido: '+e.message);});
  if(root===this.root)return {id:'default',name:config.name,root};const id='imp-'+createHash('sha256').update(root).digest('hex').slice(0,12),list=(await this.imported()).filter(p=>p.id!==id);list.push({id,root});await mkdir(join(this.root,'.navloom'),{recursive:true});await writeFile(this.registry,JSON.stringify(list,null,2),{mode:0o600});return {id,name:config.name,root};}
 async list(){const current=await new Store(this.root).config().catch(()=>null);const items=[{id:'default',name:current?.name??'Current project',root:this.root}];await mkdir(this.folder,{recursive:true});for(const entry of await readdir(this.folder,{withFileTypes:true})){if(!entry.isDirectory())continue;const root=join(this.folder,entry.name);const config=await new Store(root).config().catch(()=>null);if(config)items.push({id:entry.name,name:config.name,root});}for(const entry of await this.imported()){const config=await new Store(entry.root).config().catch(()=>null);if(config)items.push({id:entry.id,name:config.name,root:entry.root,imported:true});}return items;}
 async resolve(id='default'){if(id==='default')return this.root;if(id.startsWith('imp-')){const entry=(await this.imported()).find(p=>p.id===id);if(!entry)throw Error('Projeto importado não encontrado');await new Store(entry.root).config();return entry.root;}if(!/^[a-zA-Z0-9][\w-]{0,100}$/.test(id))throw Error('Invalid project');const root=await safePath(this.folder,id);await new Store(root).config();return root;}
 async create(input){const config=configSchema.parse(input);await mkdir(this.folder,{recursive:true});const id=uid(),root=join(this.folder,id);await mkdir(root);const store=new Store(root);await store.init();await store.saveConfig(config);return {id,name:config.name,root};}
 async descriptor(id='default'){const root=await this.resolve(id);const read=async()=>{const descriptor=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));process.kill(descriptor.pid,0);return descriptor;};try{return await read();}catch(error){if(id==='default')throw error;}
 if(!this.starting.has(id)){const start=(async()=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/agent-service.mjs',import.meta.url)),root],{env:{...process.env,NAVLOOM_AGENT_PORT:'0'},detached:true,stdio:'ignore'});child.unref();let failure;child.on('error',error=>{failure=error;});for(let attempt=0;attempt<80;attempt++){if(failure)throw failure;await new Promise(r=>setTimeout(r,100));try{return await read();}catch{}}throw Error('Could not start project service. Check its .navloom/service.lock and local runtime.');})();this.starting.set(id,start);start.finally(()=>this.starting.delete(id)).catch(()=>{});}
 return this.starting.get(id);
 }
}
