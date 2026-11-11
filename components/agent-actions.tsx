'use client';
type Obj = Record<string, any>;
/** A candidate has no destination until a matching interaction has evidence. */
export function AgentActions({observation, graph, run, visibleKinds, onHighlight, onSelect, selectedEdge, highlightedEdge, focusIdentity}: {observation:Obj;graph:Obj;run?:Obj;visibleKinds:string[];onHighlight:(id:string|null)=>void;selectedEdge?:string|null;highlightedEdge?:string|null;focusIdentity?:string;onSelect:(id:string|null)=>void}) {
  return observation.elements.filter((element:Obj)=>!element.disabled && element.visible && element.actions?.includes('click')).map((element:Obj)=>{
    const edge=graph.transitions.find((transition:Obj)=>transition.confirmed && transition.from===observation.stateId && transition.action.elementIdentity===element.identity && (!run||transition.evidence.some((e:Obj)=>e.runId===run.id)));
    const box={left:element.bounds.x*100+'%',top:element.bounds.y*100+'%',width:element.bounds.width*100+'%',height:element.bounds.height*100+'%'};
    // A control pointed at from the details panel is outlined even while its kind is filtered out of the map.
    if(!visibleKinds.includes(edge?.kind??'pending'))return element.identity===focusIdentity?<span key={element.id} className="agent-hotspot is-focus" style={box} aria-hidden="true"/>:null;
    const name=element.label||element.name,title=`${name} · ${edge?'Interação mapeada':'Ainda não mapeada — destino desconhecido'}`;
    return <button key={element.id} data-element-identity={element.identity} data-action-id={edge?.id} aria-pressed={!!edge&&selectedEdge===edge.id} className={`agent-hotspot ${edge?'mapped':'unmapped'} ${edge&&highlightedEdge===edge.id?'is-active':''} ${element.identity===focusIdentity?'is-focus':''}`} aria-label={title} title={title}
      onMouseEnter={()=>onHighlight(edge?.id??null)} onMouseLeave={()=>onHighlight(null)} onFocus={()=>onHighlight(edge?.id??null)} onBlur={()=>onHighlight(null)} onClick={()=>onSelect(edge?.id??null)}
      style={box}>
      {!edge&&<span className="agent-action-arrow">?</span>}
    </button>;
  });
}
