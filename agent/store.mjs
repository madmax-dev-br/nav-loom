import {mkdir,readFile,writeFile,rename,readdir,realpath,stat,open} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parse,stringify} from 'yaml';
import {configSchema} from './schema.mjs';
export const now=()=>new Date().toISOString();
export const uid=()=>randomUUID();
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex').slice(0,24);
export async function safePath(root,path){const base=await realpath(root);const file=await realpath(resolve(base,path));const rel=relative(base,file);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Path is outside the configured root');return file;}
export class Store{
 constructor(root){this.root=resolve(root);this.dir=join(this.root,'.navloom');}
 async init(){for(const path of ['runs','evidence','revisions','plugins','skills'])await mkdir(join(this.dir,path),{recursive:true});}
 async config(){return configSchema.parse(parse(await readFile(join(this.root,'navloom.yaml'),'utf8')));}
 async saveConfig(value){const config=configSchema.parse(value);let old;try{old=await readFile(join(this.root,'navloom.yaml'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}if(old){const parsed=parse(old);if(parsed?.kind!=='navloom-agent-project')throw Error('Existing navloom.yaml is legacy. Import it and choose a separate agent-project folder; it will not be overwritten.');await this.immutable(`revisions/config-${uid()}.yaml`,old);}await this.atomic(join(this.root,'navloom.yaml'),stringify(config));return config;}
 async atomic(file,text){const temp=file+'.'+uid()+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,file);}
 async json(path,fallback){try{return JSON.parse(await readFile(join(this.dir,path),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
 async save(path,value){await this.atomic(join(this.dir,path),JSON.stringify(value,null,2));}
 async immutable(path,value){const handle=await open(join(this.dir,path),'wx',0o600);try{await handle.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));}finally{await handle.close();}}
 async graph(){return this.json('graph.json',{version:2,flows:[],screens:[],states:[],transitions:[],descriptions:[],legacy:[],extensions:{},presentation:{pinned:{},plugins:{}}});}
 async saveGraph(graph){await this.immutable(`revisions/graph-${uid()}.json`,graph);await this.save('graph.json',graph);}
 async runs(){return (await Promise.all((await readdir(join(this.dir,'runs'))).filter(n=>n.endsWith('.json')).map(n=>this.json('runs/'+n)))).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
 async run(id){if(!/^[\w-]+$/.test(id))throw Error('Invalid run id');const run=await this.json(`runs/${id}.json`);if(!run)throw Error('Run not found');return run;}
 async saveRun(run){await this.save(`runs/${run.id}.json`,run);}
 async resource(path){const file=await safePath(this.dir,path);const info=await stat(file);if(!info.isFile()||info.size>20*1024*1024)throw Error('Resource unavailable');return readFile(file);}
}
