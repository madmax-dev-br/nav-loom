import {dependableEdges} from './graph.mjs';
import {writes,tabEdges} from './navigate.mjs';
import {envOf} from './schema.mjs';
/**
 * The ways into every known screen and flow, worked out from the confirmed transitions, so an agent asked to go
 * somewhere or test something already knows where it starts:
 * - `start`: from where the app opens in each environment, the shortest dependable walk (screens on the way, the
 *   actions, what it writes to the backend and which secrets are typed on the way). This is what `goto` follows.
 * - `deeplinks`: verified links that land on the screen (only links that always landed in one place).
 * - `tabs`: controls that open the screen from wherever they are on view (a tab bar, a home button).
 * - `from`: the screens with a direct way in.
 * Flows (named with `organize`) start where their first screen starts.
 */
/**
 * Dominators of a directed graph (Cooper, Harvey and Kennedy's iterative algorithm): `idom[n]` is the closest node every
 * path from `entry` to `n` passes through. On the screen graph it says which screens a flow cannot skip, e.g. the
 * receipt is only reached through the cart and the checkout, and gives the flows their shape without anyone naming them.
 */
export function dominators(entry,successors){
 const order=[],seen=new Set(),visit=n=>{seen.add(n);for(const m of successors.get(n)??[])if(!seen.has(m))visit(m);order.push(n);};visit(entry);order.reverse();
 const index=new Map(order.map((n,i)=>[n,i])),preds=new Map(order.map(n=>[n,[]]));for(const n of order)for(const m of successors.get(n)??[])if(index.has(m))preds.get(m).push(n);
 const idom=new Map([[entry,entry]]),meet=(a,b)=>{while(a!==b){while(index.get(a)>index.get(b))a=idom.get(a);while(index.get(b)>index.get(a))b=idom.get(b);}return a;};
 for(let changed=true;changed;){changed=false;for(const n of order.slice(1)){let best=null;for(const p of preds.get(n))if(idom.has(p))best=best===null?p:meet(p,best);if(best!==null&&idom.get(n)!==best){idom.set(n,best);changed=true;}}}
 return idom;
}
const label=edge=>edge.action.type==='scroll'?`rolar ${edge.action.direction??'down'}`:edge.action.type==='wait'?'(automático)':edge.name;
export function entryPoints(graph,{target,profile='default'}={}){
 const screenOf=new Map(graph.states.map(s=>[s.id,s.screenId])),name=id=>graph.screens.find(s=>s.id===id)?.name??'?';
 const targets=target?[target]:[...new Set(graph.screens.map(s=>s.target))];
 const out={entries:[],screens:{},flows:[]};
 for(const t of targets){
  // A cold start (goto) confirms where the app opens; until then, where missions most often found it when they began.
  const likely=key=>Object.entries(graph.starts?.[key]??{}).filter(([id])=>screenOf.has(id)).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const keys=[...new Set([...Object.keys(graph.entries??{}),...Object.keys(graph.starts??{})])].filter(k=>k===t||k.startsWith(t+'@'));
  for(const key of keys){const environment=key.includes('@')?key.split('@')[1]:'default',confirmed=screenOf.has(graph.entries?.[key]),entry=confirmed?graph.entries[key]:likely(key);if(!entry)continue;
   out.entries.push({target:t,environment,screenId:screenOf.get(entry),screen:name(screenOf.get(entry)),...(confirmed?{}:{assumed:true})});
   const {edges}=dependableEdges(graph,{target:t,profile,environment,otherEnvironments:true,allowUnverifiedVersion:true});
   const direct=edges.filter(e=>e.from!==e.to&&!['back','deeplink'].includes(e.action.type)),steps=[...direct,...tabEdges(graph,direct)];
   // Dijkstra from the entry state: an action that writes costs more, a way only seen in another environment a little more.
   const cost=e=>(e.action.type==='wait'?.2:1)+(writes(e)?2:0)+(envOf(e)===environment?0:.5),dist=new Map([[entry,0]]),prev=new Map(),done=new Set();
   for(;;){let at=null;for(const [s,d] of dist)if(!done.has(s)&&(at===null||d<dist.get(at)))at=s;if(at===null)break;done.add(at);for(const e of steps){if(e.from!==at)continue;const d=dist.get(at)+cost(e);if(d<(dist.get(e.to)??Infinity)){dist.set(e.to,d);prev.set(e.to,e);}}}
   const best=new Map();for(const [state,d] of dist){const screen=screenOf.get(state);if(screen&&(!best.has(screen)||d<best.get(screen).d))best.set(screen,{state,d});}
   // Screen-level dominators from the entry screen: what every way to a screen goes through.
   const successors=new Map();for(const e of steps){const a=screenOf.get(e.from),b=screenOf.get(e.to);if(!a||!b||a===b)continue;if(!successors.has(a))successors.set(a,new Set());successors.get(a).add(b);}
   const root=screenOf.get(entry),idom=dominators(root,successors),chain=screen=>{const out=[];for(let at=idom.get(screen),hops=0;at&&at!==screen&&hops<50;hops++){out.unshift(at);if(at===root)break;const up=idom.get(at);if(up===at)break;at=up;}return out;};
   // Screens every walk passes (the entry, the home after signing in) are said once, not on every screen.
   const reach=[...idom.keys()].filter(n=>n!==root),everywhere=new Set([root,...[...idom.keys()].filter(d=>d!==root&&reach.filter(n=>n!==d).every(n=>chain(n).includes(d)))]);
   out.tree??={};out.tree[environment]={root:name(root),parent:Object.fromEntries([...idom].filter(([n])=>n!==root).map(([n,p])=>[name(n),name(p)])),always:[...everywhere].map(name)};
   for(const [screen,{state}] of best){const path=[];for(let at=state,hops=0;prev.has(at)&&hops<100;hops++){const e=prev.get(at);path.unshift(e);at=e.from;}
    const via=[...new Set(path.map(e=>screenOf.get(e.from)))],onPath=new Set([...via,screen]);
    const secrets=[...new Set(graph.transitions.filter(e=>e.target===t&&e.action.type==='fill'&&e.action.secretRef&&onPath.has(screenOf.get(e.from))&&screen!==screenOf.get(e.from)).map(e=>e.action.secretRef))];
    const record=(out.screens[screen]??={name:name(screen),start:{},deeplinks:[],tabs:[],from:[]});
    const must=chain(screen).filter(n=>!everywhere.has(n)).map(name);if(must.length)record.mustPass=must;
    record.start[environment]={steps:path.filter(e=>e.action.type!=='wait').length,path:[...via.map(name),name(screen)],actions:path.filter(e=>e.action.type!=='wait').map(label),...(path.some(writes)?{writes:path.filter(writes).flatMap(e=>e.apis.filter(a=>!['GET','HEAD','OPTIONS'].includes(a.method)).map(a=>`${a.method} ${a.path}`))}:{}),...(secrets.length?{secrets}:{})};
   }
  }
  // Verified deeplinks that always landed on one screen, and controls that open a screen from anywhere.
  const landings=new Map();for(const d of graph.deeplinks??[]){if(d.target!==t)continue;const at=landings.get(d.url)??new Set();at.add(d.screenId);landings.set(d.url,at);}
  for(const e of graph.transitions)if(e.target===t&&e.action.type==='deeplink'&&e.confirmed){const at=landings.get(e.action.url)??new Set();at.add(screenOf.get(e.to));landings.set(e.action.url,at);}
  for(const [url,at] of landings)if(at.size===1){const screen=[...at][0];if(!screen)continue;const record=(out.screens[screen]??={name:name(screen),start:{},deeplinks:[],tabs:[],from:[]});if(!record.deeplinks.includes(url))record.deeplinks.push(url);}
  const controls=new Map();for(const e of graph.transitions){if(e.target!==t||!e.confirmed||e.action.type!=='click'||!e.action.elementIdentity||writes(e))continue;const from=screenOf.get(e.from),to=screenOf.get(e.to);if(!from||!to||from===to)continue;const entry=controls.get(e.action.elementIdentity)??{name:e.name,from:new Set(),to:new Set()};entry.from.add(from);entry.to.add(to);controls.set(e.action.elementIdentity,entry);
   const record=(out.screens[to]??={name:name(to),start:{},deeplinks:[],tabs:[],from:[]});if(!record.from.includes(name(from)))record.from.push(name(from));}
  for(const entry of controls.values())if(entry.from.size>=2&&entry.to.size===1){const record=out.screens[[...entry.to][0]];if(record&&!record.tabs.includes(entry.name))record.tabs.push(entry.name);}
  for(const edge of tabEdges(graph,graph.transitions.filter(e=>e.target===t&&e.confirmed))){const record=out.screens[screenOf.get(edge.to)];if(record&&!record.tabs.includes(edge.name))record.tabs.push(edge.name);}
 }
 for(const flow of graph.flows??[]){const first=flow.screenIds.find(id=>out.screens[id])??flow.screenIds[0];out.flows.push({id:flow.id,name:flow.name,startsAt:name(first),screens:flow.screenIds.map(name),entry:out.screens[first]??null});}
 return out;
}
/** One line per way in, for agents and for the map's README. Screens the app opens at are listed as where it opens. */
export function entryLines(points,{limit=80}={}){
 const many=new Set(points.entries.map(e=>e.environment)).size>1,lines=points.entries.map(e=>`abre em ${e.screen}${many||e.environment!=='default'?` (${e.environment})`:''}${e.assumed?' (provável: onde as missões começaram; o goto confirma a frio)':''}`);
 for(const [,s] of Object.entries(points.screens).slice(0,limit)){
  const ways=[];for(const [environment,start] of Object.entries(s.start)){if(!start.steps)continue;ways.push(`${start.steps} ${start.steps===1?'passo':'passos'} desde a abertura${many||environment!=='default'?` (${environment})`:''}: ${start.path.join(' → ')}${start.secrets?.length?` [segredo ${start.secrets.join(', ')}]`:''}${start.writes?.length?` [grava ${start.writes.join(', ')}]`:''}`);}
  if(s.mustPass?.length)ways.push(`passa sempre por ${s.mustPass.join(' → ')}`);
  if(s.deeplinks.length)ways.push(`deeplink ${s.deeplinks.join(', ')}`);if(s.tabs.length)ways.push(`de qualquer tela: ${s.tabs.map(x=>`"${x}"`).join(', ')}`);
  if(ways.length)lines.push(`${s.name} ← ${ways.join(' · ')}`);
 }
 for(const f of points.flows)lines.push(`fluxo ${f.name} começa em ${f.startsAt}`);
 return lines;
}
/** The dominator tree as an indented outline: under each screen, the screens that can only be reached through it. */
export function flowTree(points,environment='default'){
 const tree=points.tree?.[environment];if(!tree)return [];const children=new Map();for(const [child,parent] of Object.entries(tree.parent))children.set(parent,[...(children.get(parent)??[]),child]);
 const lines=[],walk=(node,depth)=>{lines.push(`${'  '.repeat(depth)}- ${node}`);for(const c of (children.get(node)??[]).sort())walk(c,depth+1);};walk(tree.root,0);return lines;
}
