import {randomBytes} from 'node:crypto';
import {unlink,open,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
/**
 * One service per project: `.navloom/service.lock`, created exclusively, holds `{pid,started,id}` of its owner. A service that
 * dies without cleanup (SIGKILL, crash, power loss) leaves the lock behind, so the lock alone proves nothing: its owner is alive
 * when its pid still runs AND, against a pid reused by another process, the lock was touched lately (the owner touches it every
 * BEAT) or the service of `runtime.json` (same pid) answers `/health` with its token (a machine that slept stops the heartbeat,
 * not the service). A lock of this very process counts only while this process holds it. Anything else is a dead owner.
 */
const BEAT=10000,FRESH=30000,held=new Set();
const pidAlive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
const health=async({port,token})=>{try{const response=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});return response.ok&&(await response.json()).ok===true;}catch{return false;}};
/** Who holds the lock of a `.navloom` folder: null without a lock, else `{pid,started,alive,text}`. */
export async function lockOwner(dir,{probe=health}={}){const lockPath=join(dir,'service.lock');let text,info;try{text=await readFile(lockPath,'utf8');info=await stat(lockPath);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 // Older services wrote the bare pid. An empty or half-written lock is one being created right now, for as long as it is fresh.
 let owner={};try{const parsed=JSON.parse(text);owner=typeof parsed==='number'?{pid:parsed}:parsed&&typeof parsed==='object'?parsed:{};}catch{}
 const fresh=Date.now()-info.mtimeMs<FRESH,alive=async()=>{if(owner.pid===undefined)return fresh;if(owner.pid===process.pid)return held.has(lockPath);if(!pidAlive(owner.pid))return false;if(fresh)return true;
  let descriptor;try{descriptor=JSON.parse(await readFile(join(dir,'runtime.json'),'utf8'));}catch{return false;}return descriptor.pid===owner.pid&&await probe(descriptor);};
 return {pid:owner.pid,started:owner.started,text,alive:await alive()};}
/**
 * Take the lock, taking it over from a dead owner. Two services starting at once: the exclusive create decides; removing a stale
 * lock happens only under a second exclusive file (`service.lock.takeover`) and after judging it again there, so nobody removes
 * the lock another starter has just created. The dead owner's `runtime.json` goes with it: nobody should call a closed port.
 */
export async function acquireLock(dir){const lockPath=join(dir,'service.lock'),gate=lockPath+'.takeover',body=JSON.stringify({pid:process.pid,started:Math.round(Date.now()-process.uptime()*1000),id:randomBytes(8).toString('hex')});
 for(let attempt=0;attempt<60;attempt++){
  let handle;try{handle=await open(lockPath,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;}
  if(handle){held.add(lockPath);await handle.writeFile(body);return {beat:()=>handle.utimes(new Date(),new Date()).catch(()=>{}),release:async()=>{held.delete(lockPath);await handle.close().catch(()=>{});/* Only our own lock: one taken over from us (we hung past every check) is not ours to remove. */if(await readFile(lockPath,'utf8').catch(()=>null)===body)await unlink(lockPath).catch(()=>{});}};}
  const owner=await lockOwner(dir);if(!owner)continue;if(owner.alive)throw Error(`Agent service lock exists: a service is already running for this project${owner.pid?` (pid ${owner.pid})`:''}. Stop it before starting another.`);
  let turn;try{turn=await open(gate,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;/* Held for milliseconds: an old one is from a starter that died inside it. */if(Date.now()-await stat(gate).then(i=>i.mtimeMs,()=>Date.now())>BEAT)await unlink(gate).catch(()=>{});await new Promise(r=>setTimeout(r,40+Math.random()*60));continue;}
  try{const again=await lockOwner(dir);if(again&&!again.alive&&again.text===owner.text){await unlink(lockPath).catch(()=>{});await unlink(join(dir,'runtime.json')).catch(()=>{});}}finally{await turn.close();await unlink(gate).catch(()=>{});}
 }
 throw Error('Agent service lock is being taken by another starting service. Try again.');
}
