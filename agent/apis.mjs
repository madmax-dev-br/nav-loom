import {mergeApis} from './network.mjs';
import {isLoadCall} from '../lib/api-role.mjs';
import {recordResponses} from './outcomes.mjs';
/**
 * Which step an API call belongs to, and how to fix it when that was wrong.
 *
 * A call belongs to the last action taken before it started, by its own time (a log line read one step late still
 * says when it was written). What timing cannot know, a rule can: the agent (asked by a person, or seeing a doubt)
 * says an endpoint is `load` of a screen (it comes with arriving there) or an `action` of a screen (optionally the
 * action named `via`). Rules apply to new calls and, through `reattribute`, to everything already recorded.
 */
const SKEW=150;
const endpointOf=call=>`${call.method} ${call.path}`;
/** The last step whose action came before the call; the latest step without a time; `undefined` before any step (startup). */
export function ownerStep(run,call){if(!Number.isFinite(call.at))return run.steps.at(-1)??undefined;let owner;for(const step of run.steps){if(!Number.isFinite(step.actedAt)){owner=step;continue;}if(step.actedAt<=call.at+SKEW)owner=step;else break;}return owner;}
/** The step a rule picks for a call: one of the kind the rule names, nearest in time. Without a matching step, `owner` stands. */
export function ruled(graph,run,call,owner){
 const rule=(graph.apiRules??[]).find(r=>r.endpoint===endpointOf(call));if(!rule)return owner;
 const screenOf=id=>run.observations.find(o=>o.id===id)?.screenId;
 const fits=step=>rule.role==='load'?screenOf(step.after)===rule.screenId&&screenOf(step.before)!==rule.screenId:screenOf(step.before)===rule.screenId&&(!rule.via||graph.transitions.find(e=>e.id===step.transitionId)?.name===rule.via);
 const candidates=run.steps.filter(s=>s.after&&fits(s));if(!candidates.length)return owner;
 const t=Number.isFinite(call.at)?call.at:owner?.actedAt??0;return candidates.sort((a,b)=>Math.abs((a.actedAt??0)-t)-Math.abs((b.actedAt??0)-t))[0];
}
/**
 * Put every recorded call back on the step its time and the rules choose, then rebuild the API list of every transition
 * from its steps. Transitions whose steps are not in the runs at hand (an imported map) keep what they have.
 */
export function reattribute(graph,runs){
 let moved=0;const rebuilt=new Map();
 for(const run of runs){
  const calls=run.steps.flatMap(step=>(step.network??[]).map(call=>({call,from:step})));if(!calls.length)continue;
  for(const step of run.steps)step.network=[];
  for(const {call,from} of calls){const owner=ruled(graph,run,call,from)??from;if(owner!==from)moved++;owner.network.push(call);}
  for(const step of run.steps){if(!step.network.length)delete step.network;if(!step.transitionId)continue;const list=rebuilt.get(step.transitionId)??[];rebuilt.set(step.transitionId,[...list,...(step.network??[])]);}
 }
 for(const edge of graph.transitions)if(rebuilt.has(edge.id)){edge.apis=mergeApis([],rebuilt.get(edge.id));delete edge.responses;recordResponses(edge,rebuilt.get(edge.id));}
 return {moved,transitions:rebuilt.size};
}
/**
 * Calls that look misplaced: an endpoint seen most of the time in one place (loaded by a screen, or called by one
 * action) and a few times somewhere else. The few are the doubt; the agent checks the run and sets a rule.
 */
export function apiDoubts(graph,{share=.6}={}){
 const screenOf=id=>graph.states.find(s=>s.id===id)?.screenId,name=id=>graph.screens.find(s=>s.id===id)?.name??'?',places=new Map();
 for(const edge of graph.transitions){if(!edge.confirmed)continue;const from=screenOf(edge.from),to=screenOf(edge.to),crosses=from!==to;
  for(const api of edge.apis??[]){const key=`${api.method} ${api.path}`,load=isLoadCall(api,crosses),place=load?`ao chegar em ${name(to)}`:`em ${name(from)} por "${edge.name}"`,entry=places.get(key)??new Map();entry.set(place,(entry.get(place)??0)+(api.count??1));places.set(key,entry);}}
 const out=[];for(const [endpoint,where] of places){if(where.size<2)continue;const total=[...where.values()].reduce((a,b)=>a+b,0),[top,count]=[...where].sort((a,b)=>b[1]-a[1])[0];if(count/total<share)continue;for(const [place,n] of where)if(place!==top)out.push({endpoint,usual:top,usualCount:count,odd:place,oddCount:n});}
 return out.sort((a,b)=>b.usualCount-a.usualCount).slice(0,20);
}
