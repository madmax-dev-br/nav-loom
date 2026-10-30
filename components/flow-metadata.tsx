"use client";
import {useState} from 'react';
import type {Flow} from '@/lib/flow';
export function FlowMetadata({flow,onSave}:{flow:Flow;onSave:(flow:Flow)=>void}){
 const [name,setName]=useState(flow.name),[description,setDescription]=useState(flow.description),[project,setProject]=useState(flow.project),[group,setGroup]=useState(flow.group??''),[entry,setEntry]=useState(flow.entry);
 return <div className="action-form"><label className="field">Flow title<input value={name} onChange={e=>setName(e.target.value)}/></label><label className="field">Description<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><div className="form-grid"><label className="field">Project<input value={project} onChange={e=>setProject(e.target.value)}/></label><label className="field">Group<input value={group} onChange={e=>setGroup(e.target.value)} placeholder="Commerce/Checkout"/></label></div><label className="field">Entry screen<select value={entry} onChange={e=>setEntry(e.target.value)}>{flow.screens.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><button className="button primary" disabled={!name.trim()||!project.trim()} onClick={()=>onSave({...flow,name:name.trim(),description,project:project.trim(),group:group.trim()||undefined,entry})}>Apply changes</button></div>;
}
