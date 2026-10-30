"use client";
import {useRef} from 'react';
export function ResizeDivider({label,value,min,max,variable,side,onChange}:{label:string;value:number;min:number;max:number;variable:string;side:'left'|'right';onChange:(value:number)=>void}){
 const drag=useRef<{x:number;width:number;next:number;root:HTMLElement}|null>(null);
 const clamp=(n:number)=>Math.max(min,Math.min(max,n));
 const finish=()=>{const d=drag.current;if(!d)return;drag.current=null;d.root.classList.remove('panel-resizing');onChange(d.next);};
 return <div className={`workspace-resize-handle resize-${side}`} role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();const root=e.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')!;drag.current={x:e.clientX,width:value,next:value,root};root.classList.add('panel-resizing');e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(!d)return;d.next=clamp(d.width+(e.clientX-d.x)*(side==='right'?1:-1));d.root.style.setProperty(variable,`${d.next}px`);e.currentTarget.setAttribute('aria-valuenow',String(d.next));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onChange(clamp(value+(e.key==='ArrowRight'?20:-20)*(side==='right'?1:-1)));}}}><span/></div>;
}
