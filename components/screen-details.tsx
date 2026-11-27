'use client';
import {useState} from 'react';
import {Braces,Check,ChevronRight,Copy,Link,Link2} from 'lucide-react';
import {screenLink} from '@/lib/screen-link.mjs';
import {copyText} from '@/lib/clipboard';

type Api={method:string;path:string;host?:string;statuses?:number[];via?:string};
type Deeplink={url:string};
type Declared={pattern:string;match?:string};
const apiText=(api:Api)=>`${api.method} ${api.path}`;

/**
 * Copies the link that names a screen (and the state picked in its selector) so it can be pasted to the agent:
 * "change this one", "make this a state". `compact` is the chip under a map card.
 */
export function CopyScreenLink({screenId,stateId,name,compact}:{screenId:string;stateId?:string;name?:string;compact?:boolean}){
 const [copied,setCopied]=useState(false),link=screenLink({screen:screenId,state:stateId});
 const copy=async()=>{if(await copyText(link)){setCopied(true);setTimeout(()=>setCopied(false),1600);}else window.prompt('Copie o link da tela',link);};
 if(compact)return <button className={'map-card-link '+(copied?'is-copied':'')} aria-label={copied?'Link copiado':`Copiar link de ${name??'tela'}`} title={copied?'Link copiado':`Copiar link para o agente\n${link}`} onClick={()=>void copy()}>{copied?<Check size={12}/>:<Link size={12}/>}{copied?'Copiado':'Link'}</button>;
 return <button className="agent-copy-context agent-copy-link" title={`Cole no chat do agente para apontar esta tela${stateId?' e este estado':''}\n${link}`} onClick={()=>void copy()}>{copied?<Check size={14}/>:<Link size={14}/>} {copied?'Link copiado':'Copiar link'}</button>;
}

function CopyIcon({text}:{text:string}){const [copied,setCopied]=useState(false);return <button aria-label={`Copiar ${text}`} title={copied?'Copiado':'Copiar'} onClick={async()=>{if(await copyText(text)){setCopied(true);setTimeout(()=>setCopied(false),1500);}}}>{copied?<Check size={13}/>:<Copy size={13}/>}</button>;}

/**
 * Deeplinks and API calls of the selected screen, each folded until asked for and absent when there is nothing to show.
 */
export function ScreenFolds({deeplinks,declared,apis}:{deeplinks:Deeplink[];declared:Declared[];apis:{load:Api[];action:Api[]}}){
 // Links: one per row listed (verified and declared). Calls: distinct ones, as on the map card. A call made both on load and by an
 // action is one call: it is listed once, under "Ao carregar", with the control that also triggers it and the responses seen either way.
 const again=new Map(apis.action.map(api=>[apiText(api),api])),onLoad=apis.load.map(api=>{const same=again.get(apiText(api));return same?{api:{...api,statuses:[...new Set([...(api.statuses??[]),...(same.statuses??[])])].sort((a,b)=>a-b)},note:same.via?`também em “${same.via}”`:'também por ação'}:{api,note:undefined};}),loaded=new Set(apis.load.map(apiText)),byAction=apis.action.filter(api=>!loaded.has(apiText(api)));
 const links=deeplinks.length+declared.length,calls=onLoad.length+byAction.length,row=(api:Api,note?:string)=><li key={apiText(api)+(note??'')}><code>{apiText(api)}</code><span>{api.statuses?.join(' · ')||'sem resposta'}</span>{(note||api.host)&&<small>{[note,api.host].filter(Boolean).join(' · ')}</small>}</li>;
 return <>
  {links>0&&<details className="screen-fold"><summary><ChevronRight size={13}/><Link2 size={13}/>{deeplinks.length?'Deeplinks':'Deeplinks do app'} <span>({links})</span></summary>
   <ul className="agent-deeplinks">{deeplinks.map(d=><li key={d.url} className="is-verified"><Link2 size={14}/><div><code>{d.url}</code><small>Verificado: abre esta tela</small></div><CopyIcon text={d.url}/></li>)}
    {declared.map(d=><li key={d.pattern+d.match}><Link2 size={14}/><div><code>{d.pattern}{d.match==='prefix'?'*':''}</code><small>Padrão declarado pelo app{d.match==='prefix'?' · aceita qualquer caminho':''}{deeplinks.length?'':' · ainda não verificado para esta tela'}</small></div><CopyIcon text={d.pattern}/></li>)}</ul></details>}
  {calls>0&&<details className="screen-fold"><summary><ChevronRight size={13}/><Braces size={13}/>Chamadas de API <span>({calls})</span></summary>
   {onLoad.length>0&&<><p className="screen-fold-group">Ao carregar</p><ul className="agent-api-list">{onLoad.map(({api,note})=>row(api,note))}</ul></>}
   {byAction.length>0&&<><p className="screen-fold-group">Por ação</p><ul className="agent-api-list">{byAction.map(api=>row(api,api.via?`em “${api.via}”`:undefined))}</ul></>}</details>}
 </>;
}
