import {hash,now,uid} from './store.mjs';
import {mergeApis} from './network.mjs';
const humanize=key=>key?String(key).replace(/[-_]+/g,' ').replace(/^./,c=>c.toUpperCase()):'';
export function identity(observation,target){
 const screenKey=observation.screenKey||[observation.route,observation.heading];
 const structural=observation.elements.map(e=>e.identity).sort();
 return {screenId:hash([target,screenKey]),stateId:observation.scrollOfState??hash([target,screenKey,observation.stateKey||[observation.heading,structural,observation.stateMarkers]])};
}
export function recordObservation(graph,observation,run){
 const keys=identity(observation,run.target);Object.assign(observation,keys);
 let screen=graph.screens.find(s=>s.id===keys.screenId);
 if(!screen){screen={id:keys.screenId,target:run.target,name:humanize(observation.screenKey)||observation.heading||observation.title||observation.route,description:'',route:observation.route,identity:observation.screenKey?'explicit':'structural',sources:[],createdAt:now()};graph.screens.push(screen);}
 let state=graph.states.find(s=>s.id===keys.stateId);if(!state){state={id:keys.stateId,screenId:screen.id,name:observation.stateKey||observation.heading||'Observed state',firstSeen:observation.id,lastSeen:observation.id};graph.states.push(state);}state.lastSeen=observation.id;
 for(const element of observation.elements){if(!element.actions?.length||element.disabled)continue;const key=hash([observation.stateId,element.identity]);if(!run.frontier.some(f=>f.key===key))run.frontier.push({key,stateId:observation.stateId,elementIdentity:element.identity,label:element.label||element.name,actions:element.actions,status:'pending',observationId:observation.id,elementId:element.id});}
 return keys;
}
export function confirmTransition(graph,before,after,action,step,run,calls=[]){
 const element=before.elements.find(e=>e.id===action.elementId);
 const replay={...action};delete replay.observationId;delete replay.elementId;if(replay.secretRef)delete replay.value;
 if(element)replay.elementIdentity=element.identity;
 const signature=hash([before.stateId,after.stateId,replay,run.target,run.profile,run.preconditions,run.version?.fingerprint]);let edge=graph.transitions.find(e=>e.signature===signature);
 if(!edge){edge={id:uid(),signature,from:before.stateId,to:after.stateId,target:run.target,profile:run.profile,preconditions:run.preconditions,kind:action.type==='scroll'?'scroll':before.screenId===after.screenId?'state':'navigation',name:element?.label||element?.name||(action.type==='deeplink'?action.url:action.type),action:replay,confirmed:true,evidence:[],version:run.version,cost:1};graph.transitions.push(edge);}edge.evidence.push({runId:run.id,stepId:step.id,before:before.id,after:after.id,...(step.status==='diverged'?{diverged:true}:{})});if(edge.evidence.length>50)edge.evidence.splice(0,edge.evidence.length-50);
 if(calls.length)edge.apis=mergeApis(edge.apis,calls);
 // A deeplink that was opened and observed becomes a known entry of the screen it landed on.
 if(action.type==='deeplink'&&action.url){const screen=graph.screens.find(s=>s.id===after.screenId);if(screen){screen.deeplinks??=[];if(!screen.deeplinks.some(d=>d.url===action.url))screen.deeplinks.push({url:action.url,state:after.stateId,stepId:step.id});}}

 const candidate=run.frontier.find(f=>f.stateId===before.stateId&&f.elementIdentity===element?.identity);if(candidate)candidate.status='visited';return edge;
}
/**
 * `to` is one state or a set of acceptable states. Routes only use transitions whose outcome is dependable:
 * - when the same action from the same state has led to different places, only its best-evidenced outcome is used;
 * - `back` depends on the back stack, so it is only used to undo the step that precedes it in the route;
 * - a deeplink may start from anywhere (navigation only), unless it has been seen landing in more than one place.
 */
export function planRoute(graph,{from,to,target,profile,preconditions={},version,allowUnverifiedVersion=false,allowDeeplinks=false}){
 const goals=to instanceof Set?to:new Set([to]),wanted=hash(preconditions);
 const usable=graph.transitions.filter(e=>e.confirmed&&e.target===target&&e.profile===profile&&hash(e.preconditions)===wanted&&!e.action.point&&(allowUnverifiedVersion||e.version?.fingerprint===version?.fingerprint));
 const weight=e=>(e.evidence??[]).filter(x=>!x.diverged).length,outcomes=new Map(),landings=new Map();
 for(const edge of usable){const key=edge.from+JSON.stringify(edge.action),best=outcomes.get(key);if(!best||weight(edge)>=weight(best))outcomes.set(key,edge);if(edge.action.type==='deeplink')landings.set(edge.action.url,(landings.get(edge.action.url)??new Set()).add(edge.to));}
 const edges=usable.filter(e=>outcomes.get(e.from+JSON.stringify(e.action))===e||e.to===outcomes.get(e.from+JSON.stringify(e.action)).to);
 const queue=[{state:from,previous:null,path:[],cost:0}],best=new Map();
 while(queue.length){queue.sort((a,b)=>a.cost-b.cost);const current=queue.shift();if(goals.has(current.state))return {found:true,steps:current.path,cost:current.cost,to:current.state};if((best.get(current.state)??Infinity)<=current.cost)continue;best.set(current.state,current.cost);
 for(const edge of edges){const shortcut=allowDeeplinks&&edge.action.type==='deeplink'&&landings.get(edge.action.url).size===1;if(edge.from!==current.state&&!shortcut)continue;
  if(edge.action.type==='back'&&current.previous!==edge.to)continue;
  queue.push({state:edge.to,previous:current.state,path:[...current.path,edge.id],cost:current.cost+edge.cost+(edge.version?.fingerprint===version?.fingerprint?0:.5)});}}
 return {found:false,steps:[],reason:'No confirmed compatible route. Explore only the missing section or explicitly revalidate an older route.'};
}
/** Accept the short ids and names agents receive in compact responses. */
export function resolveScreen(graph,ref,target){const value=String(ref??'').trim();if(!value)throw Error('Screen reference required');const pool=graph.screens.filter(s=>!target||s.target===target);const exact=pool.find(s=>s.id===value);if(exact)return exact;let matches=value.length>=6?pool.filter(s=>s.id.startsWith(value)):[];if(!matches.length)matches=pool.filter(s=>s.name?.toLowerCase()===value.toLowerCase());if(matches.length===1)return matches[0];throw Error(matches.length?`Screen reference "${value}" is ambiguous; use its id`:`Unknown screen "${value}"`);}
export function compareRuns(a,b){const old=new Set(a.observations.map(o=>o.stateId)),next=new Set(b.observations.map(o=>o.stateId));return {baseline:a.id,current:b.id,added:[...next].filter(x=>!old.has(x)),revisited:[...next].filter(x=>old.has(x)),notRevisited:[...old].filter(x=>!next.has(x)),removed:[],reviewRequired:true};}
