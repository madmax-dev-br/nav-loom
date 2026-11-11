import {hash,now,uid} from './store.mjs';
import {mergeApis} from './network.mjs';
const humanize=key=>key?String(key).replace(/[-_]+/g,' ').replace(/^./,c=>c.toUpperCase()):'';
/** `ProductDetailFragment` → `Product detail`. */
const fromFragment=name=>name?name.replace(/Fragment$/,'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^(.)(.*)$/,(_,a,b)=>a.toUpperCase()+b.toLowerCase()):'';
/** What is on view right now: the visible controls and, where the platform reports it, the scroll offset. */
export const viewSignature=observation=>hash([(observation.elements??[]).filter(e=>e.visible!==false).map(e=>e.identity),observation.scroll?.x??null,typeof observation.scroll?.y==='number'?observation.scroll.y:null]);
export function identity(observation,target){
 // Without an id declared by the app, a fragment is the most stable name a screen has; the header text comes next.
 const screenKey=observation.screenKey||(observation.fragment?['fragment',observation.fragment]:[observation.route,observation.heading]);
 const structural=observation.elements.map(e=>e.identity).sort();
 const parts=[target,screenKey,observation.stateKey||[observation.heading,structural,observation.stateMarkers]];
 // The same screen with the keyboard up is a state of its own, so its capture never replaces the clean one.
 if(observation.keyboard)parts.push('keyboard');
 return {screenId:hash([target,screenKey]),stateId:observation.stateOverride??hash(parts)};
}
/**
 * A scrolled view is a state of its own, reached from the unscrolled one. Called right after a scroll:
 * nothing moved → same state; back at the top → the base state; anything else → the scrolled state for that view.
 * A plain observation made while still scrolled keeps the scrolled state.
 */
export function placeScroll(graph,observation,target,scrolledFrom,previous){
 const natural=identity(observation,target).stateId,view=viewSignature(observation);observation.naturalState=natural;
 if(!scrolledFrom){if(previous?.scrollBase&&previous.naturalState===natural&&viewSignature(previous)===view){observation.stateOverride=previous.stateId;observation.scrollBase=previous.scrollBase;observation.stateName=previous.stateName;}return;}
 const base=scrolledFrom.scrollBase??scrolledFrom.stateId,root=graph.states.find(s=>s.id===base);
 if(view===viewSignature(scrolledFrom)){observation.stateOverride=scrolledFrom.stateId;observation.scrollBase=scrolledFrom.scrollBase;observation.stateName=scrolledFrom.stateName;return;}
 if(root?.viewSig===view){observation.stateOverride=base;return;}
 observation.stateOverride=hash([base,'scroll',view]);observation.scrollBase=base;observation.stateName=`${root?.name??'estado'} · rolado`;
}
const HOTSPOT_LIMIT=80;
/** Compact interactive candidates kept on the state so the map renders without local evidence files. */
export function hotspots(observation){return observation.elements.filter(e=>e.actions?.length&&!e.disabled&&e.visible!==false&&e.bounds).slice(0,HOTSPOT_LIMIT).map(e=>({id:e.id,identity:e.identity,name:e.name,actions:e.actions,bounds:e.bounds,sensitive:!!e.sensitive,...(e.resourceId?{resourceId:e.resourceId}:{})}));}
export function recordObservation(graph,observation,run){
 const keys=identity(observation,run.target);Object.assign(observation,keys);
 let screen=graph.screens.find(s=>s.id===keys.screenId);
 if(!screen){screen={id:keys.screenId,target:run.target,name:observation.screenName||fromFragment(observation.fragment)||observation.header||humanize(observation.screenKey)||observation.heading||observation.title||observation.route,description:'',route:observation.route,identity:observation.screenKey?'explicit':observation.fragment?'fragment':'structural',screenKey:observation.screenKey??null,sources:[],links:[],createdAt:now()};graph.screens.push(screen);}
 if(observation.links?.length){screen.links=[...new Set([...(screen.links??[]),...observation.links])].slice(0,100);}
 // What the app itself calls this screen; kept current so details and agent context can show it.
 if(observation.fragment&&screen.fragment!==observation.fragment)screen.fragment=observation.fragment;if(observation.header&&screen.header!==observation.header)screen.header=observation.header;
 let state=graph.states.find(s=>s.id===keys.stateId);if(!state){const plain=observation.stateKey||observation.heading||'Observed state';state={id:keys.stateId,screenId:screen.id,name:observation.stateName||(observation.keyboard?`${plain} · teclado`:plain),stateKey:observation.stateKey??null,description:'',firstSeen:observation.id,lastSeen:observation.id,markers:(observation.stateMarkers??[]).map(m=>Array.isArray(m)?m[0]:m).filter(Boolean),...(observation.scrollBase?{scrollOf:observation.scrollBase}:{}),...(observation.keyboard?{keyboard:true}:{})};graph.states.push(state);}state.lastSeen=observation.id;if(!observation.scrollBase&&!state.viewSig)state.viewSig=viewSignature(observation);
 if(!state.hotspots?.length)state.hotspots=hotspots(observation);
 for(const element of observation.elements){if(!element.actions?.length||element.disabled)continue;const key=hash([observation.stateId,element.identity]);if(!run.frontier.some(f=>f.key===key))run.frontier.push({key,stateId:observation.stateId,elementIdentity:element.identity,label:element.name,...(element.label&&element.label!==element.name?{hint:element.label}:{}),actions:element.actions,status:'pending',observationId:observation.id,elementId:element.id,sensitive:!!element.sensitive,bounds:element.bounds});}
 return keys;
}
/** `effects` is what the action was seen to cause: API calls, outcome, structural diff, pixel change and a summary. */
export function confirmTransition(graph,before,after,action,step,run,effects={}){
 const calls=effects.calls??[];
 const element=before.elements.find(e=>e.id===action.elementId);
 const replay={...action};delete replay.observationId;delete replay.elementId;if(replay.secretRef)delete replay.value;
 if(element)replay.elementIdentity=element.identity;
 const signature=hash([before.stateId,after.stateId,replay,run.target,run.profile,run.preconditions,run.version?.fingerprint]);let edge=graph.transitions.find(e=>e.signature===signature);
 if(!edge){edge={id:uid(),signature,from:before.stateId,to:after.stateId,target:run.target,profile:run.profile,preconditions:run.preconditions,kind:action.type==='scroll'?'scroll':before.screenId===after.screenId?'state':'navigation',outcome:effects.outcome??null,name:element?.label||element?.name||(action.type==='deeplink'?action.url:action.type==='wait'?'Evento automático':action.type==='back'?'Voltar':action.type),action:replay,confirmed:true,evidence:[],version:run.version,cost:1,description:'',summary:effects.summary??'',diff:effects.diff??null,imageChange:effects.imageChange??null,apis:[]};graph.transitions.push(edge);}edge.evidence.push({runId:run.id,stepId:step.id,before:before.id,after:after.id,...(step.status==='diverged'?{diverged:true}:{})});if(edge.evidence.length>50)edge.evidence.splice(0,edge.evidence.length-50);
 if(calls.length)edge.apis=mergeApis(edge.apis,calls);
 if(!edge.summary&&effects.summary)edge.summary=effects.summary;if(!edge.diff&&effects.diff)edge.diff=effects.diff;if(!edge.imageChange&&effects.imageChange)edge.imageChange=effects.imageChange;if(!edge.outcome&&effects.outcome)edge.outcome=effects.outcome;
 // A deeplink that was opened and observed becomes a known entry of the screen it landed on.
 if(action.type==='deeplink'&&action.url){const screen=graph.screens.find(s=>s.id===after.screenId);if(screen){screen.deeplinks??=[];if(!screen.deeplinks.some(d=>d.url===action.url))screen.deeplinks.push({url:action.url,state:after.stateId,stepId:step.id});}
  if(!Array.isArray(graph.deeplinks))graph.deeplinks=[];const record={url:action.url,target:run.target,screenId:after.screenId,stateId:after.stateId,runId:run.id,observationId:after.id,verifiedAt:now()},known=graph.deeplinks.find(d=>d.url===action.url&&d.target===run.target);if(known)Object.assign(known,record);else graph.deeplinks.push(record);}

 const candidate=run.frontier.find(f=>f.stateId===before.stateId&&f.elementIdentity===element?.identity);if(candidate)candidate.status='visited';return edge;
}
/**
 * `to` is one state or a set of acceptable states. Routes only use transitions whose outcome is dependable:
 * - when the same action from the same state has led to different places, only its best-evidenced outcome is used;
 * - `back` depends on the back stack, so it is only used to undo the step that precedes it in the route;
 * - a deeplink may start from anywhere (navigation only), unless it has been seen landing in more than one place.
 *   A landing that was itself a surprise (the link was expected elsewhere) does not count: it is a failed attempt, not a second destination.
 */
/** Confirmed transitions a route may rely on, keeping only the best-evidenced outcome of each action; and where each deeplink has landed. */
export function dependableEdges(graph,{target,profile,preconditions={},version,allowUnverifiedVersion=false}){
 const wanted=hash(preconditions);
 const usable=graph.transitions.filter(e=>e.confirmed&&e.target===target&&e.profile===profile&&hash(e.preconditions)===wanted&&!e.action.point&&(allowUnverifiedVersion||e.version?.fingerprint===version?.fingerprint));
 const weight=e=>(e.evidence??[]).filter(x=>!x.diverged).length,outcomes=new Map(),landings=new Map();
 for(const edge of usable){const key=edge.from+JSON.stringify(edge.action),best=outcomes.get(key);if(!best||weight(edge)>=weight(best))outcomes.set(key,edge);if(edge.action.type==='deeplink'&&weight(edge))landings.set(edge.action.url,(landings.get(edge.action.url)??new Set()).add(edge.to));}
 return {edges:usable.filter(e=>outcomes.get(e.from+JSON.stringify(e.action))===e||e.to===outcomes.get(e.from+JSON.stringify(e.action)).to),landings};
}
export function planRoute(graph,{from,to,target,profile,preconditions={},version,allowUnverifiedVersion=false,allowDeeplinks=false}){
 const goals=to instanceof Set?to:new Set([to]),{edges,landings}=dependableEdges(graph,{target,profile,preconditions,version,allowUnverifiedVersion});
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
