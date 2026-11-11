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
const whole=buffer=>({buffer:buffer?.subarray(0,BODY_LIMIT)??Buffer.alloc(0),size:buffer?.length??0,truncated:(buffer?.length??0)>BODY_LIMIT});
/** The full exchange of one call as it is kept in evidence: sensitive headers, query values and body keys are masked. Bodies are `{buffer,size,truncated}` or a whole Buffer. */
export function exchange({method,url,host,startedAt,status,requestHeaders={},requestBody,responseHeaders={},responseBody}){
 const body=(value,headers)=>readBody(Buffer.isBuffer(value)||value==null?whole(value):value,headers);
 return {method,url:redactUrl(url),host,startedAt,status,requestHeaders:redactHeaders(requestHeaders),requestBody:body(requestBody,requestHeaders),responseHeaders:redactHeaders(responseHeaders),responseBody:body(responseBody,responseHeaders)};
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
   const done=()=>{if(call.status!==null)return;if(bodies)call.detail=exchange({method:call.method,url:req.url,host:target.host,startedAt,status:up.statusCode,requestHeaders:req.headers,requestBody:sent(),responseHeaders:up.headers,responseBody:received()});log.end(call,up.statusCode);if(call.detail)call.detail.ms=call.ms;};
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

/** Merge step calls into the distinct API list kept on a transition. `count` is how many times each endpoint was seen; late results of calls already counted pass `count:false`. */
export function mergeApis(existing=[],calls=[],{count=true}={}){
 const list=existing.map(a=>({...a,statuses:[...a.statuses]}));
 for(const call of calls){let item=list.find(a=>a.method===call.method&&a.host===call.host&&a.path===call.path);if(!item){item={method:call.method,host:call.host,path:call.path,statuses:[],count:0};list.push(item);}if(count)item.count=(item.count??0)+1;if(call.status!==null&&call.status!==undefined&&!item.statuses.includes(call.status))item.statuses.push(call.status);}
 return list.slice(0,40);
}

/** Generic request lines an app may write to its log: `GET https://host/path -> 200`, `HTTP 404 /path`, OkHttp pairs. */
const METHODS='GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
export function normalizeCall(call){
 let path=call.path,host=call.host??null;
 if(call.url){try{const u=new URL(call.url);path=u.pathname+(u.search?'?…':'');host=u.host;}catch{path=call.url;}}
 return {method:(call.method||'GET').toUpperCase(),url:call.url??null,host,path:path||'/',status:call.status??null,type:call.type??'http',time:call.time??null,durationMs:call.durationMs??null,requestPreview:call.requestPreview??null,responsePreview:call.responsePreview??null,contentType:call.contentType??null};
}
/** Parse HTTP activity from Android logcat lines (OkHttp logging, Log lines with "HTTP 200 /path", "GET https://..."). */
export function parseAndroidNetwork(lines){
 const calls=[],pending=[];
 for(const raw of lines){const line=String(raw);const message=line.replace(/^\s*[\d.]+\s+\d+\s+\d+\s+[VDIWEF]\s+[^:]*:\s*/,'');
  let m;
  if((m=message.match(new RegExp(`-->\\s+(${METHODS})\\s+(\\S+)`))))pending.push(normalizeCall({method:m[1],url:m[2],time:logTime(line),type:'okhttp'}));
  else if((m=message.match(/<--\s+(\d{3})\s+(?:[A-Za-z ]+\s+)?(https?:\/\/\S+)(?:\s+\((\d+)ms)?/))){const url=m[2];const index=pending.findIndex(p=>p.url===url);const call=index>=0?pending.splice(index,1)[0]:normalizeCall({method:'GET',url,type:'okhttp'});call.status=Number(m[1]);if(m[3])call.durationMs=Number(m[3]);calls.push(call);}
  else if((m=message.match(new RegExp(`\\b(${METHODS})\\s+(https?:\\/\\/\\S+|\\/[\\w./?=&%-]*)(?:\\s*(?:->|=>|:)?\\s*(\\d{3})\\b)?`))))calls.push(normalizeCall({method:m[1],url:m[2].startsWith('http')?m[2]:undefined,path:m[2].startsWith('http')?undefined:m[2],status:m[3]?Number(m[3]):null,time:logTime(line),type:'log'}));
  else if((m=message.match(/\bHTTP\s+(\d{3})\s+(https?:\/\/\S+|\/[\w./?=&%-]*)/)))calls.push(normalizeCall({method:'GET',url:m[2].startsWith('http')?m[2]:undefined,path:m[2].startsWith('http')?undefined:m[2],status:Number(m[1]),time:logTime(line),type:'log'}));
 }
 return [...calls,...pending];
}
function logTime(line){const m=line.match(/^\s*(\d+(?:\.\d+)?)\s/);return m?new Date(Number(m[1])*1000).toISOString():null;}
/** Group calls by method and path so a transition lists each endpoint once with the statuses observed. */
export function aggregateNetwork(calls){
 const map=new Map();
 for(const call of calls){const key=`${call.method} ${call.path}`;let entry=map.get(key);if(!entry){entry={method:call.method,path:call.path,host:call.host??null,statuses:[],count:0};map.set(key,entry);}entry.count++;if(call.status&&!entry.statuses.includes(call.status))entry.statuses.push(call.status);}
 return [...map.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
}
export function mergeNetwork(existing=[],incoming=[]){
 const merged=new Map(existing.map(e=>[`${e.method} ${e.path}`,{...e,statuses:[...e.statuses]}]));
 for(const call of incoming){const key=`${call.method} ${call.path}`;const entry=merged.get(key);if(entry){entry.count+=call.count;for(const s of call.statuses)if(!entry.statuses.includes(s))entry.statuses.push(s);}else merged.set(key,{...call,statuses:[...call.statuses]});}
 return [...merged.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
}
/** Endpoint index for the whole graph: which transitions and screens trigger each endpoint. */
export function endpointIndex(graph){
 const index=new Map();const screenOf=new Map(graph.states.map(s=>[s.id,s.screenId]));
 for(const edge of graph.transitions)for(const call of edge.apis??edge.network??[]){const key=`${call.method} ${call.path}`;let entry=index.get(key);if(!entry){entry={method:call.method,path:call.path,host:call.host??null,statuses:[],count:0,transitions:[],screens:[]};index.set(key,entry);}entry.count+=call.count??1;for(const s of call.statuses)if(!entry.statuses.includes(s))entry.statuses.push(s);entry.transitions.push(edge.id);const screen=screenOf.get(edge.from);if(screen&&!entry.screens.includes(screen))entry.screens.push(screen);}
 return [...index.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
}
