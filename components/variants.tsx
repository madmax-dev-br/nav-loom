'use client';
import {Layers} from 'lucide-react';
import {apiText} from '@/components/agent-map';

type Obj=Record<string,any>;
export type Variant={profile:string;environment:string};
const envOf=(item:Obj)=>item?.environment??'default';
const named=(id:string)=>id==='default'?'padrão':id;

/**
 * The accounts (profiles) and environments the map has data for. A transition carries the ones it ran in; screens and states
 * remember every one that saw them. Recordings older than that only know their transitions.
 */
export function variantsOf(graph:Obj,config?:Obj){
 const profiles=new Set<string>(),environments=new Set<string>();
 for(const e of graph.transitions??[]){if(e.profile)profiles.add(e.profile);environments.add(envOf(e));}
 for(const item of [...(graph.screens??[]),...(graph.states??[])]){for(const p of item.profiles??[])profiles.add(p);for(const e of item.environments??[])environments.add(e);}
 // A project that declares environments names its default one; transitions recorded before that are in it.
 const first=Object.keys(config?.environments??{})[0];if(first&&environments.delete('default'))environments.add(first);
 return {profiles:[...profiles].sort(),environments:[...environments].sort(),fallback:first??'default'};
}

/** Fades what one account in one environment never reached, using the same marks as an execution. */
export function variantMarks(graph:Obj,{profile,environment}:Variant,fallback='default'){
 const env=(item:Obj)=>{const e=envOf(item);return e==='default'?fallback:e;};
 const transitions=new Map<string,Obj>((graph.transitions??[]).map((e:Obj)=>[e.id,e]));
 const fits=(e:Obj)=>(!profile||e.profile===profile)&&(!environment||env(e)===environment);
 const edges=new Set<string>([...transitions.values()].filter(fits).map(e=>e.id));
 const states=new Set<string>();for(const id of edges){const e=transitions.get(id)!;states.add(e.from);states.add(e.to);}
 const tagged=(item:Obj)=>(!profile||!item.profiles||item.profiles.includes(profile))&&(!environment||!item.environments||item.environments.map((e:string)=>e==='default'?fallback:e).includes(environment));
 const screens=new Set<string>();for(const s of graph.states??[])if(states.has(s.id)||(s.profiles&&tagged(s)))screens.add(s.screenId);
 for(const s of graph.screens??[])if(s.profiles&&tagged(s))screens.add(s.id);
 return {screens,edges,items:[] as Obj[],
  screen:(id:string)=>screens.has(id)?'':'is-unwalked',
  route:(route:Obj)=>((route.actionIds??[]) as string[]).some(id=>edges.has(id))?'':'is-unwalked'};
}

/** Account and environment pickers for the map. Shown only when there is more than one of either. */
export function VariantPicker({graph,config,value,onChange}:{graph:Obj;config?:Obj;value:Variant;onChange:(value:Variant)=>void}){
 const {profiles,environments}=variantsOf(graph,config);
 if(profiles.length<2&&environments.length<2)return null;
 return <div className="variant-picker" role="group" aria-label="Conta e ambiente"><Layers size={13} aria-hidden="true"/>
  {environments.length>1&&<label>Ambiente<select value={value.environment} onChange={e=>onChange({...value,environment:e.target.value})}><option value="">Todos</option>{environments.map(e=><option key={e} value={e}>{named(e)}</option>)}</select></label>}
  {profiles.length>1&&<label>Conta<select value={value.profile} onChange={e=>onChange({...value,profile:e.target.value})}><option value="">Todas</option>{profiles.map(p=><option key={p} value={p}>{named(p)}</option>)}</select></label>}
 </div>;
}

/**
 * For one screen: which accounts and environments reached it, the controls only some of them see, and the calls that
 * answer differently from one to another.
 */
export function ScreenVariants({graph,config,screen}:{graph:Obj;config?:Obj;screen:Obj}){
 const {profiles,environments,fallback}=variantsOf(graph,config);if(profiles.length<2&&environments.length<2)return null;
 const env=(e:string)=>e==='default'?fallback:e,states=(graph.states??[]).filter((s:Obj)=>s.screenId===screen.id);
 const seenEnv=[...new Set<string>((screen.environments??[]).map(env))],seenProfiles:string[]=screen.profiles??[];
 // A control on view only in states some accounts or environments never reached.
 const only:Obj[]=[];const byControl=new Map<string,{label:string;profiles:Set<string>;environments:Set<string>}>();
 for(const s of states)for(const h of s.hotspots??[]){const entry=byControl.get(h.identity)??{label:h.name,profiles:new Set(),environments:new Set()};for(const p of s.profiles??[])entry.profiles.add(p);for(const e of s.environments??[])entry.environments.add(env(e));byControl.set(h.identity,entry);}
 for(const entry of byControl.values()){const p=[...entry.profiles].filter(x=>seenProfiles.includes(x)),e=[...entry.environments].filter(x=>seenEnv.includes(x));
  if(seenProfiles.length>1&&p.length&&p.length<seenProfiles.length)only.push({label:entry.label,where:'conta '+p.map(named).join(', ')});
  else if(seenEnv.length>1&&e.length&&e.length<seenEnv.length)only.push({label:entry.label,where:e.map(named).join(', ')});}
 // The same call answered with different statuses depending on where it ran.
 const ids=new Set(states.map((s:Obj)=>s.id)),calls=new Map<string,Map<string,Set<string>>>();
 for(const t of graph.transitions??[]){if(!ids.has(t.from)&&!ids.has(t.to))continue;const where=[env(envOf(t)),t.profile&&t.profile!=='default'?'conta '+t.profile:''].filter(Boolean).join(' · ');for(const api of t.apis??[]){const key=apiText(api),row=calls.get(key)??new Map();row.set(where,new Set([...(row.get(where)??[]),...(api.statuses??[]).map(String)]));calls.set(key,row);}}
 const differs=[...calls].filter(([,row])=>row.size>1&&new Set([...row.values()].map(set=>[...set].sort().join('/'))).size>1);
 return <section className="screen-variants" aria-label="Contas e ambientes"><h3><Layers size={13}/> Contas e ambientes</h3>
  <p className="screen-variants-seen">{environments.length>1&&<>Vista em {seenEnv.length?seenEnv.map(named).join(', '):'nenhum ambiente registrado'}</>}{environments.length>1&&profiles.length>1&&' · '}{profiles.length>1&&<>contas {seenProfiles.length?seenProfiles.map(named).join(', '):'não registradas'}</>}</p>
  {only.length>0&&<ul className="screen-variants-only">{only.slice(0,12).map(o=><li key={o.label+o.where}><span>{o.label}</span><small>só em {o.where}</small></li>)}</ul>}
  {differs.length>0&&<ul className="agent-api-list">{differs.map(([key,row])=><li key={key}><code>{key}</code><span>{[...row].map(([where,statuses])=>`${where}: ${[...statuses].join('/')||'sem resposta'}`).join(' · ')}</span><small>responde diferente</small></li>)}</ul>}
 </section>;
}
