"use client";
import {useRef,useState} from 'react';
import type {Flow} from '@/lib/flow';
export function useAutosave({flow,revision,onSaved}:{flow:Flow;revision:number;onSaved:(result:{flow:Flow;revision:number;updatedAt:string})=>void}){
 const revisions=useRef<Record<string,number>>({}),queue=useRef<Flow[]>([]),running=useRef(false),blocked=useRef(false),last=useRef(''),callback=useRef(onSaved);callback.current=onSaved;
 revisions.current[flow.id]=Math.max(revision,revisions.current[flow.id]??0);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 async function drain(){if(running.current||blocked.current)return;running.current=true;setSaving(true);try{while(queue.current.length){const next=queue.current[0];const response=await fetch('/api/flows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({flow:next,revision:revisions.current[next.id]??0})});const result=await response.json() as {flow:Flow;revision:number;updatedAt:string;error?:string};if(!response.ok)throw new Error(result.error??'Could not save');revisions.current[next.id]=result.revision;queue.current.shift();callback.current(result);}setError('');}catch(e){blocked.current=true;setError(e instanceof Error?e.message:'Could not save');}finally{running.current=false;setSaving(false);}}
 function enqueue(next:Flow){const serialized=JSON.stringify(next);if(serialized===last.current)return queue.current.length>0;last.current=serialized;queue.current.push(structuredClone(next));void drain();return true;}
 function retry(){blocked.current=false;setError('');void drain();}
 return {enqueue,retry,saving,error};
}
