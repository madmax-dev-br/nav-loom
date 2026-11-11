import {join} from 'node:path';
import {uid,now} from './store.mjs';
/**
 * Help requests and the answers remembered for them (kept in the graph as `harness`). When the agent cannot proceed (credentials, a value only a person knows,
 * a decision, a precondition) it asks; the answer is recorded so later runs do not ask again. Secret values live
 * only in the ignored .navloom/secrets.json; the versioned harness keeps the question, the context and the
 * secret reference, never the value.
 */
export const HELP_KINDS=['credential','input','decision','precondition','environment','other'];
export class Help{
 constructor(store){this.store=store;}
 async requests(){return this.store.json('requests.json',[]);}
 async saveRequests(list){await this.store.save('requests.json',list);}
 async secrets(){return this.store.json('secrets.json',{});}
 async saveSecret(ref,value){const all=await this.secrets();all[ref]=value;await this.store.atomic(join(this.store.dir,'secrets.json'),JSON.stringify(all,null,2));}
 async forgetSecret(ref){const all=await this.secrets();delete all[ref];await this.store.atomic(join(this.store.dir,'secrets.json'),JSON.stringify(all,null,2));}
 /** Harness entries that apply to a screen, state, element or secret reference. */
 known(graph,{screenId,stateId,elementIdentity,kind,secretRef}={}){return (graph.harness??[]).filter(e=>{if(secretRef&&e.answer?.secretRef===secretRef)return true;if(elementIdentity&&e.elementIdentity===elementIdentity&&(!screenId||e.screenId===screenId))return true;if(stateId&&e.stateId===stateId&&(!kind||e.kind===kind)&&!e.elementIdentity)return true;if(screenId&&e.screenId===screenId&&!e.elementIdentity&&(!kind||e.kind===kind))return true;return false;});}
 /** What this observation needs from a person and what the harness already knows about it. */
 help(graph,observation){
  const needs=(observation.elements??[]).filter(e=>e.sensitive).map(e=>{const entry=this.known(graph,{screenId:observation.screenId,elementIdentity:e.identity})[0]??this.known(graph,{screenId:observation.screenId,kind:'credential'})[0];return {kind:'credential',elementId:e.id,elementIdentity:e.identity,name:e.name,known:entry?.id??null,secretRef:entry?.answer?.secretRef??null,hint:entry?'Use navloom_step fill with this secretRef.':'Ask with navloom_ask kind credential; the answer is stored as a local secret and remembered.'};});
  const hints=this.known(graph,{screenId:observation.screenId,stateId:observation.stateId}).filter(e=>!needs.some(n=>n.known===e.id)).map(e=>({id:e.id,kind:e.kind,question:e.question,answer:publicAnswer(e.answer)}));
  return {needs,hints};
 }
 async ask(graph,input){
  const existingKnown=this.known(graph,input).filter(e=>!input.kind||e.kind===input.kind);
  if(existingKnown.length)return {status:'known',entries:existingKnown.map(publicEntry),note:'Answered in an earlier run; use it instead of asking again.'};
  const requests=await this.requests();
  const duplicate=requests.find(r=>r.status==='pending'&&r.kind===input.kind&&r.screenId===input.screenId&&(r.elementIdentity??null)===(input.elementIdentity??null)&&r.question===input.question);
  if(duplicate)return {status:'pending',request:duplicate};
  const request={id:uid(),status:'pending',askedAt:now(),runId:input.runId??null,kind:input.kind,question:input.question,why:input.why??'',screenId:input.screenId??null,stateId:input.stateId??null,elementIdentity:input.elementIdentity??null,secretRef:input.secretRef??null,options:input.options??[],context:input.context??{}};
  requests.push(request);await this.saveRequests(requests);return {status:'pending',request};
 }
 async pending(){return (await this.requests()).filter(r=>r.status==='pending');}
 async await({requestId,timeoutMs=120000,intervalMs=500}){const started=Date.now();for(;;){const request=(await this.requests()).find(r=>r.id===requestId);if(!request)throw Error('Unknown request');if(request.status!=='pending')return {status:request.status,request,entry:request.entry??null};if(Date.now()-started>=timeoutMs)return {status:'pending',request};await new Promise(r=>setTimeout(r,intervalMs));}}
 /** Only a person answers. The secret value never enters the graph or the map. */
 async answer(graph,{requestId,value,instruction,option,secret,remember=true,secretRef,resolvedBy='interface'}){
  const requests=await this.requests(),request=requests.find(r=>r.id===requestId);if(!request)throw Error('Unknown request');if(request.status!=='pending')throw Error('Request already answered');
  const isSecret=secret??request.kind==='credential';let answer;
  if(isSecret){if(typeof value!=='string'||!value.length)throw Error('A secret answer needs a value');const ref=secretRef||request.secretRef||`help_${request.kind}_${request.id.slice(0,8)}`;if(!/^[a-zA-Z0-9][\w-]{0,60}$/.test(ref))throw Error('Invalid secret reference');await this.saveSecret(ref,value);answer={type:'secretRef',secretRef:ref};}
  else if(option!==undefined)answer={type:'option',value:String(option)};
  else if(instruction)answer={type:'instruction',value:instruction};
  else if(typeof value==='string')answer={type:'value',value};
  else throw Error('Provide value, instruction or option');
  const entry={id:uid(),requestId:request.id,kind:request.kind,question:request.question,why:request.why,screenId:request.screenId,stateId:request.stateId,elementIdentity:request.elementIdentity,answer,resolvedAt:now(),resolvedBy,remembered:remember,uses:[]};
  request.status='answered';request.answeredAt=entry.resolvedAt;request.entry=publicEntry(entry);await this.saveRequests(requests);
  if(remember){graph.harness??=[];graph.harness.push(entry);}
  return {request,entry:publicEntry(entry),graphChanged:remember};
 }
 async dismiss({requestId,reason='dismissed'}){const requests=await this.requests(),request=requests.find(r=>r.id===requestId);if(!request)throw Error('Unknown request');request.status='dismissed';request.reason=reason;await this.saveRequests(requests);return request;}
 async forget(graph,id){const entry=(graph.harness??[]).find(e=>e.id===id);if(!entry)throw Error('Unknown harness entry');graph.harness=graph.harness.filter(e=>e.id!==id);if(entry.answer?.secretRef&&!graph.harness.some(e=>e.answer?.secretRef===entry.answer.secretRef))await this.forgetSecret(entry.answer.secretRef);return publicEntry(entry);}
 recordUse(graph,secretRef,runId){for(const entry of graph.harness??[])if(entry.answer?.secretRef===secretRef&&!entry.uses.includes(runId))entry.uses.push(runId);}
}
export function publicAnswer(answer){if(!answer)return null;return answer.type==='secretRef'?{type:'secretRef',secretRef:answer.secretRef}:answer;}
export function publicEntry(entry){return {...entry,answer:publicAnswer(entry.answer)};}
