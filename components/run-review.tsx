'use client';
import {Check,CircleDot,Footprints,ScanSearch,Trash2} from 'lucide-react';

type Obj=Record<string,any>;
export const MODE:Record<string,{label:string;help:string}>={
 record:{label:'Gravação',help:'O agente mapeia; o que ele encontrou só entra no mapa depois da sua aprovação.'},
 validate:{label:'Validação',help:'O agente percorre o que está gravado; o que estiver diferente aparece em vermelho.'},
 walk:{label:'Caminhada',help:'Só navegação: nada é gravado nem comparado.'},
};
export const modeOf=(run:Obj)=>MODE[({exploratory:'record',focused:'validate'} as Obj)[run.mode]??run.mode]??{label:run.mode,help:''};
const REVIEW:Record<string,string>={open:'Em andamento',pending:'Aguardando sua aprovação',approved:'Aprovada e gravada',discarded:'Descartada',unchanged:'Igual ao gravado',auto:'Gravada automaticamente',walk:'Nada gravado',none:'Sem comparação'};
const when=(run:Obj)=>{const start=new Date(run.startedAt),end=run.finishedAt||run.updatedAt,seconds=end?Math.max(0,Math.round((Date.parse(end)-start.getTime())/1000)):0;return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}${seconds?` · ${seconds>=60?`${Math.floor(seconds/60)} min ${seconds%60} s`:`${seconds} s`}`:''}`;};
export const runLabel=(run:Obj)=>`${run.objective} · ${modeOf(run).label} · ${when(run)}`;

/**
 * How one execution reads on the map: what it walked, what it found that was not recorded, what contradicts the recording.
 * Older executions carry no comparison; where they went is taken from their own steps.
 */
export function runMarks(run:Obj,graph:Obj){
 const screenOf=new Map<string,string>(graph.states.map((s:Obj)=>[s.id,s.screenId])),items:Obj[]=run.changes?.items??[];
 const screens=new Set<string>(run.changes?.walked.screens??run.observations.map((o:Obj)=>screenOf.get(o.stateId)??o.screenId)),edges=new Set<string>(run.changes?.walked.transitions??run.steps.map((s:Obj)=>s.transitionId).filter(Boolean));
 const pick=(type:string,key:string)=>new Set<string>(items.filter(i=>i.type===type&&i[key]&&(key!=='screenId'||i.kind!=='transition')).map(i=>i[key]));
 const differentEdges=pick('different','transitionId'),newEdges=pick('new','transitionId'),differentScreens=pick('different','screenId'),newScreens=pick('new','screenId');
 // A recorded destination the execution did not reach is part of the difference too.
 const expected=new Set<string>(items.filter(i=>i.expectedTransitionId).map(i=>i.expectedTransitionId));
 return {screens,edges,items,
  screen:(id:string)=>differentScreens.has(id)?'is-different':newScreens.has(id)?'is-new':screens.has(id)?'':'is-unwalked',
  route:(route:Obj)=>{const ids:string[]=route.actionIds??[];return ids.some(id=>differentEdges.has(id))?'is-different':ids.some(id=>expected.has(id))?'is-expected':ids.some(id=>newEdges.has(id))?'is-new':ids.some(id=>edges.has(id))?'':'is-unwalked';}};
}

/** Says, on top of the map, which execution is being looked at, and holds the decision when one is waiting. */
export function RunBanner({run,graph,marks,busy,onDecide}:{run:Obj;graph:Obj;marks:ReturnType<typeof runMarks>;busy:boolean;onDecide:(decision:'approve'|'discard')=>void}){
 const mode=modeOf(run),status=run.review?.status??'none',total=graph.screens.filter((s:Obj)=>s.target===run.target).length,counts=run.changes?.counts??{new:0,different:0};
 const Icon=mode.label==='Validação'?ScanSearch:mode.label==='Caminhada'?Footprints:CircleDot;
 return <section className={'run-banner is-'+status} aria-label="Execução em exibição">
  <div className="run-banner-main"><p className="agent-eyebrow">Você está vendo uma execução</p><h3>{run.objective}</h3>
   <p className="run-banner-meta"><span className="run-mode" title={mode.help}><Icon size={12}/> {mode.label}</span><time dateTime={run.startedAt}>{when(run)}</time><span className={'agent-badge '+run.status}>{run.status}</span><span>{run.steps.length} {run.steps.length===1?'passo':'passos'}</span></p></div>
  <div className="run-banner-facts"><span><b>{marks.screens.size}</b> de {total} telas andadas</span><span className={counts.different?'is-different':''}><b>{counts.different}</b> {counts.different===1?'diferença':'diferenças'}</span><span className={counts.new?'is-new':''}><b>{counts.new}</b> {counts.new===1?'novidade':'novidades'}</span></div>
  <div className="run-banner-decision"><strong>{REVIEW[status]??status}</strong>
   {status==='pending'&&<><p>O mapa gravado não mudou. Aprove para gravar o que esta execução encontrou, ou descarte.</p><span><button className="agent-primary" disabled={busy} onClick={()=>onDecide('approve')}><Check size={14}/> Aprovar e gravar</button><button disabled={busy} onClick={()=>onDecide('discard')}><Trash2 size={13}/> Descartar</button></span></>}
   {status==='walk'&&<p>{mode.help}</p>}{status==='open'&&<p>A comparação aparece quando a missão parar.</p>}</div>
  <ul className="run-legend" aria-label="Legenda"><li><i/> Andado</li><li className="is-unwalked"><i/> Não andado</li><li className="is-different"><i/> Diferente do gravado</li><li className="is-new"><i/> Novo</li></ul>
 </section>;
}

export function RunChanges({marks,onOpenScreen}:{marks:ReturnType<typeof runMarks>;onOpenScreen:(id:string)=>void}){
 if(!marks.items.length)return null;const sorted=[...marks.items].sort((a,b)=>Number(b.type==='different')-Number(a.type==='different'));
 return <section className="run-changes" aria-label="Mudanças desta execução"><h3>O que mudou em relação ao gravado</h3><ul>{sorted.map((item,i)=>{const target=item.screenId??item.toScreen;return <li key={i} className={'is-'+item.type}><span className="run-change-type">{item.type==='different'?'Diferente':'Novo'}</span><p>{item.text}</p>{target&&<button onClick={()=>onOpenScreen(target)}>Ver no mapa</button>}</li>;})}</ul></section>;
}
