import {readFile,readdir,stat,realpath} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {safePath} from './store.mjs';
/**
 * Read-only access to explicitly configured repositories so screens and API calls can be linked to the code that
 * renders or serves them. Links are inferred by text search and stay "inferred" until confirmed.
 */
const SKIP_DIRS=new Set(['.git','node_modules','build','dist','.gradle','.navloom','.next','.vinext','out','coverage','.idea','target','vendor','.wrangler','Pods','DerivedData']);
const SKIP_FILE=/(^|[/\\])\.(env|git)([/\\.]|$)|\.(pem|key|jks|keystore|p12|png|jpg|jpeg|gif|webp|ico|svg|pdf|zip|gz|tar|jar|apk|aab|class|so|dll|exe|bin|woff2?|ttf|otf|mp4|mp3|lock)$/i;
const MAX_FILE=500000,MAX_FILES=6000;
export async function repositoryRoot(store,config,repositoryId){const repo=config.repositories.find(r=>r.id===repositoryId);if(!repo)throw Error('Repository is not configured');return {repo,root:await realpath(resolve(store.root,repo.path))};}
export async function walk(root,{maxFiles=MAX_FILES}={}){const files=[];const visit=async dir=>{if(files.length>=maxFiles)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}entries.sort((a,b)=>a.name.localeCompare(b.name));for(const entry of entries){if(files.length>=maxFiles)return;if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);if(entry.isDirectory()){if(!SKIP_DIRS.has(entry.name))await visit(path);}else if(entry.isFile()&&!SKIP_FILE.test(entry.name))files.push(relative(root,path).split(sep).join('/'));}};await visit(root);return files;}
export async function tree(root,{path='.',depth=2}={}){const base=await safePath(root,path);const out=[];const visit=async(dir,level)=>{let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));for(const entry of entries){if(entry.isSymbolicLink()||SKIP_DIRS.has(entry.name)||(entry.isFile()&&SKIP_FILE.test(entry.name)))continue;const full=join(dir,entry.name);out.push({path:relative(root,full).split(sep).join('/'),type:entry.isDirectory()?'dir':'file'});if(entry.isDirectory()&&level<depth)await visit(full,level+1);if(out.length>2000)return;}};await visit(base,1);return out;}
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export async function searchSource(root,{query,regex=false,glob,maxResults=60,caseSensitive=false}){
 if(!query||query.length<2)throw Error('Query too short');const pattern=new RegExp(regex?query:escapeRegex(query),caseSensitive?'':'i');const filter=glob?globToRegex(glob):null;const files=await walk(root);const hits=[];let scanned=0;
 for(const path of files){if(filter&&!filter.test(path))continue;const file=join(root,path);let info;try{info=await stat(file);}catch{continue;}if(info.size>MAX_FILE)continue;const text=await readFile(file,'utf8').catch(()=>null);if(text===null||text.includes('\0'))continue;scanned++;const lines=text.split('\n');for(let i=0;i<lines.length;i++){if(pattern.test(lines[i])){hits.push({path,line:i+1,text:lines[i].trim().slice(0,200)});if(hits.length>=maxResults)return {hits,scanned,truncated:true};}}}
 return {hits,scanned,truncated:false};
}
function globToRegex(glob){return new RegExp('^'+glob.split('**').map(part=>part.split('*').map(escapeRegex).join('[^/]*')).join('.*')+'$');}
/** Frontend or backend by conventional paths; shared when nothing is conclusive. */
export function guessRole(path){const p=path.toLowerCase();if(/(^|\/)(server|api|backend|routes?|controllers?|handlers?|resolvers|services|workers?|functions|lambda)(\/|$)|\.(py|go|rb|php|cs|rs)$|server\.(m?js|ts)$|route\.ts$/.test(p)&&!/(^|\/)(app\/src|android|ios|components)\//.test(p))return 'backend';if(/\.(kt|swift|tsx|jsx|vue|svelte|dart|xml|html|css)$|(^|\/)(app\/src|android|ios|components|pages|screens|views|ui|composables|widgets)\//.test(p))return 'frontend';return 'shared';}
const identifierOf=identity=>{const head=String(identity).split('|')[0];const id=head.includes('/')?head.slice(head.lastIndexOf('/')+1):head;return /^[A-Za-z_][\w-]{2,}$/.test(id)&&!/^(android|body|div|button|a|span|input)$/i.test(id)?id:null;};
/** Terms that identify a screen in code: explicit markers, resource ids, route, heading and visible labels. */
export function screenTerms(graph,screen){const states=graph.states.filter(s=>s.screenId===screen.id);const terms=new Map();const add=(term,weight,why)=>{if(!term||term.length<3)return;const key=term.trim();if(!key||key.length>80)return;const current=terms.get(key);if(!current||current.weight<weight)terms.set(key,{term:key,weight,why});};
 for(const state of states)for(const hotspot of state.hotspots??[]){const resource=hotspot.resourceId?identifierOf(hotspot.resourceId):null;if(resource)add(resource,4,'resource id');const id=identifierOf(hotspot.identity);if(id&&!/^body > /.test(id))add(id,resource?2:4,'id');if(hotspot.name&&/^[\p{L}\p{N} ,.'!?%$€-]{4,60}$/u.test(hotspot.name))add(hotspot.name,1,'label');}
 try{const url=new URL(screen.route);if(url.pathname&&url.pathname!=='/')add(url.pathname,3,'route');}catch{if(screen.route?.includes('/')){const activity=screen.route.split('/').pop();if(activity)add(activity.replace(/^\./,''),3,'activity');}}
 if(screen.name&&/^[\p{L}\p{N} ,.'!?-]{4,60}$/u.test(screen.name))add(screen.name,2,'name');
 if(screen.screenKey)add(screen.screenKey,5,'marker');for(const state of states)if(state.stateKey)add(state.stateKey,2,'state marker');
 return [...terms.values()].sort((a,b)=>b.weight-a.weight).slice(0,14);}
/** Candidate files for a screen (frontend) and for the endpoints it triggers (backend), with the matching lines. */
export async function suggestLinks(store,config,graph,{screenId,maxPerRole=6}){
 const screen=graph.screens.find(s=>s.id===screenId);if(!screen)throw Error('Screen not found');const terms=screenTerms(graph,screen);
 const stateIds=new Set(graph.states.filter(s=>s.screenId===screenId).map(s=>s.id));const endpoints=[...new Set(graph.transitions.filter(t=>stateIds.has(t.from)).flatMap(t=>(t.apis??t.network??[]).map(n=>`${n.method} ${n.path}`)))];
 const result={screen:{id:screenId,terms,candidates:[]},endpoints:{}};
 for(const repo of config.repositories){let root;try{root=(await repositoryRoot(store,config,repo.id)).root;}catch{continue;}
  const files=new Map();for(const {term,weight,why} of terms){const {hits}=await searchSource(root,{query:term,maxResults:40}).catch(()=>({hits:[]}));for(const hit of hits){const key=hit.path;const file=files.get(key)??{repository:repo.id,path:key,role:guessRole(key),score:0,matches:[],status:'inferred'};file.score+=weight;if(file.matches.length<6)file.matches.push({line:hit.line,text:hit.text,term,why});files.set(key,file);}}
  result.screen.candidates.push(...files.values());
  for(const endpoint of endpoints){const path=endpoint.split(' ')[1].replace(/\?…$/,'');const segments=path.split('/').filter(Boolean);const queries=[path,...(segments.length>1?[('/'+segments.slice(-2).join('/'))]:[]),...(segments.length?[segments.at(-1)]:[])].filter(q=>q.length>=3);const seen=new Map();for(const [index,query] of queries.entries()){const {hits}=await searchSource(root,{query,maxResults:40}).catch(()=>({hits:[]}));for(const hit of hits){const file=seen.get(hit.path)??{repository:repo.id,path:hit.path,role:guessRole(hit.path),score:0,matches:[],status:'inferred'};file.score+=3-index;if(file.matches.length<4)file.matches.push({line:hit.line,text:hit.text,term:query});seen.set(hit.path,file);}}
   result.endpoints[endpoint]??={backend:[],frontend:[]};for(const file of seen.values())(file.role==='backend'?result.endpoints[endpoint].backend:result.endpoints[endpoint].frontend).push(file);}
 }
 const rank=list=>list.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
 result.screen.candidates=rank(result.screen.candidates).filter(c=>c.role!=='backend').slice(0,maxPerRole);
 for(const endpoint of Object.values(result.endpoints)){endpoint.backend=rank(endpoint.backend).slice(0,maxPerRole);endpoint.frontend=rank(endpoint.frontend).slice(0,maxPerRole);}
 return result;
}
