import {mkdir,readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,uid,safePath} from './store.mjs';
import {configSchema} from './schema.mjs';

// The original project keeps its daemon; additional projects have isolated roots and daemons.
export class Projects {
 constructor(root){this.root=resolve(root);this.folder=join(this.root,'projects');this.starting=new Map();}
 async list(){const current=await new Store(this.root).config().catch(()=>null);const items=[{id:'default',name:current?.name??'Current project',root:this.root}];await mkdir(this.folder,{recursive:true});for(const entry of await readdir(this.folder,{withFileTypes:true})){if(!entry.isDirectory())continue;const root=join(this.folder,entry.name);const config=await new Store(root).config().catch(()=>null);if(config)items.push({id:entry.name,name:config.name,root});}return items;}
 async resolve(id='default'){if(id==='default')return this.root;if(!/^[a-zA-Z0-9][\w-]{0,100}$/.test(id))throw Error('Invalid project');const root=await safePath(this.folder,id);await new Store(root).config();return root;}
 async create(input){const config=configSchema.parse(input);await mkdir(this.folder,{recursive:true});const id=uid(),root=join(this.folder,id);await mkdir(root);const store=new Store(root);await store.init();await store.saveConfig(config);return {id,name:config.name,root};}
 async descriptor(id='default'){const root=await this.resolve(id);const read=async()=>{const descriptor=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));process.kill(descriptor.pid,0);return descriptor;};try{return await read();}catch(error){if(id==='default')throw error;}
 if(!this.starting.has(id)){const start=(async()=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/agent-service.mjs',import.meta.url)),root],{env:{...process.env,NAVLOOM_AGENT_PORT:'0'},detached:true,stdio:'ignore'});child.unref();let failure;child.on('error',error=>{failure=error;});for(let attempt=0;attempt<80;attempt++){if(failure)throw failure;await new Promise(r=>setTimeout(r,100));try{return await read();}catch{}}throw Error('Could not start project service. Check its .navloom/service.lock and local runtime.');})();this.starting.set(id,start);start.finally(()=>this.starting.delete(id)).catch(()=>{});}
 return this.starting.get(id);
 }
}
