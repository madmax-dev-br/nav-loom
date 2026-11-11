'use client';
import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {Braces,CornerUpLeft,Keyboard,Layers,Link2,Timer} from 'lucide-react';
import {AgentCanvas} from '@/components/agent-canvas';
import {AgentActions} from '@/components/agent-actions';
import {screenRoutes} from '@/lib/agent-screen-routes';
import {layoutColumns,linkDirection} from '@/lib/agent-map-layout';

type Obj=Record<string,any>;
type Box={x:number;y:number;width:number;height:number};
type Drawing={id:string;path:string;route:Obj;label:{x:number;y:number;side:'left'|'right'}};
const clip=(text:string,max:number)=>text?.length>max?text.slice(0,max-1)+'…':text??'';
export const apiText=(api:Obj)=>`${api.method} ${api.path}`;

/** Keep values in order but at least `gap` apart, inside [min,max] when they fit. */
function spread(items:Obj[],key:string,gap:number,min:number,max:number){
 items.sort((a,b)=>a[key]-b[key]);
 for(let i=1;i<items.length;i++)items[i][key]=Math.max(items[i][key],items[i-1][key]+gap);
 const overflow=items.length?Math.min(items.at(-1)![key]-max,items[0][key]-min):0;
 if(overflow>0)for(const item of items)item[key]-=overflow;
}

function measure(root:HTMLElement,routes:Obj[]):Drawing[]{
 const bounds=root.getBoundingClientRect(),scale=bounds.width/root.offsetWidth||1;
 const rect=(el:Element):Box=>{const r=el.getBoundingClientRect();return {x:(r.left-bounds.left)/scale,y:(r.top-bounds.top)/scale,width:r.width/scale,height:r.height/scale};};
 const cards=new Map<string,HTMLElement>();root.querySelectorAll<HTMLElement>('[data-graph-screen]').forEach(el=>cards.set(el.dataset.graphScreen!,el));
 const items:Obj[]=[];
 for(const route of routes){
  const source=cards.get(route.fromScreen),destination=cards.get(route.toScreen);if(!source||!destination)continue;
  const a=rect(source.querySelector('.agent-image')??source),b=rect(destination.querySelector('.agent-image')??destination);
  let sy=a.y+a.height/2;
  if(route.origin==='interaction'){
   // Leave the card at the height of the control that was used, when that state is on display.
   const shots=[...source.querySelectorAll<HTMLElement>('[data-state-id]')].filter(el=>el.dataset.stateId===route.fromState);
   const hotspot=shots.flatMap(shot=>[...shot.querySelectorAll<HTMLElement>('[data-element-identity]')]).find(el=>el.dataset.elementIdentity===route.elementIdentity);
   if(hotspot){const r=rect(hotspot);sy=r.y+r.height/2;}else if(shots[0]){const r=rect(shots[0]);sy=r.y+r.height/2;}
  }
  // Sides follow where the screens actually sit; the line style says whether it is a return.
  const gap=b.x-a.x;items.push({route,a,b,sy,ey:0,exit:gap<-1?'left':'right',enter:gap>1?'left':'right'});
 }
 const groups=(key:(item:Obj)=>string)=>{const map=new Map<string,Obj[]>();for(const item of items)map.set(key(item),[...(map.get(key(item))??[]),item]);return [...map.values()];};
 for(const group of groups(i=>i.route.fromScreen+i.exit))spread(group,'sy',22,group[0].a.y+12,group[0].a.y+group[0].a.height-12);
 for(const item of items)item.ey=Math.min(Math.max(item.sy,item.b.y+18),item.b.y+item.b.height-18);
 for(const group of groups(i=>i.route.toScreen+i.enter))spread(group,'ey',14,group[0].b.y+18,group[0].b.y+group[0].b.height-18);
 return items.map(({route,a,b,sy,ey,exit,enter})=>{
  const sx=exit==='right'?a.x+a.width:a.x,ex=enter==='left'?b.x:b.x+b.width;let path:string;
  if(exit==='right'&&enter==='left'){const bend=Math.max(48,(ex-sx)*.5);path=`M${sx} ${sy} C${sx+bend} ${sy},${ex-bend} ${ey},${ex} ${ey}`;}
  else if(exit==='left'){const bend=Math.max(48,(sx-ex)*.5);path=`M${sx} ${sy} C${sx-bend} ${sy},${ex+bend} ${ey},${ex} ${ey}`;}
  else{const bulge=70+Math.abs(ey-sy)*.12;path=`M${sx} ${sy} C${sx+bulge} ${sy},${ex+bulge} ${ey},${ex} ${ey}`;}
  return {id:route.id,path,route,label:{x:exit==='right'?sx+14:sx-14,y:sy,side:exit}};
 });
}

function Edges({container,routes,highlighted,onHover,onSelect}:{container:RefObject<HTMLDivElement|null>;routes:Obj[];highlighted:string|null;onHover:(id:string|null)=>void;onSelect:(id:string)=>void}){
 const [state,setState]=useState<{drawings:Drawing[];width:number;height:number}>({drawings:[],width:0,height:0});
 useEffect(()=>{const root=container.current;if(!root)return;let frame=0;
  const run=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setState({drawings:measure(root,routes),width:root.scrollWidth,height:root.scrollHeight}));};
  const observer=new ResizeObserver(run);observer.observe(root);root.querySelectorAll('[data-graph-screen]').forEach(el=>observer.observe(el));run();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();};
 },[container,routes]);
 const active=(d:Drawing)=>!!highlighted&&d.route.actionIds.includes(highlighted);
 const paths=(list:Drawing[],top:boolean)=><svg className={'map-edges '+(top?'is-top':'')} width={state.width} height={state.height} aria-hidden="true">
  <defs>{['idle','back','active'].map(tone=><marker key={tone} id={`map-arrow-${tone}${top?'-top':''}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1.5 1.5L8.5 5L1.5 8.5" className={'map-arrow '+tone}/></marker>)}</defs>
  {list.map(d=>{const tone=top?'active':d.route.direction==='back'?'back':'idle';return <g key={d.id} data-screen-route={d.id} data-direction={d.route.direction}>
   <path d={d.path} className={`map-edge ${tone} ${highlighted&&!top?'is-dimmed':''}`} markerEnd={`url(#map-arrow-${tone}${top?'-top':''})`}/>
   {!top&&<path d={d.path} className="map-edge-hit" onMouseEnter={()=>onHover(d.route.actionIds[0])} onMouseLeave={()=>onHover(null)} onClick={()=>onSelect(d.route.actionIds[0])}/>}
  </g>;})}
 </svg>;
 return <>
  {paths(state.drawings,false)}
  {paths(state.drawings.filter(active),true)}
  <div className="map-labels">{state.drawings.filter(d=>d.route.direction!=='back'||active(d)).map(d=>{const api=d.route.apis?.[0],type=d.route.actionType;
   return <button key={d.id} data-action-id={d.route.actionIds[0]} data-side={d.label.side} className={'map-edge-label '+(active(d)?'is-active':highlighted?'is-dimmed':'')} style={{left:d.label.x,top:d.label.y}} title={[d.route.name,...(d.route.apis??[]).map(apiText)].join('\n')}
    onMouseEnter={()=>onHover(d.route.actionIds[0])} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(d.route.actionIds[0])} onBlur={()=>onHover(null)} onClick={()=>onSelect(d.route.actionIds[0])}>
    {type==='back'?<CornerUpLeft size={11}/>:type==='deeplink'?<Link2 size={11}/>:type==='wait'?<Timer size={11}/>:type==='fill'?<Keyboard size={11}/>:null}
    <span>{clip(type==='wait'?'Automático':type==='back'?'Voltar':d.route.name,30)}</span>
    {api&&<code>{clip(apiText(api),32)}{d.route.apis.length>1?` +${d.route.apis.length-1}`:''}</code>}
   </button>;})}</div>
 </>;
}

export function AgentMap({graph,run,observations,screens,projectId,resetKey,visibleKinds,showReturns,selectedScreen,selectedEdge,onSelectScreen,onSelectEdge}:{graph:Obj;run?:Obj;observations:Obj[];screens:Obj[];projectId:string;resetKey:string;visibleKinds:string[];showReturns:boolean;selectedScreen:string;selectedEdge:string|null;onSelectScreen:(id:string)=>void;onSelectEdge:(id:string|null)=>void}){
 const container=useRef<HTMLDivElement>(null),[hovered,setHovered]=useState<string|null>(null),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const highlighted=selectedEdge??hovered;
 const idKey=screens.map(s=>s.id).join(),ids=useMemo(()=>idKey.split(',').filter(Boolean),[idKey]);
 const {columns,routes,index}=useMemo(()=>{
  // A deeplink can be opened from anywhere, so it is shown as an entry of its screen, not as a path from where it happened to be used.
  const all:Obj[]=screenRoutes(graph,run?.id,visibleKinds,ids).filter((route:Obj)=>route.actionType!=='deeplink');
  // Depth comes from forward taps only: the system back button says nothing about where a screen belongs.
  const layout=layoutColumns(ids,all.filter(route=>route.actionType!=='back') as any);
  const directed:Obj[]=all.map((route:Obj)=>({...route,direction:route.actionType==='back'?'back':linkDirection(layout.depth,route as any)})).filter((route:Obj)=>showReturns||route.direction!=='back');
  return {columns:layout.columns,routes:directed,index:new Map(ids.map((id,i)=>[id,i+1]))};
 },[graph,run?.id,visibleKinds,ids,showReturns]);
 const active=routes.find((r:Obj)=>highlighted&&r.actionIds.includes(highlighted));
 // One capture per distinct state and scroll position, most recent last.
 const captures=(id:string)=>observations.filter(o=>o.screenId===id).filter((o,i,all)=>!all.slice(i+1).some(x=>x.stateId===o.stateId&&JSON.stringify(x.scroll)===JSON.stringify(o.scroll)));
 const byId=new Map(screens.map(s=>[s.id,s]));
 return <AgentCanvas container={container} resetKey={resetKey}>
  <Edges container={container} routes={routes} highlighted={highlighted} onHover={setHovered} onSelect={id=>{onSelectEdge(id);const route=routes.find((r:Obj)=>r.actionIds.includes(id));if(route)onSelectScreen(route.toScreen);}}/>
  {columns.map((column,depth)=><div className="map-column" key={depth}>{column.map(id=>{
   const s=byId.get(id)!,shots=captures(id),visible=expanded[id]?shots:shots.slice(-1),portrait=(shots.at(-1)?.viewport?.height??0)>(shots.at(-1)?.viewport?.width??1);
   const states=graph.states.filter((v:Obj)=>v.screenId===id).length,apis=new Set(routes.filter((r:Obj)=>r.toScreen===id||r.fromScreen===id).flatMap((r:Obj)=>r.apis.map(apiText)));
   const dim=!!active&&active.fromScreen!==id&&active.toScreen!==id;
   return <article key={id} data-graph-screen={id} className={`map-card ${portrait?'is-portrait':''} ${selectedScreen===id?'selected':''} ${dim?'is-dim':''}`}>
    <button className="map-card-title" onClick={()=>{onSelectEdge(null);onSelectScreen(id);}}><span>{index.get(id)}</span><strong>{s.name}</strong>{s.deeplinks?.length>0&&<em title="Tela com entrada por deeplink"><Link2 size={11}/> entrada</em>}</button>
    {visible.length?visible.map(o=><div key={o.id} className="map-shot"><div className="agent-image" data-capture={o.id} data-state-id={o.stateId}>
      <img src={'/__navloom/agent/resource?path='+encodeURIComponent(o.screenshot)+'&project='+encodeURIComponent(projectId)} alt={`${s.name}, captura de ${new Date(o.capturedAt).toLocaleString()}`} draggable={false}/>
      <AgentActions observation={o} graph={graph} run={run} visibleKinds={visibleKinds} onHighlight={setHovered} selectedEdge={selectedEdge} highlightedEdge={highlighted} onSelect={edge=>{onSelectEdge(edge);onSelectScreen(id);}}/>
     </div>{visible.length>1&&<small>{o.scrollOfState?'Mesmo estado, após scroll':o.stateKey||graph.states.find((v:Obj)=>v.id===o.stateId)?.name}</small>}</div>)
     :<p className="map-card-empty">Sem captura nesta execução</p>}
    <footer>
     {shots.length>1&&<button aria-expanded={!!expanded[id]} onClick={()=>setExpanded(old=>({...old,[id]:!old[id]}))} title="Estados e scrolls capturados"><Layers size={12}/>{expanded[id]?'Recolher':`${shots.length} capturas`}</button>}
     {shots.length<=1&&states>1&&<span title="Estados conhecidos desta tela"><Layers size={12}/>{states} estados</span>}
     {s.deeplinks?.length>0&&<span title={s.deeplinks.map((d:Obj)=>d.url).join('\n')}><Link2 size={12}/>{clip(s.deeplinks[0].url,26)}</span>}
     {apis.size>0&&<span title={[...apis].join('\n')}><Braces size={12}/>{apis.size} API{apis.size>1?'s':''}</span>}
    </footer>
   </article>;})}</div>)}
 </AgentCanvas>;
}
