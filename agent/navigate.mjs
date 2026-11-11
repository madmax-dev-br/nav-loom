import {dependableEdges} from './graph.mjs';

/**
 * The decision graph for one destination: for every state the project has seen, the single next action that leads
 * towards it. Built from confirmed transitions only, by walking backwards from the destination, so following it
 * needs no reasoning: look at the screen, look up the action, act, repeat.
 *
 * Costs favour what has worked and what only reads: an action that writes to the backend (a purchase, a transfer) costs more.
 * Likewise for reliability: an action that landed somewhere else when it was followed pays for it, so a route
 * that keeps diverging is replaced by a steadier one, and earns its place back as it succeeds again.
 */
export function decisionGraph(graph,{goals,target,profile,preconditions={},version,allowDeeplinks=false,avoid=new Set(),entries=[]}){
 const {edges,landings}=dependableEdges(graph,{target,profile,preconditions,version,allowUnverifiedVersion:true});
 // `walks`/`misses` are kept by goto: how often this action was taken on the way somewhere, and how often the app landed elsewhere.
 const cost=e=>{const misses=e.misses??0,hits=(e.walks??0)-misses;return (e.cost??1)+3*misses/(hits+1)+(writes(e)?2:0)+(version&&e.version?.fingerprint!==version.fingerprint?.5:0);};
 // `back` depends on the back stack, so it is never a planned decision; it is only tried as recovery.
 const steps=edges.filter(e=>!avoid.has(e.id)&&e.from!==e.to&&!['back','deeplink'].includes(e.action.type));
 const solve=walk=>{const left=new Map([...goals].map(id=>[id,0])),next=new Map();for(let changed=true;changed;){changed=false;for(const edge of walk){const rest=left.get(edge.to);if(rest===undefined)continue;const total=rest+cost(edge);if(total<(left.get(edge.from)??Infinity)){left.set(edge.from,total);next.set(edge.from,edge);changed=true;}}}return {left,next};};
 let {left,next}=solve(steps);
 // Getting somewhere must not buy or transfer anything on the way. A write is only followed when the way from the entry
 // screen needs it (signing in, putting an item in the cart to see the cart); from anywhere else the walk goes back or starts over.
 // `entries` come most trusted first (a cold start, then where the mission began). With none that reaches the destination, no write is followed at all.
 const entry=entries.find(id=>left.has(id)),needed=new Set();
 if(entry)for(let at=entry,hops=0;next.has(at)&&hops<200;hops++){needed.add(next.get(at).id);at=next.get(at).to;}
 ({left,next}=solve(steps.filter(e=>!writes(e)||needed.has(e.id))));
 // A deeplink starts from anywhere, as long as it has only ever landed in one place.
 let shortcut=null;if(allowDeeplinks)for(const edge of edges){if(edge.action.type!=='deeplink'||avoid.has(edge.id)||landings.get(edge.action.url)?.size!==1||!left.has(edge.to))continue;const total=left.get(edge.to)+cost(edge);if(!shortcut||total<shortcut.left)shortcut={edge,left:total};}
 const screenOf=new Map(graph.states.map(s=>[s.id,s.screenId]));
 const usable=(edge,observation)=>{const wanted=edge.action.elementIdentity;if(!wanted)return true;const element=observation.elements.find(e=>e.identity===wanted);return !!element&&!element.disabled;};
 // A control that was used from two or more screens and always opened the same one is taken to work wherever it is on view.
 const anywhere=new Map();{const seen=new Map();for(const edge of steps){const wanted=edge.action.elementIdentity;if(edge.action.type!=='click'||!wanted||writes(edge))continue;const entry=seen.get(wanted)??{from:new Set(),to:new Set(),best:null};entry.from.add(screenOf.get(edge.from));entry.to.add(screenOf.get(edge.to));if(left.has(edge.to)&&(!entry.best||left.get(edge.to)<left.get(entry.best.to)))entry.best=edge;seen.set(wanted,entry);}
  for(const [wanted,entry] of seen)if(entry.from.size>=2&&entry.to.size===1&&entry.best)anywhere.set(wanted,entry.best);}
 /**
  * `exact`: this very state has been seen and its next action is known.
  * `screen`: the state is new (the content changed) but the screen is known and the control another of its states used is on view.
  * `global`: the screen has no known way forward, but shows a control that leads to the same place from everywhere else.
  * `deeplink`: nothing on screen helps, or the link is the shorter way.
  */
 function decide(observation){
  if(goals.has(observation.stateId))return {kind:'arrived'};
  const options=[],exact=next.get(observation.stateId);
  if(exact&&usable(exact,observation))options.push({kind:'exact',edge:exact,left:left.get(observation.stateId)});
  else for(const [stateId,edge] of next){if(screenOf.get(stateId)!==observation.screenId||!usable(edge,observation))continue;options.push({kind:'screen',edge,left:left.get(stateId)+.25});}
  // Never used from this screen, but on view and known from others (a tab bar, a home button).
  if(!options.length)for(const element of observation.elements){const edge=!element.disabled&&anywhere.get(element.identity);if(edge)options.push({kind:'global',edge,left:left.get(edge.to)+cost(edge)+.5});}
  if(shortcut)options.push({kind:'deeplink',edge:shortcut.edge,left:shortcut.left});
  return options.sort((a,b)=>a.left-b.left)[0]??null;
 }
 return {left,next,shortcut,decide};
}

/** An action that sent something to the backend changes data; a walk prefers ways that only read, and restarting over a long detour through them. */
export const writes=edge=>(edge.apis??[]).some(api=>!['GET','HEAD','OPTIONS'].includes(api.method));
const actionLabel=edge=>{const a=edge.action;return a.type==='deeplink'?`deeplink ${a.url}`:a.type==='wait'?'wait':a.type==='scroll'?`scroll ${a.direction??''}`.trim():a.type==='fill'?`fill ${edge.name}`:`${a.type} ${edge.name}`;};
/** The decision graph as text a person or an agent can read: one line per known screen state, nearest first. */
export function describeDecisions(graph,decisions){
 const state=id=>graph.states.find(s=>s.id===id),screen=id=>graph.screens.find(s=>s.id===state(id)?.screenId);
 const label=id=>{const sc=screen(id),st=state(id),siblings=graph.states.filter(s=>s.screenId===sc?.id).length;return (sc?.name??'?')+(siblings>1&&st?.name?` (${st.name})`:'');};
 const lines=[...decisions.next].map(([from,edge])=>({from:label(from),do:actionLabel(edge),to:label(edge.to),left:Math.round(decisions.left.get(from)*10)/10,...(writes(edge)?{writes:edge.apis.filter(api=>api.method!=='GET').map(api=>`${api.method} ${api.path}`)}:{})})).sort((a,b)=>a.left-b.left);
 return {decisions:lines,...(decisions.shortcut?{shortcut:{do:actionLabel(decisions.shortcut.edge),to:label(decisions.shortcut.edge.to),left:Math.round(decisions.shortcut.left*10)/10}}:{})};
}
