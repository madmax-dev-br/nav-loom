import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,utimes,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createService} from '../../agent/service.mjs';
import {lockOwner} from '../../agent/lock.mjs';
import {Projects} from '../../agent/projects.mjs';

/**
 * `.navloom/service.lock` heals itself: a service that died without cleanup (SIGKILL, crash, power loss) leaves it behind, and
 * the next start takes it over instead of refusing until a person deletes it. A service that is really running still owns it.
 */
const script=resolve('scripts/agent-service.mjs'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function project(t){const root=await mkdtemp(join(tmpdir(),'navloom-lock-'));await mkdir(join(root,'.navloom'),{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));return {root,dir:join(root,'.navloom'),lock:join(root,'.navloom/service.lock'),runtime:join(root,'.navloom/runtime.json')};}
/** The pid of a process that has just ended: nobody answers to it. */
const deadPid=()=>new Promise((done,fail)=>{const child=spawn(process.execPath,['-e','']);child.on('error',fail);child.on('exit',()=>done(child.pid));});
/** A real service in its own process, as `npm run agent:serve` starts it. Resolves with its descriptor once it answers, or with its error output when it refuses to start. */
function serve(root){const child=spawn(process.execPath,[script,root],{env:{...process.env,NAVLOOM_AGENT_PORT:'0'},stdio:['ignore','pipe','pipe']});let out='',err='',code;child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});const exited=new Promise(r=>child.on('exit',c=>{code=c;r();}));
 const ready=(async()=>{for(let i=0;i<200&&code===undefined&&!out.includes('Navloom agent service');i++)await sleep(50);if(!out.includes('Navloom agent service')){await exited;return {child,refused:err||`exit ${code}`};}return {child,descriptor:JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'))};})();
 return {child,ready,exited,kill:async signal=>{if(code===undefined){child.kill(signal);await exited;}}};}
const healthy=async({port,token})=>(await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:'Bearer '+token}})).status===200;

test('a lock left by a dead service is taken over; a held one still refuses a second service',async t=>{const p=await project(t),gone=await deadPid();
 await writeFile(p.lock,JSON.stringify({pid:gone,started:Date.now()-5000,id:'dead'}));await writeFile(p.runtime,JSON.stringify({port:1,token:'old',pid:gone,root:p.root}));
 assert.equal((await lockOwner(p.dir)).alive,false);assert.equal(await lockOwner(join(p.dir,'nowhere')),null);
 const service=await createService({root:p.root,port:0});let closed=false;t.after(async()=>{if(!closed)await service.close();});
 const owner=JSON.parse(await readFile(p.lock,'utf8'));assert.equal(owner.pid,process.pid);assert.ok(Math.abs(owner.started-(Date.now()-process.uptime()*1000))<5000,'the lock carries when its owner started');assert.equal(typeof owner.id,'string');
 assert.equal(JSON.parse(await readFile(p.runtime,'utf8')).token,service.token,'the dead service\'s descriptor was replaced');assert.equal((await lockOwner(p.dir)).alive,true);
 await assert.rejects(createService({root:p.root,port:0}),new RegExp(`Agent service lock exists: a service is already running for this project \\(pid ${process.pid}\\)`));
 assert.equal(JSON.parse(await readFile(p.lock,'utf8')).id,owner.id,'the refused start left the lock alone');assert.ok(await healthy(service));
 await service.close();closed=true;assert.deepEqual((await readdir(p.dir)).filter(name=>/^(service\.lock|runtime\.json)/.test(name)),[],'closing leaves neither lock nor descriptor');
 // The bare pid older services wrote, of a process that is gone, is as stale.
 await writeFile(p.lock,String(gone));const again=await createService({root:p.root,port:0});await again.close();
});

test('a live pid alone does not hold the lock: it may be another process that got the dead service\'s pid',async t=>{const p=await project(t);
 const stranger=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>stranger.kill('SIGKILL'));const old=new Date(Date.now()-120000);
 const closedPort=await new Promise(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>done(port));});});
 await writeFile(p.lock,JSON.stringify({pid:stranger.pid,started:Date.now()-600000,id:'x'}));await writeFile(p.runtime,JSON.stringify({port:closedPort,token:'t',pid:stranger.pid,root:p.root}));
 assert.equal((await lockOwner(p.dir)).alive,true,'touched a moment ago: a service that is starting or beating');
 await utimes(p.lock,old,old);assert.equal((await lockOwner(p.dir)).alive,false,'no heartbeat and nobody answers on its port');
 assert.equal((await lockOwner(p.dir,{probe:async()=>true})).alive,true,'no heartbeat (the machine slept) but its service answers: alive');
 await writeFile(p.runtime,JSON.stringify({port:closedPort,token:'t',pid:stranger.pid+1,root:p.root}));assert.equal((await lockOwner(p.dir,{probe:async()=>true})).alive,false,'a descriptor of another pid proves nothing about this lock');
 // A service answering on that port with another token is not this lock's owner either.
 const other=await createService({root:(await project(t)).root,port:0});t.after(()=>other.close());await writeFile(p.runtime,JSON.stringify({port:other.port,token:'t'.repeat(64),pid:stranger.pid,root:p.root}));assert.equal((await lockOwner(p.dir)).alive,false);
 // The interface's bridge reads the same verdict: it does not hand out the descriptor of a dead service whose pid lives on.
 await writeFile(join(p.root,'navloom.yaml'),'version: 2\n');await assert.rejects(new Projects(p.root).descriptor('default'),/not running/);
 // A lock of this very process that this process does not hold (our pid was the dead service's) is stale too.
 await writeFile(p.lock,JSON.stringify({pid:process.pid,started:1,id:'y'}));assert.equal((await lockOwner(p.dir)).alive,false);
 // An empty lock is one being written right now, for a while; then it is a starter that died halfway.
 await writeFile(p.lock,'');assert.equal((await lockOwner(p.dir)).alive,true);await utimes(p.lock,old,old);assert.equal((await lockOwner(p.dir)).alive,false);
 const service=await createService({root:p.root,port:0});assert.ok(await healthy(service));assert.equal((await new Projects(p.root).descriptor('default')).token,service.token);await service.close();
});

test('a start that fails after taking the lock gives it back',async t=>{const p=await project(t),busy=createServer();await new Promise(r=>busy.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>busy.close(r)));
 await assert.rejects(createService({root:p.root,port:busy.address().port}),/EADDRINUSE/);assert.equal(await lockOwner(p.dir),null);const service=await createService({root:p.root,port:0});await service.close();
});

test('a real service killed with SIGKILL restarts by itself, and services racing for its lock leave exactly one',async t=>{const p=await project(t),started=[];t.after(()=>Promise.all(started.map(s=>s.kill('SIGKILL'))));
 const first=serve(p.root);started.push(first);const one=await first.ready;assert.ok(one.descriptor,one.refused);assert.ok(await healthy(one.descriptor));
 // While it lives, another start is refused and does not disturb it.
 const second=serve(p.root);started.push(second);const refused=await second.ready;assert.match(refused.refused??'',new RegExp(`already running for this project \\(pid ${first.child.pid}\\)`));assert.ok(await healthy(one.descriptor));
 await first.kill('SIGKILL');assert.equal(JSON.parse(await readFile(p.lock,'utf8')).pid,first.child.pid,'killed without cleanup: the lock stays behind');assert.equal((await lockOwner(p.dir)).alive,false);
 // Four services start at once over the stale lock: one takes it over, the others are refused.
 const racers=[1,2,3,4].map(()=>serve(p.root));started.push(...racers);const results=await Promise.all(racers.map(r=>r.ready)),up=results.filter(r=>r.descriptor);
 assert.equal(up.length,1,`exactly one service: ${results.map(r=>r.refused?.trim().split('\n').find(l=>/Error/.test(l))??'up').join(' | ')}`);for(const r of results.filter(r=>!r.descriptor))assert.match(r.refused,/Agent service lock/);
 assert.ok(await healthy(up[0].descriptor));assert.equal(JSON.parse(await readFile(p.lock,'utf8')).pid,up[0].child.pid);assert.equal(up[0].descriptor.pid,up[0].child.pid);
 assert.deepEqual((await readdir(p.dir)).filter(name=>name.includes('takeover')),[]);
 // Stopped properly, it cleans up after itself.
 up[0].child.kill('SIGTERM');await racers[results.indexOf(up[0])].exited;assert.equal(await lockOwner(p.dir),null);
});
