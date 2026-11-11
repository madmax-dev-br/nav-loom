import vm from 'node:vm';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {now,uid} from './store.mjs';

const key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/);
const label=z.string().min(1).max(80);
/** What a learned script may decide. Each kind is a pure function `run(input)` returning JSON. */
export const KINDS={
 logcat:{title:'Requests em linhas de log',purpose:'Reconhece chamadas de API em linhas do logcat do app.',input:'{line} — one logcat line of the application process',output:'null, or {url, method?, status?, ms?}. With status the call is recorded as completed, without it as started.',schema:z.object({url:z.string().min(1).max(2000),method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']).optional(),status:z.number().int().min(0).max(599).optional(),ms:z.number().min(0).max(600000).optional()}).strict().nullable()},
 screen:{title:'Identidade de tela',purpose:'Dá o mesmo identificador à mesma tela, mesmo quando o texto muda.',input:'{platform, route, heading, texts[], ids[]} — texts and resource ids visible on the screen',output:'null, or {screen, state?, name?}. Only used when the app does not declare its own screen id.',schema:z.object({screen:key,state:key.optional(),name:label.optional()}).strict().nullable()},
 path:{title:'Modelo de caminho de API',purpose:'Agrupa chamadas iguais trocando partes variáveis do caminho.',input:'{method, host, path}',output:'null, or the path template, e.g. "/api/products/{id}"',schema:z.string().regex(/^\/[^\s?#]{0,300}$/).nullable()},
};
export const scriptSchema=z.object({id:key,kind:z.enum(['logcat','screen','path']),name:label,description:z.string().max(600).default(''),code:z.string().min(10).max(8000),samples:z.array(z.object({input:z.record(z.unknown()),expect:z.unknown()}).strict()).min(1).max(20)}).strict();
const clip=(value,max)=>{const text=typeof value==='string'?value:JSON.stringify(value);return text.length>max?text.slice(0,max-1)+'…':text;};

/**
 * Scripts the agent learned for this project. Nothing an agent writes runs before a person approves it in the interface.
 * Approved code runs in a separate V8 context that only ever exchanges JSON text: no require, no host objects, no eval.
 * That keeps honest scripts deterministic and contained; it is not a boundary against deliberately hostile code,
 * which is why approval shows the code and its sample results first.
 */
export class Harness{
 constructor(store){this.dir=join(store.dir,'harness');this.scripts=[];this.activity=[];this.compiled=new Map();this.dirty=false;}
 async load(){await mkdir(this.dir,{recursive:true});try{const data=JSON.parse(await readFile(join(this.dir,'index.json'),'utf8'));this.scripts=data.scripts??[];this.activity=data.activity??[];}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 async save(){const file=join(this.dir,'index.json'),temp=file+'.'+uid()+'.tmp';await writeFile(temp,JSON.stringify({version:1,scripts:this.scripts,activity:this.activity.slice(-200)},null,2),{mode:0o600});await rename(temp,file);this.dirty=false;}
 async flush(){if(this.dirty)await this.save();}
 list(){return this.scripts;}
 compile(script){
  const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
  new vm.Script(`${script.code}\n;globalThis.__run=function(text){const out=run(JSON.parse(text));return out===undefined?'null':JSON.stringify(out);};`,{filename:`harness/${script.id}.js`}).runInContext(context,{timeout:200});
  const call=new vm.Script('__run(__input)');
  return input=>{context.__input=JSON.stringify(input);const text=call.runInContext(context,{timeout:25});if(typeof text!=='string')throw Error('Script must return JSON data');return KINDS[script.kind].schema.parse(JSON.parse(text));};
 }
 runner(script){const cacheKey=script.id+':'+script.revision;if(!this.compiled.has(cacheKey))this.compiled.set(cacheKey,this.compile(script));return this.compiled.get(cacheKey);}
 /** A proposal replaces the previous revision and waits for review; it never activates itself. */
 async propose(input,author){
  const data=scriptSchema.parse(input),old=this.scripts.find(s=>s.id===data.id);
  if(old&&old.kind!==data.kind)throw Error('A script keeps its kind; propose a new id instead');
  const script={...data,status:'proposed',author,revision:(old?.revision??0)+1,proposedAt:now(),results:null,stats:{runs:0,matches:0,errors:0,lastMatchAt:null}};
  this.scripts=[...this.scripts.filter(s=>s.id!==data.id),script];
  await writeFile(join(this.dir,`${script.id}.js`),`// ${script.name} · ${script.kind} · revision ${script.revision}\n// ${script.description.replace(/\n/g,' ')}\n${script.code}\n`,{mode:0o600});
  this.log(script,'proposed',null,`Revisão ${script.revision} aguardando aprovação`);await this.save();return script;
 }
 check(script){
  return script.samples.map(sample=>{try{const got=this.runner(script)(sample.input);return {ok:isDeepStrictEqual(got,sample.expect??null),got};}catch(e){return {ok:false,error:clip(e.message,200)};}});
 }
 async review(id,decision){
  const script=this.scripts.find(s=>s.id===id);if(!script)throw Error('Script not found');
  if(decision==='approve'){script.results=this.check(script);const passed=script.results.every(r=>r.ok);script.status=passed?'active':'failed';script.reviewedAt=now();this.log(script,passed?'approved':'failed',null,passed?`${script.results.length} exemplos conferem`:'Exemplos não conferem; o script não foi ativado');}
  else if(decision==='disable'){script.status='disabled';this.log(script,'disabled',null,'Desativado');}
  else if(decision==='reject'){script.status='rejected';script.reviewedAt=now();this.log(script,'rejected',null,'Rejeitado');}
  else throw Error('Unknown decision');
  await this.save();return script;
 }
 log(script,event,input,output){this.activity.push({time:now(),scriptId:script.id,kind:script.kind,event,...(input===null?{}:{input:clip(input,220)}),output:clip(output,220)});if(this.activity.length>300)this.activity.splice(0,this.activity.length-200);this.dirty=true;}
 /** First active script of the kind that recognises the input wins. A script that keeps failing is switched off. */
 apply(kind,input){
  for(const script of this.scripts){
   if(script.kind!==kind||script.status!=='active')continue;
   script.stats.runs++;
   try{const value=this.runner(script)(input);script.failures=0;if(value===null)continue;script.stats.matches++;script.stats.lastMatchAt=now();this.log(script,'match',kind==='logcat'?input.line:input,value);return {value,scriptId:script.id};}
   catch(e){script.stats.errors++;script.failures=(script.failures??0)+1;if(script.failures>=20){script.status='failed';this.log(script,'failed',input,'Desativado após erros repetidos: '+e.message);}this.dirty=true;}
  }
  return null;
 }
}
