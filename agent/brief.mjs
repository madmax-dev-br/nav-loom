/** Compact projections returned to external agents. The interface keeps reading the full records. */
const short=id=>id?String(id).slice(0,8):id;
const clip=(text,max)=>{const value=String(text??'').replace(/\s+/g,' ').trim();return value.length>max?value.slice(0,max-1)+'…':value;};
export const apiLabel=call=>`${call.method} ${call.path}${call.status?' '+call.status:call.statuses?.length?' '+call.statuses.join('/'):''}`;
const screenOf=(graph,stateId)=>graph.screens.find(s=>s.id===graph.states.find(x=>x.id===stateId)?.screenId);
const usable=o=>(o.elements??[]).filter(e=>e.actions?.length&&!e.disabled&&e.visible!==false);

export function briefObservation(o,graph,previous){
 if(!o)return null;
 const screen=graph.screens.find(s=>s.id===o.screenId),elements=usable(o);
 const out={observationId:o.id,screen:{id:short(o.screenId),name:screen?.name},state:short(o.stateId)};
 if(o.stateKey)out.stateKey=o.stateKey;if(o.hierarchy==='unavailable')out.hierarchy='unavailable';
 if(previous&&previous.stateId===o.stateId&&usable(previous).map(e=>e.id).join()===elements.map(e=>e.id).join()){out.unchanged='Same state and elements as the previous observation.';return out;}
 // Repeated labels (list rows) are told apart by their test tag.
 const seen=new Map();for(const e of elements){const label=e.label||e.name;seen.set(label,(seen.get(label)??0)+1);}
 const tag=e=>e.resourceId?.split(/[:/]/).at(-1);
 out.elements=elements.slice(0,60).map(e=>{const label=e.label||e.name;return {id:short(e.id),label:clip(seen.get(label)>1&&tag(e)&&!label.startsWith(tag(e))?`${label} (${tag(e)})`:label,60),do:e.actions.join('/'),...(e.sensitive?{secret:true}:{})};});
 if(elements.length>60)out.moreElements=elements.length-60;
 const labels=new Set(elements.flatMap(e=>[e.name,e.label,e.text]));
 const text=clip(String(o.text??'').split('\n').filter(line=>line.trim()&&!labels.has(line)).join(' | '),700);if(text)out.text=text;
 const known=new Map();for(const t of graph.transitions)if(t.confirmed&&t.from===o.stateId&&t.to!==o.stateId){const to=screenOf(graph,t.to);known.set(t.name+'>'+to?.id,{via:clip(t.name,40),to:to?.name});}
 if(known.size)out.known=[...known.values()].slice(0,20);
 return out;
}

export async function briefStep(result,store){
 if(!result?.observation)return {status:result.status,reason:result.reason,error:result.step?.error};
 const graph=await store.graph(),before=result.previous,after=result.observation;
 return {status:result.status,changed:after.screenId!==before?.screenId?'screen':after.stateId!==before?.stateId?'state':'none',...(result.step.network?.length?{api:result.step.network.map(apiLabel)}:{}),...briefObservation(after,graph,before)};
}

export async function briefStart(run,store){
 const graph=await store.graph(),out={runId:run.id,status:run.status};
 if(run.stopReason)out.stopReason=run.stopReason;if(run.status==='blocked')out.capabilities=run.capabilities;
 if(run.resume)out.resume=run.resume;
 const links=graph.deeplinks?.[run.target];if(links?.length)out.deeplinks=links.slice(0,20).map(d=>d.pattern+(d.match==='prefix'?'*':''));
 if(run.entryNetwork?.length)out.api=run.entryNetwork.map(apiLabel);
 const last=run.observations.at(-1);if(last)Object.assign(out,briefObservation(last,graph));
 return out;
}

export async function briefMove(result,store){
 const graph=await store.graph(),steps=result.results??[],last=result.observation??steps.findLast(r=>r.observation)?.observation;
 const api=steps.flatMap(r=>r.step?.network??[]).map(apiLabel);
 return {status:result.status,steps:typeof result.steps==='number'?result.steps:steps.length,...(result.planned?{planned:result.planned}:{}),...(result.reason?{reason:result.reason}:{}),...(result.at?{stoppedAt:result.at}:{}),...(api.length?{api:[...new Set(api)].slice(0,20)}:{}),...(last?briefObservation(last,graph):{})};
}

export function briefRun(run,graph){
 const byId=new Map(run.observations.map(o=>[o.id,o])),name=id=>graph.screens.find(s=>s.id===byId.get(id)?.screenId)?.name;
 const errors=(run.diagnostics?.logs??[]).filter(l=>l.level==='error').slice(-8).map(l=>clip(l.message,200));
 return {runId:run.id,objective:run.objective,mode:run.mode,status:run.status,...(run.stopReason?{stopReason:run.stopReason}:{}),...(run.result?{result:run.result}:{}),...(run.checks?.length?{checks:run.checks.map(c=>`${c.assertion.type}${c.assertion.value?' '+clip(c.assertion.value,40):''}: ${c.result}`)}:{}),metrics:run.metrics,...(run.coverage?{coverage:run.coverage}:{}),
  steps:run.steps.slice(-80).map((s,i)=>clip(`${Math.max(0,run.steps.length-80)+i} ${s.action.type}${s.transitionId?` "${clip(graph.transitions.find(t=>t.id===s.transitionId)?.name,30)}"`:''} ${name(s.before)??'?'} → ${name(s.after)??'?'}${s.network?.length?' ['+s.network.map(apiLabel).join(', ')+']':''}${s.status==='completed'?'':' '+s.status}${s.error?': '+s.error:''}`,260)),...(errors.length?{errors}:{})};
}

/** The project map an agent needs before acting: screens, how they connect, entries and what is still unknown. */
export function briefMemory(memory){
 const {config,graph}=memory,many=Object.keys(config.targets).length>1,edges=new Map();
 for(const t of graph.transitions){if(!t.confirmed)continue;const from=screenOf(graph,t.from),to=screenOf(graph,t.to);if(!from||!to||from.id===to.id)continue;const key=[from.id,to.id,t.name].join('>');const entry=edges.get(key)??{from,to,via:t.name,apis:new Set()};for(const api of t.apis??[])entry.apis.add(`${api.method} ${api.path}`);edges.set(key,entry);}
 return {project:{id:config.id,name:config.name,...(config.description?{description:clip(config.description,300)}:{}),targets:Object.fromEntries(Object.entries(config.targets).map(([id,t])=>[id,t.platform==='android'?`android ${t.package}`:`web ${t.url}`])),profiles:Object.fromEntries(Object.entries(config.profiles).map(([id,p])=>[id,Object.keys(p.secrets)])),actions:config.permissions.actions,limits:config.limits,repositories:config.repositories.map(r=>r.id)},
  ...(memory.skills.length?{skills:memory.skills}:{}),
  screens:graph.screens.map(s=>({id:short(s.id),name:s.name,...(many?{target:s.target}:{}),...(s.description?{description:clip(s.description,220)}:{}),...(s.deeplinks?.length?{deeplinks:s.deeplinks.map(d=>d.url)}:{})})),
  transitions:[...edges.values()].slice(0,300).map(e=>`${e.from.name} —${clip(e.via,40)}→ ${e.to.name}${e.apis.size?' ['+[...e.apis].slice(0,6).join(', ')+']':''}`),
  ...(graph.flows?.length?{flows:graph.flows.map(f=>({id:f.id,name:f.name,screens:f.screenIds.map(id=>graph.screens.find(s=>s.id===id)?.name)}))}:{}),
  ...(Object.keys(graph.deeplinks??{}).length?{declaredDeeplinks:Object.fromEntries(Object.entries(graph.deeplinks).map(([target,list])=>[target,list.map(d=>d.pattern+(d.match==='prefix'?'*':''))]))}:{}),
  runs:memory.runs.slice(0,10).map(r=>({runId:r.id,objective:clip(r.objective,80),status:r.status,...(r.result?{result:r.result}:{})}))};
}

export function briefStatus(status){
 const {config,graph}=status;
 return {service:status.service,config:config&&{id:config.id,name:config.name,targets:Object.keys(config.targets)},configurationError:status.configurationError,activeRun:status.activeRun,screens:graph.screens.length,transitions:graph.transitions.length,runs:status.runs.length};
}

export function briefFrontier(frontier,graph){
 const groups=new Map();for(const item of frontier){if(item.status!=='pending')continue;const screen=screenOf(graph,item.stateId)?.name??'?';groups.set(screen,[...(groups.get(screen)??[]),clip(item.label,40)]);}
 return {pending:frontier.filter(f=>f.status==='pending').length,visited:frontier.filter(f=>f.status==='visited').length,byScreen:Object.fromEntries([...groups].map(([screen,labels])=>[screen,[...new Set(labels)].slice(0,25)]))};
}
