import {hash,now,uid} from './store.mjs';
import {mergeApis} from './network.mjs';
import {envOf} from './schema.mjs';
import {tokensOf,controlsOf,semanticMarkers,structureKey,learn,recognizeScreen,recognizeState,stateName,activityOf} from './recognize.mjs';
/** Which accounts (profiles) and environments have seen a screen or state. */
const tag=(item,run)=>{for(const [key,value] of [['profiles',run.profile??'default'],['environments',run.environment??envOf(run)]]){item[key]??=[];if(!item[key].includes(value))item[key].push(value);}};
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
 const natural=structureKey(observation),view=viewSignature(observation);observation.naturalState=natural;
 if(!scrolledFrom){if(previous?.scrollBase&&previous.naturalState===natural&&viewSignature(previous)===view){observation.stateOverride=previous.stateId;observation.scrollBase=previous.scrollBase;observation.stateName=previous.stateName;}return;}
 const base=scrolledFrom.scrollBase??scrolledFrom.stateId,root=graph.states.find(s=>s.id===base);
 if(view===viewSignature(scrolledFrom)){observation.stateOverride=scrolledFrom.stateId;observation.scrollBase=scrolledFrom.scrollBase;observation.stateName=scrolledFrom.stateName;return;}
 if(root?.viewSig===view){observation.stateOverride=base;return;}
 observation.stateOverride=hash([base,'scroll',view]);observation.scrollBase=base;observation.stateName=`${root?.name??'estado'} · rolado`;
}
const HOTSPOT_LIMIT=80;
/** Compact interactive candidates kept on the state so the map renders without local evidence files. */
export function hotspots(observation){return observation.elements.filter(e=>e.actions?.length&&!e.disabled&&e.visible!==false&&e.bounds).slice(0,HOTSPOT_LIMIT).map(e=>({id:e.id,identity:e.identity,name:e.name,actions:e.actions,bounds:e.bounds,sensitive:!!e.sensitive,...(e.label&&e.label!==e.name?{label:e.label}:{}),...(e.resourceId?{resourceId:e.resourceId}:{})}));}
/** Follow merges: a screen or state folded into another answers to the one it was folded into. */
const alias=(map,id)=>{for(let hops=0;map?.[id]&&hops<20;hops++)id=map[id];return id;};
/**
 * Place a capture on the map: which screen, which state. `context` is what the navigation says about it
 * (`previous` capture, the `action` and `element` that led here, `scrolledFrom`), see `recognizeScreen`.
 * 1. An id the app declares (or an approved `screen` script) names the screen; a script may name a known screen by its id.
 * 2. A fragment names it.
 * 3. Otherwise the capture is compared with the profile of every known screen; only when none is close enough is it a new one.
 * The state is the app's own state key when there is one; otherwise the known state of that screen with the same moment
 * (error, loading, empty…), the same keyboard and about the same controls.
 */
export function recordObservation(graph,observation,run,context={}){
 const target=run.target,tokens=tokensOf(observation),controls=controlsOf(observation),markers=semanticMarkers(observation);
 observation.structure=structureKey(observation);observation.semantic=markers;
 const previous=context.previous,trail=context.trail??[];
 let screen=null,recognition=null;
 const base=observation.scrollBase??(observation.stateOverride&&graph.states.find(s=>s.id===observation.stateOverride)?.id);
 if(base){screen=graph.screens.find(s=>s.id===graph.states.find(x=>x.id===base)?.screenId)??null;if(screen)recognition={how:'scroll',score:1};}
 if(!screen&&observation.screenKey){
  const natural=alias(graph.aliases,hash([target,observation.screenKey]));
  screen=graph.screens.find(s=>s.target===target&&(s.id===natural||s.screenKey===observation.screenKey))??graph.screens.find(s=>s.target===target&&s.id===alias(graph.aliases,observation.screenKey))??null;
  recognition={how:observation.identifiedBy?'script':'explicit',score:1,...(observation.identifiedBy?{script:observation.identifiedBy}:{})};
  if(!screen)screen=newScreen(graph,observation,run,natural,observation.identifiedBy?'script':'explicit');
 }
 else if(!screen&&observation.fragment){
  const natural=alias(graph.aliases,hash([target,['fragment',observation.fragment]]));recognition={how:'fragment',score:1};
  screen=graph.screens.find(s=>s.id===natural)??newScreen(graph,observation,run,natural,'fragment');
 }
 else if(!screen){
  // Nothing on view (a frame between two screens, a cold start drawing): it belongs to where the app was.
  if(!tokens.size&&previous){screen=graph.screens.find(s=>s.id===previous.screenId)??null;if(screen){recognition={how:'blank',score:1};if(!markers.includes('loading'))markers.push('loading');}}
  if(!screen){
   const result=recognizeScreen(graph,observation,{target,tokens,previous,action:context.action,expected:context.expected??[],trail});
   recognition={how:result.how,score:result.score,...(result.why?.length?{why:result.why}:{}),candidates:result.candidates.filter(c=>c.screenId!==result.screen?.id)};
   screen=result.screen;observation.recognition=recognition;
   if(!screen){
    // The id is derived from what the app shows, so two runs that meet the same new screen agree on it; a clash gets the controls added.
    let id=hash([target,[observation.route,observation.heading]]);if(graph.screens.some(s=>s.id===id))id=hash([target,'screen',observation.route,observation.heading,[...controls].sort()]);
    screen=graph.screens.find(s=>s.id===id)??newScreen(graph,observation,run,id,'structural');
   }
  }
 }
 observation.screenId=screen.id;observation.recognition=recognition;
 screen.activity??=activityOf(observation);
 // Profiles learn from clean captures only: a scrolled view, a keyboard or a dialog hide part of the screen.
 if(tokens.size&&(!screen.profile?.n||(!observation.keyboard&&!observation.overlay&&!observation.scrollBase&&recognition?.how!=='blank')))screen.profile=learn(screen.profile,tokens);
 if(observation.links?.length){screen.links=[...new Set([...(screen.links??[]),...observation.links])].slice(0,100);}
 // What the app itself calls this screen; kept current so details and agent context can show it.
 if(observation.fragment&&screen.fragment!==observation.fragment)screen.fragment=observation.fragment;if(observation.header&&screen.header!==observation.header&&!observation.scrollBase)screen.header=observation.header;
 let stateId;
 if(observation.stateOverride)stateId=observation.stateOverride;
 else if(observation.stateKey)stateId=alias(graph.stateAliases,identity(observation,target).stateId);
 else stateId=recognizeState(graph,screen.id,observation,{controls,markers})?.state.id??hash([screen.id,'state',[...controls].sort(),markers,!!observation.keyboard]);
 observation.stateId=stateId;
 let state=graph.states.find(s=>s.id===stateId);
 if(!state){const taken=graph.states.filter(s=>s.screenId===screen.id).map(s=>s.name);const plain=observation.stateKey||observation.heading||'Observed state';
  state={id:stateId,screenId:screen.id,name:observation.stateName||(observation.stateKey?(observation.keyboard?`${plain} · teclado`:plain):stateName(markers,{keyboard:observation.keyboard,taken})),stateKey:observation.stateKey??null,description:'',firstSeen:observation.id,lastSeen:observation.id,markers:(observation.stateMarkers??[]).map(m=>Array.isArray(m)?m[0]:m).filter(Boolean),semantic:markers,controls:[...controls].slice(0,150),...(observation.scrollBase?{scrollOf:observation.scrollBase}:{}),...(observation.keyboard?{keyboard:true}:{})};graph.states.push(state);}
 state.lastSeen=observation.id;if(!observation.scrollBase&&!state.viewSig)state.viewSig=viewSignature(observation);
 if(!state.hotspots?.length)state.hotspots=hotspots(observation);tag(screen,run);tag(state,run);
 for(const element of observation.elements){if(!element.actions?.length||element.disabled)continue;const key=hash([observation.stateId,element.identity]);if(!run.frontier.some(f=>f.key===key))run.frontier.push({key,stateId:observation.stateId,elementIdentity:element.identity,label:element.name,...(element.label&&element.label!==element.name?{hint:element.label}:{}),actions:element.actions,status:'pending',observationId:observation.id,elementId:element.id,sensitive:!!element.sensitive,bounds:element.bounds});}
 return {screenId:screen.id,stateId};
}
function newScreen(graph,observation,run,id,how){
 const screen={id,target:run.target,name:observation.screenName||fromFragment(observation.fragment)||observation.header||humanize(observation.screenKey)||observation.heading||observation.title||observation.route,description:'',route:observation.route,identity:how==='script'?'explicit':how,screenKey:observation.screenKey??null,sources:[],links:[],createdAt:now(),...(observation.recognition?.candidates?.length?{similar:observation.recognition.candidates}:{})};
 graph.screens.push(screen);return screen;
}
/** The signature that tells one recorded transition from another: same states, same action, same account, version and environment. */
export const edgeSignature=e=>hash([e.from,e.to,e.action,e.target,e.profile,e.preconditions,e.version?.fingerprint,...(envOf(e)==='default'?[]:[envOf(e)])]);
/** `effects` is what the action was seen to cause: API calls, outcome, structural diff, pixel change and a summary. */
export function confirmTransition(graph,before,after,action,step,run,effects={}){
 const calls=effects.calls??[];
 const element=before.elements.find(e=>e.id===action.elementId);
 const replay={...action};delete replay.observationId;delete replay.elementId;if(replay.secretRef)delete replay.value;
 if(element)replay.elementIdentity=element.identity;
 const signature=hash([before.stateId,after.stateId,replay,run.target,run.profile,run.preconditions,run.version?.fingerprint,...(envOf(run)==='default'?[]:[envOf(run)])]);let edge=graph.transitions.find(e=>e.signature===signature);
 if(!edge){edge={id:uid(),signature,from:before.stateId,to:after.stateId,target:run.target,profile:run.profile,...(envOf(run)==='default'?{}:{environment:envOf(run)}),preconditions:run.preconditions,kind:action.type==='scroll'?'scroll':before.screenId===after.screenId?'state':'navigation',outcome:effects.outcome??null,name:element?.label||element?.name||(action.type==='deeplink'?action.url:action.type==='wait'?'Evento automático':action.type==='back'?'Voltar':action.type),action:replay,confirmed:true,evidence:[],version:run.version,cost:1,description:'',summary:effects.summary??'',diff:effects.diff??null,imageChange:effects.imageChange??null,apis:[]};graph.transitions.push(edge);}edge.evidence.push({runId:run.id,stepId:step.id,before:before.id,after:after.id,...(step.status==='diverged'?{diverged:true}:{})});if(edge.evidence.length>50)edge.evidence.splice(0,edge.evidence.length-50);
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
export function dependableEdges(graph,{target,profile,environment='default',otherEnvironments=false,preconditions={},version,allowUnverifiedVersion=false}){
 const wanted=hash(preconditions);
 // Screens are shared between environments. With `otherEnvironments` a way learned in one (a mock) may be followed in another, but what this
 // environment has shown itself always wins: the same control may lead elsewhere here (a sign-in the mock skips).
 const usable=graph.transitions.filter(e=>e.confirmed&&e.target===target&&e.profile===profile&&(envOf(e)===environment||otherEnvironments)&&hash(e.preconditions)===wanted&&!e.action.point&&(allowUnverifiedVersion||e.version?.fingerprint===version?.fingerprint));
 // The same submit can stay on its screen (a form rejected: empty fields, a probe, a failed attempt) or leave it (accepted). Field values are
 // not part of a state, so both are the same action from the same state. For routes the outcome that leaves wins: staying is never a way
 // anywhere else, and goto checks where it lands and counts misses, so a wrong pick is corrected by the walks themselves.
 const screenOf=new Map((graph.states??[]).map(s=>[s.id,s.screenId])),leaves=e=>e.action.type==='click'&&screenOf.get(e.to)!==screenOf.get(e.from)?1:0;
 const weight=e=>(e.evidence??[]).filter(x=>!x.diverged).length+(envOf(e)===environment?1000:0)+leaves(e)*100000,outcomes=new Map(),landings=new Map();
 for(const edge of usable){const key=edge.from+JSON.stringify(edge.action),best=outcomes.get(key);if(!best||weight(edge)>=weight(best))outcomes.set(key,edge);if(edge.action.type==='deeplink'&&weight(edge))landings.set(edge.action.url,(landings.get(edge.action.url)??new Set()).add(edge.to));}
 return {edges:usable.filter(e=>outcomes.get(e.from+JSON.stringify(e.action))===e||e.to===outcomes.get(e.from+JSON.stringify(e.action)).to),landings};
}
export function planRoute(graph,{from,to,target,profile,environment='default',preconditions={},version,allowUnverifiedVersion=false,allowDeeplinks=false}){
 const goals=to instanceof Set?to:new Set([to]),{edges,landings}=dependableEdges(graph,{target,profile,environment,preconditions,version,allowUnverifiedVersion});
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
