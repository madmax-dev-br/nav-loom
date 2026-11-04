'use client';
type Obj = Record<string, any>;
/** A candidate has no destination until a matching interaction has evidence. Hotspots come from the observation or from the state's stored candidates. */
export function AgentActions({observation, graph, runId, visibleKinds, onHighlight, onSelect, onSelectTransition}: {observation:Obj;graph:Obj;runId?:string;visibleKinds:string[];onHighlight:(id:string|null)=>void;onSelect:()=>void;onSelectTransition?:(id:string)=>void}) {
  const elements:Obj[]=observation.elements??[];
  return elements.filter((element:Obj)=>!element.disabled && element.visible!==false && element.actions?.includes('click')).map((element:Obj)=>{
    const edge=graph.transitions.find((transition:Obj)=>transition.confirmed && transition.from===observation.stateId && transition.action.elementIdentity===element.identity && (!runId||transition.evidence.some((e:Obj)=>e.runId===runId)));
    if(!visibleKinds.includes(edge?.kind??'pending'))return null;
    const title=`${element.name} · ${edge?(edge.summary||'Mapped interaction'):'Not mapped — destination unknown'}`;
    return <button key={element.id} data-element-identity={element.identity} className={`agent-hotspot ${edge?'mapped':'unmapped'}`} aria-label={title} title={title}
      onMouseEnter={()=>onHighlight(edge?.id??null)} onMouseLeave={()=>onHighlight(null)} onFocus={()=>onHighlight(edge?.id??null)} onBlur={()=>onHighlight(null)} onClick={()=>{if(edge&&onSelectTransition)onSelectTransition(edge.id);else onSelect();}}
      style={{left:element.bounds.x*100+'%',top:element.bounds.y*100+'%',width:element.bounds.width*100+'%',height:element.bounds.height*100+'%'}}>
      {!edge&&<span className="agent-action-arrow">?</span>}
    </button>;
  });
}
