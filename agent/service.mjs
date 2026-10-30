import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {writeFile,unlink,open} from 'node:fs/promises';
import {join} from 'node:path';
import {Runtime} from './runtime.mjs';
import {Plugins} from './plugins.mjs';
import {operations} from './operations.mjs';
export async function createService({root,port=4788}){
 const runtime=new Runtime(root),plugins=new Plugins(runtime),ops=operations(runtime,plugins),token=randomBytes(32).toString('hex'),leases=new Map();
 await runtime.store.init();
 const lockPath=join(runtime.store.dir,'service.lock');let lock;try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}catch{throw Error('Agent service lock exists. Stop the other service or remove a stale .navloom/service.lock after checking its process.');}
 await runtime.init();
 const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');const fail=(status,message)=>{res.statusCode=status;res.end(JSON.stringify({error:message}));};try{
 const host=req.headers.host?.split(':')[0];if(!['127.0.0.1','localhost'].includes(host))return fail(403,'Loopback host required');if(req.headers.origin)return fail(403,'Use the authenticated local UI bridge');const supplied=req.headers.authorization?.replace(/^Bearer /,'')??'';if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return fail(401,'Local service token required');
 const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/health'){res.end(JSON.stringify({ok:true,version:2}));return;}
 if(req.method==='GET'&&url.pathname==='/resource'){const path=url.searchParams.get('path')??'';if(!/^evidence\/[\w-]+\.(png|json)$/.test(path))return fail(400,'Invalid evidence path');const data=await runtime.store.resource(path);res.setHeader('Content-Type',path.endsWith('.png')?'image/png':'application/json');res.end(data);return;}
 if(req.method!=='POST')return fail(405,'POST required');let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)return fail(413,'Request too large');}const parsed=JSON.parse(body||'{}'),owner=req.headers['x-navloom-client']||'interface';if(owner!=='interface')leases.set(owner,Date.now());
 if(url.pathname==='/pause'&&parsed.runId===runtime.active)runtime.interruptRequested=true;
 if(url.pathname==='/heartbeat'){res.end('{}');return;}if(url.pathname==='/disconnect'){await runtime.exclusive(()=>runtime.disconnect(owner));leases.delete(owner);res.end('{}');return;}
 const name=url.pathname.slice(1),op=ops[name];if(!op)return fail(404,'Operation not found');const args=op.schema.parse(parsed);const result=await runtime.exclusive(()=>op.call(args,owner));res.end(JSON.stringify(result));
 }catch(e){fail(400,e.message);}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});const address=server.address();await writeFile(join(runtime.store.dir,'runtime.json'),JSON.stringify({port:address.port,token,pid:process.pid,root:runtime.store.root}),{mode:0o600});
 const timer=setInterval(()=>{for(const [owner,last] of leases)if(Date.now()-last>45000){leases.delete(owner);runtime.exclusive(()=>runtime.disconnect(owner)).catch(()=>{});}},10000);timer.unref();
 return {runtime,port:address.port,token,close:async()=>{clearInterval(timer);await runtime.exclusive(()=>runtime.close());await new Promise(resolve=>server.close(resolve));await lock.close();await unlink(lockPath).catch(()=>{});await unlink(join(runtime.store.dir,'runtime.json')).catch(()=>{});}};
}
