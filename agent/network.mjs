import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';

/** Path template without query strings: volatile identifiers become {id}, so repeated calls group together. */
export function normalizePath(path){
 const clean=String(path||'/').split(/[?#]/)[0]||'/';
 return clean.split('/').map(part=>/^\d+$/.test(part)||/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part)||/^[0-9a-f]{16,}$/i.test(part)||/[-_]\d{2,}$/.test(part)?'{id}':part).join('/');
}

/** Calls observed while the application runs. Only method, host, path template, status and duration are kept. */
export class CallLog{
 constructor(){this.calls=[];this.cursor=0;this.sequence=0;this.pending=new Set();}
 begin({method,url,host,path,source}){
  if(url){try{const parsed=new URL(url);host=parsed.host;path=parsed.pathname;}catch{path=url;}}
  const call={id:`c${++this.sequence}`,method:String(method||'GET').toUpperCase(),host:host||'',path:normalizePath(path),status:null,ms:null,source,t0:Date.now()};
  this.calls.push(call);if(this.calls.length>2000){this.calls.shift();this.cursor=Math.max(0,this.cursor-1);}return call;
 }
 end(call,status,ms){if(!call||call.status!==null)return;call.status=status;call.ms=ms??Date.now()-call.t0;}
 /** A completed call reported at once (logs), matched to an open request when one exists. */
 complete({method,url,status,ms,source}){
  let host='',path=url;try{const parsed=new URL(url);host=parsed.host;path=parsed.pathname;}catch{}path=normalizePath(path);
  const open=this.calls.findLast(c=>c.status===null&&c.source===source&&c.host===host&&c.path===path&&(!method||c.method===method));
  // The same response seen through another source (proxy and log line) is one call, not two.
  const twin=open?null:this.calls.findLast(c=>c.source!==source&&c.path===path&&c.status===status&&Date.now()-c.t0<8000&&(!host||!c.host||c.host===host)&&(!method||c.method===method));if(twin)return twin;
  const call=open??this.begin({method:method||'?',host,path,source});this.end(call,status,ms??null);return call;
 }
 /** New calls since the previous drain, plus results of calls that were still in flight then. */
 drain(){
  const view=c=>({id:c.id,method:c.method,host:c.host,path:c.path,status:c.status,ms:c.ms,...(c.detail&&c.status!==null?{detail:c.detail}:{})});
  const late=[...this.pending].filter(c=>c.status!==null);for(const call of late)this.pending.delete(call);
  const fresh=this.calls.slice(this.cursor);this.cursor=this.calls.length;for(const call of fresh)if(call.status===null)this.pending.add(call);
  return {calls:fresh.map(view),late:late.map(view)};
 }
}

const BODY_LIMIT=262144,SENSITIVE=/pass(word|wd)?|senha|secret|token|authorization|api[-_]?key|cookie|cvv|card.?number|credential/i;
/** Values that identify or authenticate someone never reach the evidence files: sensitive keys and headers are masked. */
export function redactValue(value,depth=0){
 if(depth>12)return '[…]';if(Array.isArray(value))return value.slice(0,500).map(item=>redactValue(item,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,SENSITIVE.test(key)?'[REDACTED]':redactValue(item,depth+1)]));
 return value;
}
const redactHeaders=headers=>Object.fromEntries(Object.entries(headers??{}).map(([key,value])=>[key,SENSITIVE.test(key)?'[REDACTED]':value]));
const redactUrl=url=>{const [path,query]=String(url).split('?');if(!query)return path;return path+'?'+query.split('&').map(pair=>{const [key,...rest]=pair.split('=');return SENSITIVE.test(decodeURIComponent(key))?`${key}=[REDACTED]`:[key,...rest].join('=');}).join('&');};
function collect(stream){const chunks=[];let size=0;stream.on('data',chunk=>{if(size<BODY_LIMIT)chunks.push(chunk);size+=chunk.length;});return ()=>({buffer:Buffer.concat(chunks),size,truncated:size>BODY_LIMIT});}
/** A recorded body as something readable: parsed JSON when it is JSON, text when it is text, a note otherwise. */
export function readBody({buffer,size,truncated},headers={}){
 if(!size)return null;const type=String(headers['content-type']??''),encoding=String(headers['content-encoding']??'');let raw=buffer;
 try{if(/gzip/.test(encoding))raw=gunzipSync(buffer);else if(/deflate/.test(encoding))raw=inflateSync(buffer);else if(/br/.test(encoding))raw=brotliDecompressSync(buffer);}catch{return {note:`Corpo compactado com ${size} bytes; grande demais para ler por inteiro.`,size};}
 if(type&&!/json|text|xml|x-www-form-urlencoded|javascript/.test(type))return {note:`Conteúdo ${type}, ${size} bytes.`,size};
 const text=raw.toString('utf8');if(!truncated&&(/json/.test(type)||/^\s*[[{]/.test(text))){try{return {json:redactValue(JSON.parse(text)),size};}catch{}}
 return {text:text.slice(0,BODY_LIMIT),size,...(truncated?{truncated:true}:{})};
}
/** Loopback recording proxy placed in front of a development backend the device reaches through `adb reverse`. */
export async function recordingProxy(upstream,log,{bodies=true}={}){
 const target=new URL(upstream),send=target.protocol==='https:'?httpsRequest:httpRequest;
 const server=createServer((req,res)=>{
  const call=log.begin({method:req.method,host:target.host,path:req.url,source:'proxy'});
  const sent=bodies?collect(req):null,startedAt=new Date().toISOString();
  const out=send({protocol:target.protocol,hostname:target.hostname,port:target.port||(target.protocol==='https:'?443:80),path:req.url,method:req.method,headers:{...req.headers,host:target.host}},up=>{
   const received=bodies?collect(up):null;res.writeHead(up.statusCode??502,up.headers);up.pipe(res);
   // The call is complete when its body is: that is when the full exchange can be kept beside it.
   const done=()=>{if(call.status!==null)return;if(bodies)call.detail={method:call.method,url:redactUrl(req.url),host:target.host,startedAt,status:up.statusCode,requestHeaders:redactHeaders(req.headers),requestBody:readBody(sent(),req.headers),responseHeaders:redactHeaders(up.headers),responseBody:readBody(received(),up.headers)};log.end(call,up.statusCode);if(call.detail)call.detail.ms=call.ms;};
   up.on('end',done);up.on('close',done);});
  out.on('error',()=>{log.end(call,0);if(!res.headersSent)res.statusCode=502;res.end();});req.pipe(out);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {port:server.address().port,upstream:target,close:()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(()=>resolve());})};
}

/** OkHttp HttpLoggingInterceptor lines: `--> POST https://host/path` and `<-- 200 OK https://host/path (35ms)`. */
export function parseHttpLog(line){
 let m=line.match(/-->\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)/);if(m)return {phase:'request',method:m[1],url:m[2]};
 m=line.match(/<--\s+(\d{3})\s+(?:[A-Za-z][\w ]*?\s+)?(https?:\/\/\S+)\s+\((\d+)ms/);if(m)return {phase:'response',status:Number(m[1]),url:m[2],ms:Number(m[3])};
 return null;
}

/** Merge step calls into the distinct API list kept on a transition. */
export function mergeApis(existing=[],calls=[]){
 const list=existing.map(a=>({...a,statuses:[...a.statuses]}));
 for(const call of calls){let item=list.find(a=>a.method===call.method&&a.host===call.host&&a.path===call.path);if(!item){item={method:call.method,host:call.host,path:call.path,statuses:[]};list.push(item);}if(call.status!==null&&call.status!==undefined&&!item.statuses.includes(call.status))item.statuses.push(call.status);}
 return list.slice(0,40);
}
