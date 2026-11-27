/**
 * How the workspace takes what it polls from the local service. Good data is never traded for an empty, partial or
 * late answer: a poll that fails keeps what is on screen, and "no project" is shown only when the service says so
 * more than once in a row (or right after something the person did).
 */
/** Timer polls in a row that must agree before a loaded project or map is replaced by an empty one. */
export const CONFIRM_EMPTY=3;
/** One failed poll is a hiccup nobody needs to see; the indicator shows from the second in a row. */
export const SHOW_AFTER=2;
/** A complete status record. Anything else (an error body, a truncated or foreign answer) is a failed poll. */
export const usable=answer=>!!answer&&typeof answer==='object'&&!Array.isArray(answer)&&!!answer.graph&&['screens','states','transitions'].every(key=>Array.isArray(answer.graph[key]))&&Array.isArray(answer.runs);
/** The same project now answers with less than what is shown: its configuration is gone, or its whole map is. */
export function shrinks(shown,answer){
 if(!shown||(shown.service?.root??null)!==(answer.service?.root??null))return false;
 return (!!shown.config&&!answer.config)||(shown.graph.screens.length>0&&answer.graph.screens.length===0);
}
/**
 * held = {data,text,doubt}: what is shown, the exact text it came from, and how many polls in a row said "less".
 * verdict: invalid (not a status: treat as a failed poll) · same (identical text: keep the very same object, nothing
 * re-renders) · held (looks emptier; waiting for it to be confirmed) · new (show it).
 * trusted: the person just acted (saved, switched, retried), so an emptier answer is the result and not a hiccup.
 */
export function takeStatus(held,answer,{trusted=false}={}){
 if(!usable(answer?.data))return {...held,verdict:'invalid'};
 if(held.data&&answer.text&&answer.text===held.text)return {data:held.data,text:held.text,doubt:0,verdict:'same'};
 if(!trusted&&shrinks(held.data,answer.data)&&held.doubt+1<CONFIRM_EMPTY)return {data:held.data,text:held.text,doubt:held.doubt+1,verdict:'held'};
 return {data:answer.data,text:answer.text??'',doubt:0,verdict:'new'};
}
/** Polls overlap (the timer, an action, a retry). An answer is applied only if no later request was applied before it. */
export function sequencer(){let issued=0,applied=0;return {next:()=>++issued,current:seq=>seq>applied,accept(seq){if(seq<=applied)return false;applied=seq;return true;}};}
/** online: nothing to say · reconnecting: polls keep failing over the last known data · offline: nothing was ever loaded. */
export const linkState=(failures,hasData)=>failures===0?'online':hasData?(failures>=SHOW_AFTER?'reconnecting':'online'):'offline';
/** Retry sooner while the service does not answer, without hammering it. */
export const pollDelay=failures=>failures?Math.min(2000*failures,5000):5000;
/** Only a project the service positively does not know is forgotten; a failure to reach it is not that. */
export const unknownProject=error=>error?.code==='unknown_project';
