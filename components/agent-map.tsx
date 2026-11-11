'use client';
import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {ArrowUpRight,Braces,ChevronsDown,ChevronsUp,CornerUpLeft,Keyboard,Link2,RefreshCw,Timer} from 'lucide-react';
import {AgentCanvas} from '@/components/agent-canvas';
import {AgentActions} from '@/components/agent-actions';
import {screenRoutes} from '@/lib/agent-screen-routes';
import {layoutColumns,linkDirection} from '@/lib/agent-map-layout';
import {screenApis} from '@/lib/api-role.mjs';

type Obj=Record<string,any>;
type Box={x:number;y:number;width:number;height:number};
const clip=(text:string,max:number)=>text?.length>max?text.slice(0,max-1)+'…':text??'';
export const apiText=(api:Obj)=>`${api.method} ${api.path}`;
type Label={x:number;y:number;side:'left'|'right';kind:'plain'|'exit'|'block'|'state'|'status'|'load';data?:Obj};
type Drawing={id:string;path:string;route:Obj;labels:Label[];arrow:boolean;origin?:{path:string;x:number;y:number}};
/** Width of an action block, fixed so its outcomes can branch from a known point. */
const BLOCK_WIDTH=190,STATE_ROW=30;
/** The calls a screen makes on arrival sit in a block right before it; incoming arrows pass through that block. */
const LOAD_WIDTH=156,LOAD_GAP=22,LOAD_LINE=16;
const loadHeight=(route:Obj)=>22+route.apis.length*LOAD_LINE;
/** Height a connection label takes: one line for the action, a second when it shows an API call or another flow. */
const labelHeight=(route:Obj)=>route.exitFlow||route.apis?.length?40:route.block?24:10;
/** Room a route needs beside the card. An action block also carries one row per state it can lead to, below it. */
const routeHeight=(route:Obj)=>route.block?labelHeight(route)+2*route.states.length*STATE_ROW:labelHeight(route);
/**
 * Keep values in order and far enough apart that what is drawn at each one cannot overlap.
 * `size` is the height drawn around a value; neighbours are separated by half of each plus a margin.
 * The group is then centred back on where it wanted to be, limited to [min,max] when it fits there.
 */
function spread(items:Obj[],key:string,size:(item:Obj)=>number,min:number,max:number){
 items.sort((a,b)=>a[key]-b[key]);
 const wanted=items.map(item=>item[key]);
 for(let i=1;i<items.length;i++)items[i][key]=Math.max(items[i][key],items[i-1][key]+(size(items[i-1])+size(items[i]))/2+6);
 if(!items.length)return;
 // Pushing only downwards drifts the group; shift it so the average displacement is zero.
 let shift=items.reduce((sum,item,i)=>sum+item[key]-wanted[i],0)/items.length;
 const first=items[0][key]-shift,last=items.at(-1)![key]-shift;
 if(last-first<=max-min){if(first<min)shift-=min-first;else if(last>max)shift+=last-max;}
 for(const item of items)item[key]-=shift;
}

function measure(root:HTMLElement,routes:Obj[]):Drawing[]{
 const bounds=root.getBoundingClientRect(),scale=bounds.width/root.offsetWidth||1;
 const rect=(el:Element):Box=>{const r=el.getBoundingClientRect();return {x:(r.left-bounds.left)/scale,y:(r.top-bounds.top)/scale,width:r.width/scale,height:r.height/scale};};
 const cards=new Map<string,HTMLElement>();root.querySelectorAll<HTMLElement>('[data-graph-screen]').forEach(el=>cards.set(el.dataset.graphScreen!,el));
 const items:Obj[]=[];
 const loads=new Map<string,Obj>();
 for(const route of routes){
  if(route.load){const card=cards.get(route.toScreen);if(card)loads.set(route.toScreen,{route,b:rect(card.querySelector('.agent-image')??card),y:0});continue;}
  // Exits and action blocks have a source card only; their destinations are drawn as chips.
  const open=route.exitFlow||route.block,source=cards.get(route.fromScreen),destination=open?undefined:cards.get(route.toScreen);if(!source||(!destination&&!open))continue;
  const a=rect(source.querySelector('.agent-image')??source),b=destination?rect(destination.querySelector('.agent-image')??destination):null;
  // A scroll is not a control: its arrow leaves from the lower part of the screen, where the content continues.
  let sy=route.actionType==='scroll'?a.y+a.height*.82:a.y+a.height/2,origin:{x:number;y:number}|undefined;
  if(route.origin==='interaction'){
   // Leave the card at the height of the control that was used, when that state is on display.
   const shots=[...source.querySelectorAll<HTMLElement>('[data-state-id]')].filter(el=>route.fromStates.includes(el.dataset.stateId));
   const hotspot=shots.flatMap(shot=>[...shot.querySelectorAll<HTMLElement>('[data-element-identity]')]).find(el=>el.dataset.elementIdentity===route.elementIdentity);
   if(hotspot){const r=rect(hotspot);sy=r.y+r.height/2;origin={x:r.x+r.width/2,y:sy};}else if(shots[0]){const r=rect(shots[0]);sy=r.y+r.height/2;}
  }
  if(!b){items.push({route,a,b,sy,ey:0,exit:'right',enter:'none',origin});continue;}
  // Sides follow where the screens actually sit; the line style says whether it is a return.
  const gap=b.x-a.x;items.push({route,a,b,sy,ey:0,exit:gap<-1?'left':'right',enter:gap>1?'left':'right',origin});
 }
 // An outcome that continues to the right starts at its action block; anything else is drawn on its own.
 const blocks=new Map<string,Obj>();for(const item of items)if(item.route.block)blocks.set(item.route.id,item);
 const follows=(item:Obj)=>item.route.group&&item.exit==='right'&&blocks.has(item.route.group);
 const groups=(list:Obj[],key:(item:Obj)=>string)=>{const map=new Map<string,Obj[]>();for(const item of list)map.set(key(item),[...(map.get(key(item))??[]),item]);return [...map.values()];};
 for(const group of groups(items.filter(i=>!follows(i)),i=>i.route.fromScreen+i.exit))spread(group,'sy',item=>routeHeight(item.route),group[0].a.y+12,group[0].a.y+group[0].a.height-12);
 for(const item of items)if(follows(item))item.sy=blocks.get(item.route.group)!.sy;
 // Arrows arriving from the left end at the destination's load block, when it has one, instead of at the screen.
 for(const [screenId,load] of loads){
  const incoming=items.filter(i=>i.b&&i.enter==='left'&&i.route.toScreen===screenId).sort((x,y)=>x.sy-y.sy),half=loadHeight(load.route)/2,room=load.route.states.length*STATE_ROW;
  // A screen is always entered at its vertical centre, so the block and every arriving arrow line up there.
  load.y=load.b.y+load.b.height/2;void half;void room;
  incoming.forEach(item=>{item.viaLoad=true;item.ex=load.b.x-LOAD_GAP-LOAD_WIDTH;item.ey=load.y;});
 }
 for(const item of items)if(item.b&&!item.viaLoad)item.ey=item.b.y+item.b.height/2;
 // One curve shape per pair of sides: straight across, back across, or looping out and in on the right.
 const curve=(sx:number,sy:number,ex:number,ey:number,exit:string,enter:string)=>{
  if(exit==='right'&&enter==='left'){const bend=Math.max(24,(ex-sx)*.5);return `M${sx} ${sy} C${sx+bend} ${sy},${ex-bend} ${ey},${ex} ${ey}`;}
  if(exit==='left'){const bend=Math.max(24,(sx-ex)*.5);return `M${sx} ${sy} C${sx-bend} ${sy},${ex+bend} ${ey},${ex} ${ey}`;}
  const bulge=70+Math.abs(ey-sy)*.12;return `M${sx} ${sy} C${sx+bulge} ${sy},${ex+bulge} ${ey},${ex} ${ey}`;
 };
 // A control that does something shows it: the line starts at the middle of the control, over the screenshot, and leaves by the nearest side.
 const fromControl=(item:Obj)=>{if(!item.origin||follows(item))return undefined;const {origin,a,sy,exit}=item,edge=exit==='left'?a.x:a.x+a.width,dir=exit==='left'?-1:1,turn=edge-dir*18;
  return {x:origin.x,y:origin.y,path:`M${origin.x} ${origin.y} L${dir*(turn-origin.x)>0?turn:origin.x} ${origin.y} C${edge-dir*6} ${origin.y},${edge-dir*12} ${sy},${edge} ${sy}`};};
 const drawn=items.map((item):Drawing=>({...draw(item),origin:fromControl(item)}));
 function draw(item:Obj):Drawing{
  const {route,a,b,sy,ey,exit,enter}=item,right=a.x+a.width,near=right+24,far=near+BLOCK_WIDTH;
  if(route.exitFlow)return {id:route.id,path:`M${right} ${sy} L${right+38} ${sy}`,route,arrow:true,labels:[{x:right+46,y:sy,side:'right',kind:'exit'}]};
  if(route.block&&!route.apis.length){
   // Nothing is called: no block, just arrows from the control to the states it leads to.
   const continues=items.some(other=>other.route.group===route.id),labels:Label[]=[],lines:string[]=[];
   route.states.forEach((state:Obj,i:number)=>{const y=continues?sy+(i+1)*STATE_ROW:sy+(i-(route.states.length-1)/2)*STATE_ROW;lines.push(`M${right} ${sy} C${right+14} ${sy},${right+10} ${y},${right+24} ${y}`);labels.push({x:right+26,y,side:'right',kind:'state',data:state});});
   return {id:route.id,path:lines.join(' '),route,arrow:false,labels};
  }
  if(route.block){
   // The action as a block; below it, one arrow per state of this same screen it can lead to.
   const half=labelHeight(route)/2,labels:Label[]=[{x:near,y:sy,side:'right',kind:'block'}],lines=[`M${right} ${sy} L${near} ${sy}`];
   route.states.forEach((state:Obj,i:number)=>{const y=sy+half+18+i*STATE_ROW;lines.push(`M${near+14} ${sy+half} L${near+14} ${y-6} Q${near+14} ${y},${near+20} ${y} L${near+28} ${y}`);labels.push({x:near+30,y,side:'right',kind:'state',data:state});});
   return {id:route.id,path:lines.join(' '),route,arrow:false,labels};
  }
  if(follows(item)){const start=blocks.get(route.group)!.route.apis.length?far:right,badge=route.statusText?[{x:start+8,y:sy-11,side:'right' as const,kind:'status' as const}]:[];return {id:route.id,path:curve(start,sy,item.viaLoad?item.ex:b.x,ey,'right',enter),route,arrow:true,labels:badge};}
  const sx=exit==='right'?right:a.x,ex=item.viaLoad?item.ex:enter==='left'?b.x:b.x+b.width;
  // An action that calls nothing is just the arrow; its name shows on hover and in the details.
  return {id:route.id,path:curve(sx,sy,ex,ey,exit,enter),route,arrow:true,labels:route.apis?.length?[{x:exit==='right'?sx+14:sx-14,y:sy,side:exit,kind:'plain'}]:[]};
 }
 // The load block itself: its calls, a short arrow into the screen, and below it the states the screen can arrive in.
 for(const {route,b,y} of loads.values()){
  const left=b.x-LOAD_GAP-LOAD_WIDTH,half=loadHeight(route)/2,labels:Label[]=[{x:left,y,side:'right',kind:'load'}],lines:string[]=[];
  route.states.forEach((state:Obj,i:number)=>{const cy=y+half+18+i*STATE_ROW;lines.push(`M${left+14} ${y+half} L${left+14} ${cy-6} Q${left+14} ${cy},${left+20} ${cy} L${left+28} ${cy}`);labels.push({x:left+30,y:cy,side:'right',kind:'state',data:state});});
  drawn.push({id:route.id,path:`M${b.x-LOAD_GAP} ${y} L${b.x} ${y}`,route,arrow:true,labels:[labels[0]]});
  if(lines.length)drawn.push({id:route.id+'|states',path:lines.join(' '),route:{...route,block:true},arrow:false,labels:labels.slice(1)});
 }
 return drawn;
}

function Edges({container,routes,highlighted,onHover,onSelect,onExit,onState}:{container:RefObject<HTMLDivElement|null>;routes:Obj[];highlighted:string|null;onHover:(id:string|null)=>void;onSelect:(id:string)=>void;onExit:(route:Obj)=>void;onState:(screenId:string,stateId:string)=>void}){
 const [state,setState]=useState<{drawings:Drawing[];width:number;height:number}>({drawings:[],width:0,height:0});
 useEffect(()=>{const root=container.current;if(!root)return;let frame=0;
  const run=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setState({drawings:measure(root,routes),width:root.scrollWidth,height:root.scrollHeight}));};
  const observer=new ResizeObserver(run);observer.observe(root);root.querySelectorAll('[data-graph-screen]').forEach(el=>observer.observe(el));root.querySelectorAll('img').forEach(img=>img.addEventListener('load',run,{once:true}));run();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();};
 },[container,routes]);
 const active=(d:Drawing)=>!!highlighted&&!d.route.exitFlow&&!d.route.load&&d.route.actionIds.includes(highlighted);
 const icon=(type:string,direction?:string)=>type==='scroll'?(direction==='up'?<ChevronsUp size={12}/>:<ChevronsDown size={12}/>):type==='back'?<CornerUpLeft size={11}/>:type==='deeplink'?<Link2 size={11}/>:type==='wait'?<Timer size={11}/>:type==='fill'?<Keyboard size={11}/>:null;
 const paths=(list:Drawing[],top:boolean)=><svg className={'map-edges '+(top?'is-top':'')} width={state.width} height={state.height} aria-hidden="true">
  <defs>{['idle','back','active','exit','state','load'].map(tone=><marker key={tone} id={`map-arrow-${tone}${top?'-top':''}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1.5 1.5L8.5 5L1.5 8.5" className={'map-arrow '+tone}/></marker>)}</defs>
  {list.map(d=>{const tone=top?'active':d.route.exitFlow?'exit':d.route.block?'state':d.route.load?'load':d.route.direction==='back'?'back':'idle';return <g key={d.id} data-screen-route={d.id} data-direction={d.route.direction}>
   <path d={d.path} className={`map-edge ${tone} ${highlighted&&!top?'is-dimmed':''}`} markerEnd={d.arrow?`url(#map-arrow-${tone}${top?'-top':''})`:undefined}/>
   {!top&&!d.route.exitFlow&&!d.route.block&&!d.route.load&&<path d={d.path} className="map-edge-hit" onMouseEnter={()=>onHover(d.route.actionIds[0])} onMouseLeave={()=>onHover(null)} onClick={()=>onSelect(d.route.actionIds[0])}><title>{d.route.actionType==='wait'?'Transição automática':d.route.actionType==='back'?'Voltar':d.route.name}</title></path>}
  </g>;})}
 </svg>;
 return <>
  {paths(state.drawings,false)}
  {paths(state.drawings.filter(active),true)}
  <svg className="map-origins" width={state.width} height={state.height} aria-hidden="true">{state.drawings.filter(d=>d.origin&&(d.route.direction!=='back'||active(d))).map(d=><g key={d.id} className={active(d)?'is-active':highlighted?'is-dimmed':''}><path d={d.origin!.path}/><circle cx={d.origin!.x} cy={d.origin!.y} r="3.5"/></g>)}</svg>
  <div className="map-labels">{state.drawings.filter(d=>d.route.direction!=='back'||active(d)).flatMap(d=>d.labels.map((label,i)=>{const route=d.route,api=route.apis?.[0],type=route.actionType,actionId=route.actionIds[0],key=d.id+':'+i,at={left:label.x,top:label.y},dimmed=highlighted&&!active(d)?'is-dimmed':'';
   if(label.kind==='exit')return <button key={key} className={'map-edge-label map-exit-label '+dimmed} style={at} title={`“${route.name}” leva a ${route.toName}, no fluxo ${route.exitFlow.name}`} aria-label={`Ir para o fluxo ${route.exitFlow.name} por ${route.name}`} onClick={()=>onExit(route)}><ArrowUpRight size={12}/><span>{clip(route.exitFlow.name,26)}</span><code>{clip(route.name,30)} → {clip(route.toName,18)}</code></button>;
   if(label.kind==='load')return <div key={key} className={'map-load-block '+dimmed} style={{...at,width:LOAD_WIDTH}} title={`Ao entrar em ${route.toName}, o app chama:\n${route.apis.map(apiText).join('\n')}`}><small>ao entrar</small>{route.apis.map((a:Obj)=><code key={apiText(a)}>{clip(apiText(a),24)}</code>)}</div>;
   if(label.kind==='status')return <span key={key} className={'map-status '+dimmed} style={at} title={`Resposta ${route.statusText} leva a ${route.toName}`}>{route.statusText}</span>;
   if(label.kind==='state'){const target=label.data!;return <button key={key} data-action-id={target.actionIds[0]} className={'map-state-chip '+(highlighted&&target.actionIds.includes(highlighted)?'is-active':dimmed)} style={at} title={`“${route.name}” deixa a tela no estado “${target.name}”${target.statusText?` (resposta ${target.statusText})`:''}. Clique para ver esse estado.`} aria-label={`Ver o estado ${target.name}`}
    onMouseEnter={()=>onHover(target.actionIds[0])} onMouseLeave={()=>onHover(null)} onClick={()=>onState(route.fromScreen,target.id)}>{route.actionType==='scroll'?(route.scrollDirection==='up'?<ChevronsUp size={11}/>:<ChevronsDown size={11}/>):<RefreshCw size={10}/>}{target.statusText&&<b>{target.statusText}</b>}<span>{clip(target.name,18)}</span></button>;}
   const name=type==='wait'?'Automático':type==='back'?'Voltar':type==='scroll'?(route.scrollDirection==='up'?'Rolar para cima':'Rolar para baixo'):route.name,block=label.kind==='block';
   return <button key={key} data-action-id={actionId} data-side={label.side} className={`map-edge-label ${block?'is-block':''} ${active(d)?'is-active':dimmed}`} style={block?{...at,width:BLOCK_WIDTH}:at} title={[route.name,...(route.apis??[]).map(apiText)].join('\n')}
    onMouseEnter={()=>onHover(actionId)} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(actionId)} onBlur={()=>onHover(null)} onClick={()=>onSelect(actionId)}>
    {icon(type,route.scrollDirection)}<span>{clip(name,block?24:30)}</span>
    {api&&<code>{clip(apiText(api),block?26:32)}{route.apis.length>1?` +${route.apis.length-1}`:''}</code>}
   </button>;}))}</div>
 </>;
}

/** Every screen shows one state at a time: the one picked in its selector, or the most recently captured. */
export function displayStates(ids:string[],observations:Obj[],graph:Obj,chosen:Record<string,string>){
 const map=new Map<string,{states:Obj[];current?:Obj}>();
 for(const id of ids){const states:Obj[]=[];
  for(const o of observations){if(o.screenId!==id)continue;const known=states.find(x=>x.id===o.stateId);if(known)known.capture=o;else states.push({id:o.stateId,capture:o,name:graph.states.find((v:Obj)=>v.id===o.stateId)?.name||o.stateKey||'estado'});}
  // Different states can carry the same declared name (a form before and after typing); number them so each can be picked.
  for(const state of states){const same=states.filter(x=>x.name===state.name);state.label=same.length>1?`${state.name} · ${same.indexOf(state)+1}`:state.name;}
  // By default a screen shows its clean state: the most recently captured one that is neither scrolled nor covered by the keyboard.
  const derived=(state:Obj)=>{const record=graph.states.find((v:Obj)=>v.id===state.id);return !!(record?.scrollOf||record?.keyboard);},latest=(list:Obj[])=>list.slice().sort((a,b)=>String(a.capture.capturedAt).localeCompare(String(b.capture.capturedAt))).at(-1);
  map.set(id,{states,current:states.find(x=>x.id===chosen[id])??latest(states.filter(x=>!derived(x)))??latest(states)});}
 return map;
}

export function AgentMap({graph,run,observations,screens,projectId,resetKey,visibleKinds,showReturns,selectedScreen,selectedEdge,onSelectScreen,onSelectEdge,flowId,onExitFlow,chosenStates:chosen,onChooseState,focus}:{chosenStates:Record<string,string>;onChooseState:(screenId:string,stateId:string)=>void;focus?:{screenId:string;identity:string}|null;graph:Obj;run?:Obj;flowId?:string;onExitFlow?:(exit:{flow:Obj;via:string;toScreen:string;toName:string;fromName:string})=>void;observations:Obj[];screens:Obj[];projectId:string;resetKey:string;visibleKinds:string[];showReturns:boolean;selectedScreen:string;selectedEdge:string|null;onSelectScreen:(id:string)=>void;onSelectEdge:(id:string|null)=>void}){
 const container=useRef<HTMLDivElement>(null),[hovered,setHovered]=useState<string|null>(null);
 const highlighted=selectedEdge??hovered;
 const idKey=screens.map(s=>s.id).join(),ids=useMemo(()=>idKey.split(',').filter(Boolean),[idKey]);
 const display=useMemo(()=>displayStates(ids,observations,graph,chosen),[ids,observations,graph,chosen]);
 const {columns,routes,index}=useMemo(()=>{
  const screenOf=(stateId:string)=>graph.states.find((x:Obj)=>x.id===stateId)?.screenId,statusOf=(apis:Obj[])=>[...new Set(apis.flatMap(a=>a.statuses??[]))].join('/');
  const control=(route:Obj)=>route.origin==='automatic'?'automatic':route.elementIdentity??route.name;
  // A deeplink can be opened from anywhere, so it is shown as an entry of its screen, not as a path from where it happened to be used.
  // The same control leading to the same screen from several states is one connection; it leaves from whichever of those states is on display.
  const merged=new Map<string,Obj>();
  for(const route of screenRoutes(graph,run?.id,visibleKinds,ids) as Obj[]){
   if(route.actionType==='deeplink')continue;
   const key=[route.fromScreen,route.toScreen,route.actionType,control(route)].join('|'),same=merged.get(key),shown=display.get(route.fromScreen)?.current?.id===route.fromState;
   if(!same){merged.set(key,{...route,fromStates:[route.fromState],actionIds:[...route.actionIds],apis:[...route.apis],shown});continue;}
   same.fromStates.push(route.fromState);same.evidence=[...same.evidence,...route.evidence];
   // What is drawn (hover, selection, calls) is the variant of the state on display.
   if(shown&&!same.shown){same.actionIds=[...route.actionIds,...same.actionIds];same.apis=[...route.apis];same.shown=true;}else same.actionIds.push(...route.actionIds);
  }
  const all:Obj[]=[...merged.values()];
  // Depth comes from forward taps only: the system back button says nothing about where a screen belongs.
  const layout=layoutColumns(ids,all.filter(route=>route.actionType!=='back') as any);
  const directed:Obj[]=all.map((route:Obj)=>({...route,direction:route.actionType==='back'?'back':linkDirection(layout.depth,route as any)})).filter((route:Obj)=>showReturns||route.direction!=='back');
  // Flowchart of an action: when a control of the state on display can also leave the screen in another state
  // (any state: an error, a loading step, a filled form), it becomes a block whose outcomes branch from it.
  const blocks:Obj[]=[];
  if(visibleKinds.includes('state')||visibleKinds.includes('scroll'))for(const id of ids){const current=display.get(id)?.current;if(!current)continue;const byControl=new Map<string,Obj>();
   for(const t of graph.transitions){
    if(!t.confirmed||!['state','scroll'].includes(t.kind)||!visibleKinds.includes(t.kind)||t.from!==current.id||t.to===t.from||screenOf(t.to)!==id||(run&&!t.evidence.some((e:Obj)=>e.runId===run.id)))continue;
    // Scrolling is drawn like any other action: an arrow, the calls it triggered if any, and the scrolled state at its tip.
    const automatic=t.action?.type==='wait',scrolling=t.action?.type==='scroll',key=scrolling?`scroll:${t.action.direction??'down'}`:automatic?'automatic':t.action?.elementIdentity??t.name,target=display.get(id)!.states.find(x=>x.id===t.to);
    const block=byControl.get(key)??{id:`block|${id}|${key}`,block:true,fromScreen:id,toScreen:id,fromStates:[current.id],origin:automatic||scrolling?'automatic':'interaction',elementIdentity:t.action?.elementIdentity,name:t.name,actionType:t.action?.type,scrollDirection:t.action?.direction,apis:[],actionIds:[],states:[],direction:'state'};
    for(const api of t.apis??[])if(!block.apis.some((a:Obj)=>a.method===api.method&&a.path===api.path))block.apis.push(api);
    block.actionIds.push(t.id);block.states.push({id:t.to,name:target?.label??graph.states.find((x:Obj)=>x.id===t.to)?.name??'estado',statusText:statusOf(t.apis??[]),actionIds:[t.id],captured:!!target});byControl.set(key,block);
   }
   for(const [key,block] of byControl){
    // Screens reached by the same control continue from the block, each tagged with the response that led there.
    for(const route of directed)if(route.fromScreen===id&&route.direction!=='back'&&control(route)===key&&route.shown){route.group=block.id;route.statusText=statusOf(route.apis);route.toName=graph.screens.find((s:Obj)=>s.id===route.toScreen)?.name;for(const api of route.apis)if(!block.apis.some((a:Obj)=>a.method===api.method&&a.path===api.path))block.apis.push(api);}
    blocks.push(block);}
  }
  // What a screen calls on arrival, drawn as a block right before it, with the states it has been seen arriving in.
  const loadBlocks:Obj[]=[];
  for(const id of ids){const load=screenApis(graph,id).load;if(!load.length)continue;const arrivals=new Map<string,Obj>();
   for(const t of graph.transitions){if(!t.confirmed||screenOf(t.to)!==id||screenOf(t.from)===id||(run&&!t.evidence.some((e:Obj)=>e.runId===run.id)))continue;
    const target=display.get(id)?.states.find(x=>x.id===t.to),arrival=arrivals.get(t.to)??{id:t.to,name:target?.label??graph.states.find((x:Obj)=>x.id===t.to)?.name??'estado',statusText:'',actionIds:[]};
    arrival.actionIds.push(t.id);arrival.statusText=statusOf([...(t.apis??[]).filter((a:Obj)=>a.method==='GET'),...(arrival.statusText?[{statuses:arrival.statusText.split('/')}]:[])]);arrivals.set(t.to,arrival);}
   loadBlocks.push({id:`load|${id}`,load:true,fromScreen:id,toScreen:id,toName:graph.screens.find((s:Obj)=>s.id===id)?.name,apis:load,actionIds:[],states:arrivals.size>1?[...arrivals.values()]:[],direction:'load'});}
  // With a flow on display, a tap that lands on a screen of another flow becomes an exit pointing out of the map.
  const exits:Obj[]=[];
  if(flowId){const shown=new Set(ids),names=new Map<string,string>(graph.screens.map((s:Obj)=>[s.id,s.name]));
   for(const route of screenRoutes(graph,run?.id,['navigation'],graph.screens.map((s:Obj)=>s.id)) as Obj[]){
    if(!shown.has(route.fromScreen)||shown.has(route.toScreen)||['back','deeplink'].includes(route.actionType))continue;
    for(const flow of graph.flows??[])if(flow.id!==flowId&&flow.screenIds.includes(route.toScreen)&&!exits.some(e=>e.exitFlow.id===flow.id&&e.fromScreen===route.fromScreen&&e.name===route.name))exits.push({...route,fromStates:[route.fromState],id:`exit-${route.id}-${flow.id}`,exitFlow:flow,direction:'exit',toName:names.get(route.toScreen)??'',fromName:names.get(route.fromScreen)??''});
   }}
  return {columns:layout.columns,routes:[...directed,...blocks,...loadBlocks,...exits],index:new Map(ids.map((id,i)=>[id,i+1]))};
 },[graph,run,visibleKinds,ids,showReturns,flowId,display]);
 const active=routes.find((r:Obj)=>highlighted&&!r.exitFlow&&!r.load&&r.actionIds.includes(highlighted));
 const byId=new Map(screens.map(s=>[s.id,s]));
 return <AgentCanvas container={container} resetKey={resetKey}>
  <Edges container={container} routes={routes} highlighted={highlighted} onHover={setHovered} onState={(screenId,stateId)=>{onChooseState(screenId,stateId);onSelectEdge(null);}} onSelect={id=>{onSelectEdge(id);const route=routes.find((r:Obj)=>!r.exitFlow&&r.actionIds.includes(id));if(route)onSelectScreen(route.toScreen);}} onExit={route=>onExitFlow?.({flow:route.exitFlow,via:route.name,toScreen:route.toScreen,toName:route.toName,fromName:route.fromName})}/>
  {columns.map((column,depth)=><div className="map-column" key={depth}>{column.map(id=>{
   const s=byId.get(id)!,{states,current}=display.get(id)??{states:[],current:undefined},o=current?.capture,portrait=(o?.viewport?.height??0)>(o?.viewport?.width??1);
   const own=screenApis(graph,id),apis=new Set<string>([...own.load,...own.action].map(apiText));
   const dim=!!active&&active.fromScreen!==id&&active.toScreen!==id;
   return <article key={id} data-graph-screen={id} className={`map-card ${portrait?'is-portrait':''} ${selectedScreen===id?'selected':''} ${dim?'is-dim':''}`}>
    <header className="map-card-head"><button className="map-card-title" onClick={()=>{onSelectEdge(null);onSelectScreen(id);}}><span>{index.get(id)}</span><strong>{s.name}</strong></button>
     {states.length>1?<select className="map-state-select" aria-label={`Estado exibido de ${s.name}`} title="Estado exibido desta tela" value={current?.id} onChange={event=>{onChooseState(id,event.target.value);onSelectEdge(null);}}>{states.map(state=><option key={state.id} value={state.id}>{state.label}</option>)}</select>:states.length===1&&states[0].name!=='estado'&&<span className="map-state-only" title="Único estado capturado">{clip(states[0].label,14)}</span>}</header>
    {o?<div className="map-shot"><div className="agent-image" data-capture={o.id} data-state-id={o.stateId}>
      <img src={'/__navloom/agent/resource?path='+encodeURIComponent(o.screenshot)+'&project='+encodeURIComponent(projectId)} alt={`${s.name}, estado ${current!.label}, captura de ${new Date(o.capturedAt).toLocaleString()}`} draggable={false}/>
      <AgentActions observation={o} graph={graph} run={run} visibleKinds={visibleKinds} onHighlight={setHovered} selectedEdge={selectedEdge} highlightedEdge={highlighted} focusIdentity={focus?.screenId===id?focus.identity:undefined} onSelect={edge=>{onSelectEdge(edge);onSelectScreen(id);}}/>
     </div></div>:<p className="map-card-empty">Sem captura nesta execução</p>}
    <footer>
     {s.deeplinks?.length>0&&<span title={'Entrada por deeplink\n'+s.deeplinks.map((d:Obj)=>d.url).join('\n')}><Link2 size={12}/>{clip(s.deeplinks[0].url,26)}</span>}
     {apis.size>0&&<span title={[...own.load.map((a:Obj)=>`ao entrar: ${apiText(a)}`),...own.action.map((a:Obj)=>`em “${a.via}”: ${apiText(a)}`)].join('\n')}><Braces size={12}/>{apis.size} API{apis.size>1?'s':''}</span>}
    </footer>
   </article>;})}</div>)}
 </AgentCanvas>;
}
