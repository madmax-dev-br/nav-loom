'use client';
import {useState} from 'react';
import {Pencil} from 'lucide-react';

export function ScreenDescription({description,onSave}:{description:string;onSave:(description:string)=>Promise<void>}) {
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(description),[saving,setSaving]=useState(false),[error,setError]=useState('');
  if(!editing)return <div className="screen-description"><p>{description||'A finalidade desta tela ainda não foi descrita.'}</p><button className="agent-subtle" onClick={()=>{setDraft(description);setError('');setEditing(true);}}><Pencil size={12}/> Editar descrição</button></div>;
  return <form className="screen-description" onSubmit={async event=>{event.preventDefault();setSaving(true);setError('');try{await onSave(draft);setEditing(false);}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar a descrição.');}finally{setSaving(false);}}}>
    <label>Descrição da tela<textarea autoFocus value={draft} disabled={saving} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.stopPropagation();setEditing(false);}}}/></label>
    {error&&<p role="alert" className="agent-error">{error}</p>}
    <div className="description-actions"><button type="submit" className="agent-primary" disabled={saving}>{saving?'Salvando…':'Salvar'}</button><button type="button" disabled={saving} onClick={()=>setEditing(false)}>Cancelar</button></div>
  </form>;
}
