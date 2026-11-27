import {now,uid} from './store.mjs';
import {mergeProfiles,jaccard,controlsOfHotspots} from './recognize.mjs';
import {edgeSignature} from './graph.mjs';
/**
 * Fold screens or states the map recorded twice into one. Everything that pointed at the folded one (states, transitions,
 * entries, flows, deeplinks, remembered help, goto results, plugin fields) points at the one kept, and the folded id is
 * kept as an alias so a capture that still produces it lands on the kept one. Each merge is logged in `graph.merges`, which
 * is how an approved mission brings the same merge into the recorded map.
 */
const unique=list=>[...new Set(list)];
const tagged=(into,from)=>{for(const key of ['profiles','environments'])if(from[key]?.length)into[key]=unique([...(into[key]??[]),...from[key]]);};
export function mergeStates(graph,intoId,fromIds,{log=true}={}){
 const into=graph.states.find(s=>s.id===intoId);if(!into)throw Error(`Unknown state ${intoId}`);
 const folded=[];
 for(const id of unique(fromIds)){const state=graph.states.find(s=>s.id===id);if(!state||id===intoId)continue;
  for(const edge of graph.transitions){if(edge.from===id)edge.from=intoId;if(edge.to===id)edge.to=intoId;}
  for(const key of Object.keys(graph.entries??{}))if(graph.entries[key]===id)graph.entries[key]=intoId;
  for(const d of graph.deeplinks??[])if(d.stateId===id)d.stateId=intoId;
  for(const s of graph.screens)for(const d of s.deeplinks??[])if(d.state===id)d.state=intoId;
  for(const h of graph.harness??[])if(h.stateId===id)h.stateId=intoId;
  for(const s of graph.states)if(s.scrollOf===id)s.scrollOf=intoId;
  for(const d of graph.descriptions??[])if(d.kind==='state'&&d.targetId===id)d.targetId=intoId;
  if(!into.description&&state.description)into.description=state.description;if(!into.hotspots?.length&&state.hotspots?.length)into.hotspots=state.hotspots;if(!into.digest&&state.digest)into.digest=state.digest;if(!into.thumbnail&&state.thumbnail)into.thumbnail=state.thumbnail;
  tagged(into,state);graph.stateAliases={...(graph.stateAliases??{}),[id]:intoId};graph.states=graph.states.filter(s=>s.id!==id);folded.push(id);}
 if(folded.length)dedupeTransitions(graph);
 if(log&&folded.length)(graph.merges??=[]).push({id:uid(),kind:'state',into:intoId,from:folded,at:now()});
 return folded;
}
/** Transitions that became the same one after a merge are joined: evidence, API calls and walk counts add up. */
export function dedupeTransitions(graph){
 const kept=new Map(),out=[],renamed={};
 for(const edge of graph.transitions){edge.signature=edgeSignature(edge);const first=kept.get(edge.signature);
  if(!first){kept.set(edge.signature,edge);out.push(edge);continue;}
  first.evidence=[...(first.evidence??[]),...(edge.evidence??[])].slice(-50);
  for(const api of edge.apis??[]){const item=(first.apis??=[]).find(a=>a.method===api.method&&a.host===api.host&&a.path===api.path);if(item){item.statuses=unique([...(item.statuses??[]),...(api.statuses??[])]);item.count=(item.count??0)+(api.count??0);}else first.apis.push({...api,statuses:[...(api.statuses??[])]});}
  for(const key of ['walks','misses'])if(edge[key])first[key]=(first[key]??0)+edge[key];
  if(!first.description&&edge.description)first.description=edge.description;renamed[edge.id]=first.id;}
 graph.transitions=out;
 for(const d of graph.descriptions??[])if(d.kind==='transition'&&renamed[d.targetId])d.targetId=renamed[d.targetId];
 return renamed;
}
/**
 * `asState`: the folded screen was never a screen of its own, it is a state of `into` (a dialog, a step, a variant that was
 * recorded apart). Its states keep their ids, evidence and transitions, take its name and are never joined to another state.
 */
export function mergeScreens(graph,intoId,fromIds,{log=true,asState=false}={}){
 const into=graph.screens.find(s=>s.id===intoId);if(!into)throw Error(`Unknown screen ${intoId}`);
 const folded=[];
 for(const id of unique(fromIds)){const screen=graph.screens.find(s=>s.id===id);if(!screen||id===intoId)continue;
  if(screen.target!==into.target)throw Error(`${screen.name} and ${into.name} belong to different targets`);
  if(asState){const taken=new Set(graph.states.filter(s=>s.screenId===intoId).map(s=>s.name));for(const state of graph.states.filter(s=>s.screenId===id)){const base=state.name==='padrão'||!state.name?screen.name:`${screen.name} · ${state.name.replace(/^padrão · /,'')}`;let name=base;for(let k=2;taken.has(name);k++)name=`${base} ${k}`;taken.add(name);state.name=name;state.distinct=true;if(!state.description&&screen.description)state.description=screen.description;}}
  for(const state of graph.states)if(state.screenId===id)state.screenId=intoId;
  for(const flow of graph.flows??[])flow.screenIds=unique(flow.screenIds.map(x=>x===id?intoId:x));
  for(const d of graph.deeplinks??[])if(d.screenId===id)d.screenId=intoId;
  for(const h of graph.harness??[])if(h.screenId===id)h.screenId=intoId;
  for(const d of graph.descriptions??[])if(d.kind==='screen'&&d.screenId===id)d.screenId=intoId;
  if(graph.routes?.[id]){const a=graph.routes[intoId],b=graph.routes[id];graph.routes[intoId]=a?{...b,...a,runs:(a.runs??0)+(b.runs??0),arrived:(a.arrived??0)+(b.arrived??0),bestSteps:Math.min(a.bestSteps??Infinity,b.bestSteps??Infinity)}:b;if(graph.routes[intoId].bestSteps===Infinity)delete graph.routes[intoId].bestSteps;delete graph.routes[id];}
  for(const fields of Object.values(graph.extensions??{}))if(fields?.[id]){fields[intoId]={...fields[id],...(fields[intoId]??{})};delete fields[id];}
  into.deeplinks=[...(into.deeplinks??[]),...(screen.deeplinks??[]).filter(d=>!(into.deeplinks??[]).some(x=>x.url===d.url))];if(!into.deeplinks.length)delete into.deeplinks;
  into.sources=[...(into.sources??[]),...(screen.sources??[]).filter(l=>!(into.sources??[]).some(x=>x.repository===l.repository&&x.path===l.path&&(x.line??null)===(l.line??null)))];
  into.links=unique([...(into.links??[]),...(screen.links??[])]).slice(0,100);
  into.profile=mergeProfiles(into.profile,screen.profile);if(!into.description&&screen.description)into.description=screen.description;if(!into.activity&&screen.activity)into.activity=screen.activity;if(!into.fragment&&screen.fragment)into.fragment=screen.fragment;
  into.similar=(into.similar??[]).filter(c=>c.screenId!==id);if(!into.similar.length)delete into.similar;
  tagged(into,screen);graph.aliases={...(graph.aliases??{}),[id]:intoId};graph.screens=graph.screens.filter(s=>s.id!==id);
  for(const s of graph.screens)if(s.similar)s.similar=s.similar.filter(c=>c.screenId!==id);
  folded.push({id,name:screen.name});}
 // The states the two had in common become one: same keyboard, same moment, about the same controls.
 const states=asState?[]:graph.states.filter(s=>s.screenId===intoId&&!s.scrollOf&&!s.stateKey&&!s.distinct),controls=s=>s.controls?new Set(s.controls):controlsOfHotspots(s.hotspots);
 for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){const a=states[i],b=states[j];if(!a||!b||!graph.states.includes(a)||!graph.states.includes(b))continue;if(!!a.keyboard!==!!b.keyboard||JSON.stringify(a.semantic??[])!==JSON.stringify(b.semantic??[]))continue;if(jaccard(controls(a),controls(b))>=.6){mergeStates(graph,a.id,[b.id],{log:false});states[j]=null;}}
 if(log&&folded.length)(graph.merges??=[]).push({id:uid(),kind:'screen',into:intoId,from:folded.map(f=>f.id),names:folded.map(f=>f.name),...(asState?{as:'state'}:{}),at:now()});
 return folded;
}
/** Bring merges logged in a draft (and not in its base) into another copy of the map. */
export function replayMerges(graph,merges=[],{skipKnown=true}={}){for(const m of merges){if(skipKnown&&graph.merges?.some(x=>x.id===m.id))continue;try{if(m.kind==='screen'&&graph.screens.some(s=>s.id===m.into))mergeScreens(graph,m.into,m.from,{log:false,asState:m.as==='state'});else if(m.kind==='state'&&graph.states.some(s=>s.id===m.into))mergeStates(graph,m.into,m.from,{log:false});}catch{}graph.merges??=[];if(!graph.merges.some(x=>x.id===m.id))graph.merges.push(m);}return graph;}
