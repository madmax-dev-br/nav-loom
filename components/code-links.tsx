'use client';
import {useState} from 'react';
import {Code2,Trash2} from 'lucide-react';

type Obj=Record<string,any>;
const where=(link:Obj)=>`${link.repository}:${link.path}${link.line?':'+link.line:''}`;
const ROLE:Record<string,string>={frontend:'tela',backend:'servidor',shared:'compartilhado'};

/** Files of the configured repositories that render a screen. Links found by search stay "inferido" until a person confirms them. */
export function CodeLinks({screen,hasRepositories,busy,onAction}:{screen:Obj;hasRepositories:boolean;busy:boolean;onAction:(name:string,args:Obj)=>Promise<any>}){
 const [suggestions,setSuggestions]=useState<Obj[]|null>(null);
 const links:Obj[]=screen.sources??[],linked=new Set(links.map(where));
 const link=(item:Obj,extra:Obj)=>onAction('link',{kind:'screen',id:screen.id,repository:item.repository,path:item.path,line:item.line,role:item.role,...extra});
 return <><h3><Code2 size={13}/> Código vinculado</h3>
  {links.length?<ul className="agent-code-links">{links.map(item=><li key={where(item)}><code>{where(item)}</code><small>{ROLE[item.role]??item.role} · {item.status==='confirmed'?'confirmado':'inferido'}</small><span>{item.status!=='confirmed'&&<button disabled={busy} onClick={()=>void link(item,{status:'confirmed'})}>Confirmar</button>}<button aria-label={`Remover vínculo com ${item.path}`} title="Remover vínculo" disabled={busy} onClick={()=>void link(item,{remove:true})}><Trash2 size={12}/></button></span></li>)}</ul>
  :<p className="agent-quiet">{hasRepositories?'Nenhum arquivo vinculado a esta tela.':'Declare repositories na configuração do projeto para ligar telas ao código.'}</p>}
  {hasRepositories&&<button className="agent-copy-context" disabled={busy} onClick={async()=>{const result=await onAction('link_suggestions',{screenId:screen.id});if(result)setSuggestions(result.screen?.candidates??[]);}}><Code2 size={14}/> Sugerir arquivos pelo código</button>}
  {suggestions&&(suggestions.filter(c=>!linked.has(where(c))).length?<ul className="agent-code-links is-suggested">{suggestions.filter(c=>!linked.has(where(c))).map(candidate=><li key={where(candidate)}><code>{candidate.repository}:{candidate.path}</code><small>{candidate.matches?.slice(0,2).map((m:Obj)=>`linha ${m.line}: ${m.term}`).join(' · ')}</small><span><button disabled={busy} onClick={()=>void link({...candidate,line:candidate.matches?.[0]?.line},{status:'inferred'})}>Vincular</button></span></li>)}</ul>:<p className="agent-quiet">A busca não encontrou outros arquivos para esta tela.</p>)}
 </>;
}
