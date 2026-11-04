'use client';
import {useEffect,useState,type RefObject} from 'react';
type Obj=Record<string,any>;
export function AgentRoute({container,edge,highlighted=false,dimmed=false}:{container:RefObject<HTMLDivElement|null>;edge:Obj;highlighted?:boolean;dimmed?:boolean}){
 const [drawing,setDrawing]=useState<{path:string;width:number;height:number}>();
 useEffect(()=>{const root=container.current;if(!root)return;
  const measure=()=>{
   const source=root.querySelector<HTMLElement>(`[data-graph-screen="${edge.fromScreen}"]`),destinationCard=root.querySelector<HTMLElement>(`[data-graph-screen="${edge.toScreen}"]`);
   if(!source||!destinationCard){setDrawing(undefined);return;}
   const bounds=root.getBoundingClientRect(),scale=bounds.width/root.offsetWidth||1;
   const rect=(el:HTMLElement)=>{const r=el.getBoundingClientRect();return {x:(r.left-bounds.left)/scale,y:(r.top-bounds.top)/scale,width:r.width/scale,height:r.height/scale};};
   const sameScreen=edge.fromScreen===edge.toScreen;
   // A state change points at the displayed capture of the destination state inside the same card.
   const destination=sameScreen?[...destinationCard.querySelectorAll<HTMLElement>('[data-state-id]')].find(el=>el.dataset.stateId===edge.toState):destinationCard;
   if(!destination){setDrawing(undefined);return;}
   const a=rect(source),b=rect(destination),forward=sameScreen?true:b.x>a.x,dir=forward?1:-1;
   const start={x:forward?a.x+a.width:a.x,y:a.y+a.height/2},end={x:forward?b.x:b.x+b.width,y:b.y+b.height/2};
   if(edge.origin==='interaction'){
    // Use the button in a displayed matching state, never stale coordinates on another capture.
    const shots=[...source.querySelectorAll<HTMLElement>('[data-state-id]')].filter(el=>el.dataset.stateId===edge.fromState);
    const hotspot=shots.flatMap(shot=>[...shot.querySelectorAll<HTMLElement>('[data-element-identity]')]).find(el=>el.dataset.elementIdentity===edge.elementIdentity);
    const recordedAction=[...source.querySelectorAll<HTMLElement>('[data-action-id]')].find(el=>edge.actionIds.includes(el.dataset.actionId));
    const exactShot=shots.find(el=>edge.evidence.some((e:Obj)=>e.before===el.dataset.capture));
    if(hotspot){const r=rect(hotspot);start.x=forward?r.x+r.width:r.x;start.y=r.y+r.height/2;}
    else if(edge.point&&exactShot){const r=rect(exactShot);start.x=r.x+edge.point.x*r.width;start.y=r.y+edge.point.y*r.height;}
    else if(recordedAction){const r=rect(recordedAction);start.x=forward?r.x+r.width:r.x;start.y=r.y+r.height/2;}
    else{setDrawing(undefined);return;}
   }
   let path:string;
   if(sameScreen){
    // Loop out of the card's right side and back into the destination capture.
    const out=a.x+a.width+36+edge.lane*6;end.x=b.x+b.width;end.y=b.y+Math.min(24,b.height/2);
    path=`M${start.x} ${start.y} C${out} ${start.y},${out} ${end.y},${end.x} ${end.y}`;
   }else{
    const cards=[...root.querySelectorAll<HTMLElement>('[data-graph-screen]')];
    const adjacent=Math.abs(cards.indexOf(source)-cards.indexOf(destinationCard))===1;
    if(adjacent){const bend=Math.abs(end.x-start.x)*.5;const offset=forward?-12:12;if(edge.origin==='automatic')start.y+=offset;end.y+=offset;path=`M${start.x} ${start.y} C${start.x+dir*bend} ${start.y},${end.x-dir*bend} ${end.y},${end.x} ${end.y}`;}
    else {const lane=24+edge.lane*14,x1=(forward?a.x+a.width:a.x)+dir*30,x2=end.x-dir*30;path=`M${start.x} ${start.y} L${x1} ${start.y} L${x1} ${lane} L${x2} ${lane} L${x2} ${end.y} L${end.x} ${end.y}`;}
   }
   setDrawing({path,width:root.scrollWidth,height:root.scrollHeight});
  };
  const observer=new ResizeObserver(measure);observer.observe(root);root.querySelectorAll('[data-graph-screen]').forEach(el=>observer.observe(el));const frame=requestAnimationFrame(measure);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();};
 },[container,edge]);
 if(!drawing)return null;
 const marker=`screen-arrow-${edge.id}`,color=edge.kind==='state'?'#2f8f7f':'#8861ce';
 return <svg className={`agent-route ${highlighted?'is-highlighted':''}`} data-screen-route={edge.id} data-route-origin={edge.origin} data-route-kind={edge.kind} style={{opacity:dimmed?.08:1}} width={drawing.width} height={drawing.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></marker></defs><path d={drawing.path} fill="none" stroke={color} strokeWidth={highlighted?3:1.6} strokeDasharray={edge.kind==='state'?'5 4':undefined} strokeLinejoin="round" strokeLinecap="round" markerEnd={`url(#${marker})`}/></svg>;
}
