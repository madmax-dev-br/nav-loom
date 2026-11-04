/** API call records are evidence of what the application requested, never proof of server behaviour. */
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
 for(const edge of graph.transitions)for(const call of edge.network??[]){const key=`${call.method} ${call.path}`;let entry=index.get(key);if(!entry){entry={method:call.method,path:call.path,host:call.host??null,statuses:[],count:0,transitions:[],screens:[]};index.set(key,entry);}entry.count+=call.count;for(const s of call.statuses)if(!entry.statuses.includes(s))entry.statuses.push(s);entry.transitions.push(edge.id);const screen=screenOf.get(edge.from);if(screen&&!entry.screens.includes(screen))entry.screens.push(screen);}
 return [...index.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
}
