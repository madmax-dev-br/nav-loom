import {splitApis,screenApis} from '../lib/api-role.mjs';
import {similarScreens} from './recognize.mjs';
import {entryPoints,entryLines} from './flowgraph.mjs';
import {apiDoubts} from './apis.mjs';
/** Compact projections returned to external agents. The interface keeps reading the full records. */
const short=id=>id?String(id).slice(0,8):id;
const clip=(text,max)=>{const value=String(text??'').replace(/\s+/g,' ').trim();return value.length>max?value.slice(0,max-1)+'…':value;};
export const apiLabel=call=>`${call.method} ${call.path}${call.status?' '+call.status:call.statuses?.length?' '+call.statuses.join('/'):''}`;
const screenOf=(graph,stateId)=>graph.screens.find(s=>s.id===graph.states.find(x=>x.id===stateId)?.screenId);
const screenName=(graph,id)=>{const name=graph.screens.find(s=>s.id===id)?.name;return name?` em ${name}`:'';};
/** Where an environment opens, as recorded: the entry screen of each target there. */
const entryOf=(graph,environment,isDefault)=>{const entries=Object.entries(graph.entries??{}).filter(([key])=>isDefault?!key.includes('@'):key.endsWith('@'+environment)).map(([,state])=>screenOf(graph,state)?.name).filter(Boolean);return entries.length?{opensAt:[...new Set(entries)].join(', ')}:{};};
/** A screen only some accounts or environments have reached. Nothing is said when every one that has data saw it. */
const onlyIn=(graph,screen)=>{const out={};for(const key of ['profiles','environments']){const all=new Set(graph.screens.flatMap(s=>s[key]??[]));if(all.size>1&&screen[key]?.length&&screen[key].length<all.size)out[key==='profiles'?'onlyProfiles':'onlyEnvironments']=screen[key];}return out;};
const usable=o=>(o.elements??[]).filter(e=>e.actions?.length&&!e.disabled&&e.visible!==false);

export function briefObservation(o,graph,previous){
 if(!o)return null;
 const screen=graph.screens.find(s=>s.id===o.screenId),elements=usable(o);
 const out={observationId:o.id,screen:{id:short(o.screenId),name:screen?.name},state:short(o.stateId)};
 // How sure Navloom is that this is the screen it says: a new screen that looks like a known one is for the agent to judge.
 const r=o.recognition;if(r?.how==='new'){out.screen.new=true;if(r.candidates?.length){out.lookalike=r.candidates.map(c=>`${short(c.screenId)} ${clip(c.name,40)} ${c.score}`);out.hint=`If this is ${r.candidates[0].name}, call navloom_merge {into:"${short(r.candidates[0].screenId)}", from:["${short(o.screenId)}"]}`;}}
 else if(r?.how==='similar'&&r.score<.8)out.screen.match=r.score;else if(['overlay','blank'].includes(r?.how))out.screen.by=r.how==='overlay'?'dialog over this screen':'nothing drawn yet';
 if(o.trail?.length>1)out.trail=o.trail.map(id=>graph.screens.find(s=>s.id===id)?.name??short(id)).join(' → ');
 if(o.stack?.length>1)out.activities=o.stack.join(' > ');
 const stateName=graph.states.find(s=>s.id===o.stateId)?.name;if(stateName&&stateName!==o.stateKey)out.stateName=stateName;else if(o.stateKey)out.stateKey=o.stateKey;if(o.hierarchy==='unavailable')out.hierarchy='unavailable';
 if(previous&&previous.stateId===o.stateId&&usable(previous).map(e=>e.id).join()===elements.map(e=>e.id).join()){out.unchanged='Same state and elements as the previous observation.';return out;}
 // Repeated labels (list rows) are told apart by their test tag.
 const seen=new Map();for(const e of elements){const label=e.label||e.name;seen.set(label,(seen.get(label)??0)+1);}
 const tag=e=>e.resourceId?.split(/[:/]/).at(-1);
 // One line per element, "id label": click is implied, anything else comes first in parentheses. Half the size of an object per element.
 out.elements=elements.slice(0,60).map(e=>{const label=e.label||e.name,does=[...(e.actions.join('/')==='click'?[]:[e.actions.join('/')]),...(e.sensitive?['secret']:[])];return `${short(e.id)} ${does.length?`(${does.join(', ')}) `:''}${clip(seen.get(label)>1&&tag(e)&&!label.startsWith(tag(e))?`${label} (${tag(e)})`:label,60)}`;});
 if(elements.length>60)out.moreElements=elements.length-60;
 const labels=new Set(elements.flatMap(e=>[e.name,e.label,e.text]));
 const text=clip([...new Set(String(o.text??'').split('\n').map(line=>line.trim()).filter(line=>line&&!labels.has(line)))].join(' | '),700);if(text)out.text=text;
 const known=new Map();for(const t of graph.transitions)if(t.confirmed&&t.from===o.stateId&&t.to!==o.stateId){const to=screenOf(graph,t.to);known.set(t.name+'>'+to?.id,`${clip(t.name,40)} → ${to?.name}`);}
 if(known.size)out.known=[...known.values()].slice(0,20);
 // What this screen needs from a person, and what earlier answers already cover.
 const needs=(o.help?.needs??[]).map(n=>({element:short(n.elementId),name:clip(n.name,40),...(n.secretRef?{secretRef:n.secretRef}:{ask:'navloom_ask kind=credential'})}));if(needs.length)out.needs=needs;
 const hints=(o.help?.hints??[]).map(h=>`${clip(h.question,80)} → ${h.answer?.type==='secretRef'?'secretRef '+h.answer.secretRef:clip(h.answer?.value,80)}`);if(hints.length)out.remembered=hints;
 return out;
}

export async function briefStep(result,store){
 if(!result?.observation)return {status:result.status,reason:result.reason,error:result.step?.error};
 const graph=await store.graph(),before=result.previous,after=result.observation;
 return {status:result.status,changed:after.screenId!==before?.screenId?'screen':after.stateId!==before?.stateId?'state':'none',...(result.step.network?.length?{api:result.step.network.map(apiLabel)}:{}),...briefObservation(after,graph,before)};
}

export async function briefStart(run,store){
 const graph=await store.graph(),out={runId:run.id,status:run.status,profile:run.profile,...(run.environment&&run.environment!=='default'?{environment:run.environment}:{})};
 if(run.stopReason)out.stopReason=run.stopReason;if(run.status==='blocked')out.capabilities=run.capabilities;
 if(run.resume)out.resume=run.resume;
 const links=graph.declaredDeeplinks?.[run.target];if(links?.length)out.deeplinks=links.slice(0,20).map(d=>d.pattern+(d.match==='prefix'?'*':''));
 if(run.entryNetwork?.length)out.api=run.entryNetwork.map(apiLabel);
 const last=run.observations.at(-1);if(last)Object.assign(out,briefObservation(last,graph));
 return out;
}

export async function briefMove(result,store){
 const graph=await store.graph(),steps=result.results??[],last=result.observation??steps.findLast(r=>r.observation)?.observation;
 const api=steps.flatMap(r=>r.step?.network??[]).map(apiLabel);
 return {status:result.status,steps:typeof result.steps==='number'?result.steps:steps.length,...(result.planned?{planned:result.planned}:{}),...(result.started?{runId:result.runId}:{}),...(result.recoveries?{recoveries:result.recoveries}:{}),...(result.diagnosis?{diagnosis:result.diagnosis}:{}),...(result.hint?{hint:result.hint}:{}),...(result.reason?{reason:result.reason}:{}),...(result.at?{stoppedAt:result.at}:{}),...(api.length?{api:[...new Set(api)].slice(0,20)}:{}),...(last?briefObservation(last,graph):{})};
}

export function briefRun(run,graph){
 const byId=new Map(run.observations.map(o=>[o.id,o])),name=id=>graph.screens.find(s=>s.id===byId.get(id)?.screenId)?.name;
 const errors=(run.diagnostics?.logs??[]).filter(l=>l.level==='error').slice(-8).map(l=>clip(l.message,200));
 return {runId:run.id,objective:run.objective,mode:run.mode,profile:run.profile,...(run.environment&&run.environment!=='default'?{environment:run.environment}:{}),status:run.status,...(run.review?{review:run.review.status,...(run.review.status==='pending'?{reviewNote:'Waiting for a person to approve in the interface (Execuções); the recorded map is unchanged until then.'}:{}),...(run.changes?.items.length?{changes:run.changes.items.slice(0,20).map(i=>`${i.type}: ${i.text}`)}:{})}:{}),...(run.stopReason?{stopReason:run.stopReason}:{}),...(run.result?{result:run.result}:{}),...(run.checks?.length?{checks:run.checks.map(c=>`${c.assertion.type}${c.assertion.value?' '+clip(c.assertion.value,40):''}: ${c.result}`)}:{}),metrics:run.metrics,...(run.coverage?{coverage:run.coverage}:{}),
  steps:run.steps.slice(-80).map((s,i)=>clip(`${Math.max(0,run.steps.length-80)+i} ${s.action.type}${s.transitionId?` "${clip(graph.transitions.find(t=>t.id===s.transitionId)?.name,30)}"`:''} ${name(s.before)??'?'} → ${name(s.after)??'?'}${s.network?.length?' ['+s.network.map(apiLabel).join(', ')+']':''}${s.status==='completed'?'':' '+s.status}${s.error?': '+s.error:''}`,260)),...(errors.length?{errors}:{})};
}

/** The project map an agent needs before acting: screens, how they connect, entries and what is still unknown. */
export function briefMemory(memory){
 const {config,graph}=memory,many=Object.keys(config.targets).length>1,edges=new Map();
 for(const t of graph.transitions){if(!t.confirmed)continue;const from=screenOf(graph,t.from),to=screenOf(graph,t.to);if(!from||!to||from.id===to.id)continue;const key=[from.id,to.id,t.name].join('>');const entry=edges.get(key)??{from,to,via:t.name,apis:new Set()};for(const api of splitApis(graph,t).action)entry.apis.add(`${api.method} ${api.path}`);edges.set(key,entry);}
 return {project:{id:config.id,name:config.name,...(config.description?{description:clip(config.description,300)}:{}),targets:Object.fromEntries(Object.entries(config.targets).map(([id,t])=>[id,t.platform==='android'?`android ${t.package}`:`web ${t.url}`])),profiles:Object.fromEntries(Object.entries(config.profiles).map(([id,p])=>[id,{...(p.description?{description:clip(p.description,120)}:{}),secrets:Object.keys(p.secrets)}])),...(Object.keys(config.environments??{}).length?{environments:Object.fromEntries(Object.entries(config.environments).map(([id,e])=>[id,{...(e.description?{description:clip(e.description,120)}:{}),...entryOf(graph,id,id===Object.keys(config.environments)[0])}]))}:{}),actions:config.permissions.actions,limits:config.limits,repositories:config.repositories.map(r=>r.id)},
  ...(memory.skills.length?{skills:memory.skills}:{}),
  screens:graph.screens.map(s=>({id:short(s.id),name:s.name,...(many?{target:s.target}:{}),...onlyIn(graph,s),...(s.description?{description:clip(s.description,220)}:{}),...(s.sources?.length?{code:s.sources.slice(0,4).map(l=>`${l.repository}:${l.path}${l.line?':'+l.line:''}`)}:{}),...(s.fragment?{fragment:s.fragment}:{}),...(s.header&&s.header!==s.name?{header:s.header}:{}),...(s.deeplinks?.length?{deeplinks:s.deeplinks.map(d=>d.url)}:{}),...(screenApis(graph,s.id).load.length?{loads:screenApis(graph,s.id).load.map(a=>`${a.method} ${a.path}`)}:{})})),
  transitions:[...edges.values()].slice(0,300).map(e=>`${e.from.name} —${clip(e.via,40)}→ ${e.to.name}${e.apis.size?' ['+[...e.apis].slice(0,6).join(', ')+']':''}`),
  // Where each screen and flow starts: what navloom_goto follows, so nothing here needs to be walked by hand.
  ...(()=>{const lines=entryLines(entryPoints(graph));return lines.length?{entryPoints:lines}:{};})(),
  ...(graph.flows?.length?{flows:graph.flows.map(f=>({id:f.id,name:f.name,screens:f.screenIds.map(id=>graph.screens.find(s=>s.id===id)?.name)}))}:{}),
  ...duplicates(graph),
  // API calls that look placed on the wrong screen: usually in one place, a few times elsewhere.
  ...(()=>{const doubts=apiDoubts(graph);return doubts.length?{apiDoubts:doubts.map(d=>`${d.endpoint}: ${d.usualCount}× ${d.usual}, ${d.oddCount}× ${d.odd}`),apiDoubtsHint:'Misplaced? navloom_organize {apis:[{endpoint, screen, role}]} re-places it from evidence.'}:{};})(),
  ...(Object.keys(graph.declaredDeeplinks??{}).length?{declaredDeeplinks:Object.fromEntries(Object.entries(graph.declaredDeeplinks).map(([target,list])=>[target,list.map(d=>d.pattern+(d.match==='prefix'?'*':''))]))}:{}),
  ...(graph.harness?.length?{help:graph.harness.map(h=>`${h.kind}${screenName(graph,h.screenId)}: ${clip(h.question,80)} → ${h.answer?.type==='secretRef'?'secretRef '+h.answer.secretRef:h.answer?.type==='profile'?'profile '+h.answer.profile:clip(h.answer?.value,80)}`)}:{}),
  ...(memory.pendingRequests?.length?{pendingRequests:memory.pendingRequests.map(r=>({id:r.id,kind:r.kind,question:clip(r.question,120)}))}:{}),
  runs:memory.runs.slice(0,10).map(r=>({runId:r.id,objective:clip(r.objective,80),status:r.status,...(r.result?{result:r.result}:{})}))};
}

/** Screens that look alike enough to be one recorded twice. The agent looks and merges, or leaves them apart. */
function duplicates(graph){const pairs=similarScreens(graph,{min:.6,limit:8});return pairs.length?{possibleDuplicates:pairs.map(p=>`${short(p.a)} ${clip(p.names[0],30)} ~ ${short(p.b)} ${clip(p.names[1],30)} ${p.score}${p.shared.length?` (both: ${p.shared.slice(0,4).map(x=>clip(x,20)).join(', ')})`:''}`),duplicatesHint:'Same screen? navloom_merge {into, from:[...]}. Different screens that look alike: leave them.'}:{};}
export function briefStatus(status){
 const {config,graph}=status;
 return {service:status.service,config:config&&{id:config.id,name:config.name,targets:Object.keys(config.targets)},configurationError:status.configurationError,activeRun:status.activeRun,screens:graph.screens.length,transitions:graph.transitions.length,runs:status.runs.length};
}

export function briefFrontier(frontier,graph){
 const groups=new Map();for(const item of frontier){if(item.status!=='pending')continue;const screen=screenOf(graph,item.stateId)?.name??'?';groups.set(screen,[...(groups.get(screen)??[]),clip(item.hint??item.label,40)]);}
 return {pending:frontier.filter(f=>f.status==='pending').length,visited:frontier.filter(f=>f.status==='visited').length,byScreen:Object.fromEntries([...groups].map(([screen,labels])=>[screen,[...new Set(labels)].slice(0,25)]))};
}
