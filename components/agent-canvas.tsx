'use client';
import {useEffect,useImperativeHandle,useRef,useState,type ReactNode,type RefObject} from 'react';
type View={x:number;y:number;scale:number};
/** Brings elements of the canvas into view; see `reveal` below. */
export type Reveal=(elements:Element[])=>void;
export function AgentCanvas({container,children,resetKey,routeCount=0,reveal}:{container:RefObject<HTMLDivElement|null>;children:ReactNode;resetKey:string;routeCount?:number;reveal?:RefObject<Reveal|null>}){
 const viewport=useRef<HTMLDivElement>(null),view=useRef<View>({x:24,y:24,scale:1}),[camera,setCamera]=useState(view.current),[panning,setPanning]=useState(false),space=useRef(false),drag=useRef<{id:number;x:number;y:number}|null>(null),glide=useRef(0);
 // Whatever the user does with the canvas goes through here, so it also stops a pan that was still gliding.
 const update=(next:View)=>{cancelAnimationFrame(glide.current);view.current=next;setCamera(next);};
 // Pan, never zoom, just enough to show the given elements, and only when they are not all in view already.
 // When they cannot all fit, the last one is shown whole and the first as far as that allows.
 useImperativeHandle(reveal,()=>elements=>{
  const box=viewport.current;if(!box||!elements.length)return;
  const frame=box.getBoundingClientRect(),rects=elements.map(element=>element.getBoundingClientRect()),first=rects[0],last=rects.at(-1)!;
  const shift=(lo:(r:DOMRect)=>number,hi:(r:DOMRect)=>number,min:number,max:number)=>{
   const fit=(a:number,b:number)=>b-a>max-min||a<min?min-a:b>max?max-b:0,a=Math.min(...rects.map(lo)),b=Math.max(...rects.map(hi));
   if(b-a<=max-min)return fit(a,b);
   const base=fit(lo(last),hi(last)),room=hi(last)-lo(last)<=max-min?[min-lo(last)-base,max-hi(last)-base]:[0,0];
   return base+Math.max(room[0],Math.min(room[1],fit(lo(first)+base,hi(first)+base)));
  };
  // The margin at the bottom clears the zoom controls; the one at the top clears the run bar, which floats over the canvas while a run is live.
  const bar=box.previousElementSibling?.querySelector('.agent-runbar')?.getBoundingClientRect(),top=bar&&bar.bottom>frame.top?bar.bottom+10:frame.top+20;
  const dx=shift(r=>r.left,r=>r.right,frame.left+28,frame.right-28),dy=shift(r=>r.top,r=>r.bottom,top,frame.bottom-68);
  if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
  const from=view.current;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){update({...from,x:from.x+dx,y:from.y+dy});return;}
  cancelAnimationFrame(glide.current);const start=performance.now();
  const step=(now:number)=>{const t=Math.min(1,(now-start)/380),eased=1-(1-t)**3,next={...from,x:from.x+dx*eased,y:from.y+dy*eased};view.current=next;setCamera(next);if(t<1)glide.current=requestAnimationFrame(step);};
  glide.current=requestAnimationFrame(step);
 },[]);
 useEffect(()=>()=>cancelAnimationFrame(glide.current),[]);
 const zoom=(factor:number,x:number,y:number)=>{const old=view.current,scale=Math.max(.15,Math.min(2.5,old.scale*factor)),ratio=scale/old.scale;update({x:x-(x-old.x)*ratio,y:y-(y-old.y)*ratio,scale});};
 useEffect(()=>{update({x:24,y:24,scale:1});},[resetKey]);
 useEffect(()=>{const element=viewport.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1;const dx=event.deltaX*unit,dy=event.deltaY*unit;if(event.metaKey||event.ctrlKey){const rect=element.getBoundingClientRect();zoom(Math.exp(-dy*.0015),event.clientX-rect.left,event.clientY-rect.top);}else{update({...view.current,x:view.current.x-(event.shiftKey&&!dx?dy:dx),y:view.current.y-(event.shiftKey&&!dx?0:dy)});}};const keydown=(event:KeyboardEvent)=>{if(event.code==='Space'&&!((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true],button'))){space.current=true;if(element.matches(':hover')||element===document.activeElement)event.preventDefault();}};const clear=()=>{space.current=false;drag.current=null;setPanning(false);};const keyup=(event:KeyboardEvent)=>{if(event.code==='Space')space.current=false;};element.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',clear);return()=>{element.removeEventListener('wheel',wheel);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',clear);};},[]);
 const end=()=>{drag.current=null;setPanning(false);};
 return <div className={'agent-canvas-viewport '+(panning?'is-panning':'')} ref={viewport} tabIndex={0} aria-label="Canvas de navegação" onPointerDownCapture={event=>{if(event.button!==1&&!(event.button===0&&space.current))return;event.preventDefault();event.stopPropagation();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);setPanning(true);}} onPointerMove={event=>{const previous=drag.current;if(!previous||previous.id!==event.pointerId)return;update({...view.current,x:view.current.x+event.clientX-previous.x,y:view.current.y+event.clientY-previous.y});drag.current={id:event.pointerId,x:event.clientX,y:event.clientY};}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onAuxClick={event=>{if(event.button===1)event.preventDefault();}} onClickCapture={event=>{if(space.current){event.preventDefault();event.stopPropagation();}}}>
 <div className="agent-graph" ref={container} style={{paddingTop:48+routeCount*14,transform:`translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`}}>{children}</div>
 <div className="agent-canvas-controls" onPointerDownCapture={event=>event.stopPropagation()}><span>roda: mover · ⌘ + roda: zoom · botão do meio: arrastar</span><button aria-label="Diminuir zoom" onClick={()=>zoom(1/1.2,(viewport.current?.clientWidth??0)/2,(viewport.current?.clientHeight??0)/2)}>−</button><output aria-label="Zoom">{Math.round(camera.scale*100)}%</output><button aria-label="Aumentar zoom" onClick={()=>zoom(1.2,(viewport.current?.clientWidth??0)/2,(viewport.current?.clientHeight??0)/2)}>+</button><button onClick={()=>update({x:24,y:24,scale:1})}>1:1</button><button onClick={()=>{const root=container.current,box=viewport.current;if(!root||!box)return;const scale=Math.max(.15,Math.min(1,(box.clientWidth-48)/root.scrollWidth,(box.clientHeight-70)/root.scrollHeight));update({x:24,y:24,scale});}}>Enquadrar</button></div>
 </div>;
}
