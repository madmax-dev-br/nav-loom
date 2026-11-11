'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Braces,Check,Copy,Maximize2,ChevronsDown,ChevronsUp,CornerUpLeft,Link2,MousePointerClick,RotateCcw,Timer,TriangleAlert,X} from 'lucide-react';
import {splitApis,screenApis} from '@/lib/api-role.mjs';

type Obj=Record<string,any>;
type Step={stateId:string;edge?:Obj};
const apiText=(api:Obj)=>`${api.method} ${api.path}`;
/** How long the preview holds on "loading" for a transition that called the backend. The real duration is shown in the card. */
const REQUEST_MS=2000;

/**
 * Walk the recorded application like a prototype: tapping a control follows the transition that was observed from
 * the state on display. Nothing touches the device; a control nobody followed says so instead of guessing.
 */
export function AgentPreview({graph,runs,observations,projectId,startStateId,onClose}:{graph:Obj;runs:Obj[];observations:Obj[];projectId:string;startStateId:string;onClose:()=>void}){
 const [trail,setTrail]=useState<Step[]>([{stateId:startStateId}]),[notice,setNotice]=useState<{kind:'unmapped'|'choice'|'empty';text:string;choices?:Obj[]}|null>(null),[hint,setHint]=useState(false),[pending,setPending]=useState<Obj|null>(null),[opened,setOpened]=useState<{api:Obj;call?:Obj;role:string}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const captureOf=useMemo(()=>{const map=new Map<string,Obj>();for(const o of observations)map.set(o.stateId,o);return map;},[observations]);
 const stateOf=(id:string)=>graph.states.find((s:Obj)=>s.id===id),screenOfState=(id:string)=>graph.screens.find((s:Obj)=>s.id===stateOf(id)?.screenId);
 const stateLabel=(id:string)=>stateOf(id)?.name||captureOf.get(id)?.stateKey||'estado';
 const current=trail.at(-1)!,capture=captureOf.get(current.stateId),screen=screenOfState(current.stateId);
 const outgoing=useMemo(()=>{const all=graph.transitions.filter((t:Obj)=>t.confirmed&&t.from===current.stateId&&t.to!==t.from),key=(t:Obj)=>JSON.stringify(t.action)+t.to;return all.filter((t:Obj,i:number)=>all.findLastIndex((other:Obj)=>key(other)===key(t))===i);},[graph,current.stateId]);
 const timings=(edge:Obj)=>{const map=new Map<string,Obj>();for(const evidence of edge.evidence??[]){const step=runs.find(r=>r.id===evidence.runId)?.steps.find((s:Obj)=>s.id===evidence.stepId);for(const call of step?.network??[])map.set(apiText(call),call);}return map;};
 // A transition that called the backend pauses briefly on a loading state, with its requests shown beside the app, so the call is seen happening.
 const go=(edge:Obj)=>{setNotice(null);if(timer.current)clearTimeout(timer.current);
  if(!edge.apis?.length){setPending(null);setTrail(old=>[...old,{stateId:edge.to,edge}]);return;}
  setPending(edge);timer.current=setTimeout(()=>{setPending(null);setTrail(old=>[...old,{stateId:edge.to,edge}]);},REQUEST_MS);};
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const describe=(edge:Obj)=>{const to=screenOfState(edge.to),same=to?.id===screen?.id,status=[...new Set((edge.apis??[]).flatMap((a:Obj)=>a.statuses??[]))].join('/');return `${same?`estado ${stateLabel(edge.to)}`:to?.name??'?'}${status?` · resposta ${status}`:''}`;};
 const tap=(element:Obj)=>{
  if(pending)return;
  const edges=outgoing.filter((t:Obj)=>t.action?.elementIdentity===element.identity),name=element.label||element.name;
  if(!edges.length){setNotice({kind:'unmapped',text:`“${name}” ainda não foi mapeado: ninguém seguiu este controle a partir deste estado.`});flash();return;}
  // The same control can have been seen leading to different places (a success, an error); the person picks which to follow.
  // The same transition can be recorded once per app build; the newest record of each destination is the one followed.
  const distinct=edges.filter((edge:Obj,i:number)=>edges.findLastIndex((other:Obj)=>other.to===edge.to)===i);
  if(distinct.length>1)setNotice({kind:'choice',text:`“${name}” já levou a resultados diferentes. Qual seguir?`,choices:distinct});else go(distinct[0]);
 };
 const flash=()=>{setHint(true);setTimeout(()=>setHint(false),900);};
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;if(document.querySelector('.walk-modal'))return;onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onClose]);
 const scrolls=outgoing.filter((t:Obj)=>t.action?.type==='scroll'),automatic=outgoing.filter((t:Obj)=>t.action?.type==='wait'),systemBack=outgoing.filter((t:Obj)=>t.action?.type==='back');
 const edge=current.edge,calls=edge?splitApis(graph,edge):{action:[],load:[]},from=edge?screenOfState(edge.from):undefined;
 // Timings come from the recorded step that confirmed the transition.
 const measured=useMemo(()=>edge?timings(edge):new Map<string,Obj>(),[edge,runs]);// eslint-disable-line react-hooks/exhaustive-deps
 const arrival=screen&&(!edge||from?.id!==screen.id)?(edge?calls.load:screenApis(graph,screen.id).load):[];
 const request=(api:Obj,role:string)=>{const call=measured.get(apiText(api)),status=call?.status??api.statuses?.at(-1);return <li key={apiText(api)}><button className="walk-request" title="Ver a chamada completa" onClick={()=>setOpened({api,call,role})}><div><b className={'method '+api.method}>{api.method}</b><code>{api.path}</code><Maximize2 size={12}/></div><dl><div><dt>Host</dt><dd>{api.host||'—'}</dd></div><div><dt>Resposta</dt><dd className={status>=400||status===0?'is-bad':'is-ok'}>{status??'sem resposta'}</dd></div><div><dt>Tempo</dt><dd>{call?.ms!=null?`${call.ms} ms`:'—'}</dd></div></dl></button></li>;};
 const mappedIdentities=new Set(outgoing.map((t:Obj)=>t.action?.elementIdentity).filter(Boolean));
 return <div className="walk" role="dialog" aria-modal="true" aria-label="Preview do aplicativo">
  <header className="walk-bar"><strong>Preview</strong><span>Navegue pelo que já foi mapeado. Nada é executado no dispositivo.</span>
   <button disabled={trail.length<2} onClick={()=>{setNotice(null);setTrail(old=>old.slice(0,-1));}}><ArrowLeft size={14}/> Desfazer passo</button>
   <button disabled={trail.length<2} onClick={()=>{setNotice(null);setTrail([{stateId:startStateId}]);}}><RotateCcw size={14}/> Reiniciar</button>
   <button aria-label="Fechar preview" onClick={onClose}><X size={15}/> Fechar</button></header>
  <div className="walk-body">
   <section className="walk-stage">
    <div className="walk-device">
     {capture?<div className={'walk-screen '+(hint?'is-hinting':'')} style={{aspectRatio:`${capture.viewport?.width??9} / ${capture.viewport?.height??19.5}`}} onClick={event=>{if(event.target===event.currentTarget||(event.target as HTMLElement).tagName==='IMG'){setNotice({kind:'empty',text:'Nada mapeado neste ponto. As áreas contornadas são os controles com caminho conhecido.'});flash();}}}>
       <img src={'/__navloom/agent/resource?path='+encodeURIComponent(capture.screenshot)+'&project='+encodeURIComponent(projectId)} alt={`${screen?.name}, estado ${stateLabel(current.stateId)}`} draggable={false}/>
       {pending&&<div className="walk-loading" role="status"><i className="walk-spinner"/><span>Carregando…</span></div>}
     {capture.elements.filter((e:Obj)=>e.visible&&!e.disabled&&e.actions?.includes('click')).map((e:Obj)=><button key={e.id} className={'walk-hit '+(mappedIdentities.has(e.identity)?'is-mapped':'')} aria-label={(e.label||e.name)+(mappedIdentities.has(e.identity)?'':' (não mapeado)')} title={e.label||e.name} style={{left:e.bounds.x*100+'%',top:e.bounds.y*100+'%',width:e.bounds.width*100+'%',height:e.bounds.height*100+'%'}} onClick={event=>{event.stopPropagation();tap(e);}}/>)}
      </div>:<p className="walk-missing">Este estado foi registrado, mas não há captura dele nas execuções carregadas.</p>}
    </div>
    <div className="walk-side-actions">
     {scrolls.map((t:Obj)=><button key={t.id} disabled={!!pending} onClick={()=>go(t)}>{t.action.direction==='up'?<ChevronsUp size={14}/>:<ChevronsDown size={14}/>} Rolar para {t.action.direction==='up'?'cima':'baixo'}: {describe(t)}</button>)}
     {automatic.map((t:Obj)=><button key={t.id} disabled={!!pending} onClick={()=>go(t)}><Timer size={14}/> Aguardar: {describe(t)}</button>)}
     {systemBack.map((t:Obj)=><button key={t.id} disabled={!!pending} onClick={()=>go(t)}><CornerUpLeft size={14}/> Voltar do sistema: {describe(t)}</button>)}
     <div className="walk-notice" role="status" aria-live="polite">{notice&&<div className={'is-'+notice.kind}>{notice.kind==='choice'?<MousePointerClick size={16}/>:<TriangleAlert size={16}/>}<p>{notice.text}</p>{notice.choices&&<div>{notice.choices.map((choice:Obj)=><button key={choice.id} onClick={()=>go(choice)}>{describe(choice)}</button>)}</div>}</div>}</div>
    </div>
   </section>
   <aside className="walk-details">
    <p className="agent-eyebrow">Passo {trail.length} · tela</p><h2>{screen?.name??'Tela desconhecida'}</h2>
    <dl className="agent-identity"><div><dt>Estado</dt><dd>{stateLabel(current.stateId)}</dd></div>{screen?.header&&<div><dt>Cabeçalho</dt><dd>{screen.header}</dd></div>}{screen?.fragment&&<div><dt>Fragment</dt><dd><code>{screen.fragment}</code></dd></div>}{screen?.route&&<div><dt>Activity</dt><dd><code>{screen.route}</code></dd></div>}</dl>
    <h3>Como chegou aqui</h3>{edge?<p className="walk-how"><b>{edge.action.type==='scroll'?`Rolagem para ${edge.action.direction==='up'?'cima':'baixo'}`:edge.action.type==='wait'?'Transição automática':edge.action.type==='back'?'Voltar do sistema':edge.action.type==='deeplink'?'Deeplink':`Toque em “${edge.name}”`}</b><span>em {from?.name}{from?.id===screen?.id?` (estado ${stateLabel(edge.from)})`:''}</span>{edge.action.url&&<code>{edge.action.url}</code>}<small>{(edge.evidence??[]).length} {(edge.evidence??[]).length===1?'evidência registrada':'evidências registradas'}</small></p>:<p className="agent-quiet">Ponto de partida do preview.</p>}
    <h3><Braces size={13}/> Requisições da ação</h3>{calls.action.length?<ul className="walk-requests">{calls.action.map((api:Obj)=>request(api,'Disparada pela ação'))}</ul>:<p className="agent-quiet">{edge?'Esta ação não disparou chamadas próprias.':'Nenhuma ação ainda.'}</p>}
    <h3><Braces size={13}/> Ao entrar na tela</h3>{arrival.length?<ul className="walk-requests">{arrival.map((api:Obj)=>request(api,'Carregamento da tela'))}</ul>:<p className="agent-quiet">Nenhuma chamada de carregamento observada{edge&&from?.id===screen?.id?' (a tela não mudou)':''}.</p>}
    {screen?.deeplinks?.length>0&&<><h3><Link2 size={13}/> Deeplink</h3>{screen.deeplinks.map((d:Obj)=><code key={d.url} className="agent-deeplink">{d.url}</code>)}</>}
    <h3>Caminho percorrido</h3><ol className="walk-trail">{trail.map((step,i)=><li key={i} className={i===trail.length-1?'is-current':''}><button disabled={i===trail.length-1} onClick={()=>{setNotice(null);setTrail(old=>old.slice(0,i+1));}}><b>{screenOfState(step.stateId)?.name}</b><span>{step.edge?(step.edge.action.type==='scroll'?'rolagem':step.edge.action.type==='wait'?'automático':step.edge.action.type==='back'?'voltar':step.edge.name):'início'} · {stateLabel(step.stateId)}</span></button></li>)}</ol>
   </aside>
  </div>
  {opened&&<RequestModal api={opened.api} call={opened.call} role={opened.role} projectId={projectId} onClose={()=>setOpened(null)}/>}
 </div>;
}

/** Pretty JSON with light syntax colouring; keys, strings, numbers and literals are told apart at a glance. */
function Json({value}:{value:unknown}){
 const text=JSON.stringify(value,null,2)??'null',parts:React.ReactNode[]=[];let last=0,index=0;
 for(const match of text.matchAll(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)){
  if(match.index!>last)parts.push(text.slice(last,match.index));
  const kind=match[1]?(match[2]?'key':match[1]==='"[REDACTED]"'?'masked':'string'):match[3]?'literal':'number';
  parts.push(<span key={index++} className={'json-'+kind}>{match[1]??match[0]}</span>);if(match[2])parts.push(match[2]);last=match.index!+match[0].length;
 }
 parts.push(text.slice(last));return <pre className="walk-json">{parts}</pre>;
}
function Body({body,empty}:{body?:Obj|null;empty:string}){
 if(!body)return <p className="agent-quiet">{empty}</p>;
 if(body.json!==undefined)return <Json value={body.json}/>;
 if(body.text!==undefined)return <pre className="walk-json">{body.text}{body.truncated?'\n… (cortado)':''}</pre>;
 return <p className="agent-quiet">{body.note}</p>;
}
function Headers({headers}:{headers?:Obj}){const entries=Object.entries(headers??{});return entries.length?<dl className="walk-headers">{entries.map(([key,value])=><div key={key}><dt>{key}</dt><dd className={value==='[REDACTED]'?'json-masked':''}>{Array.isArray(value)?value.join(', '):String(value)}</dd></div>)}</dl>:<p className="agent-quiet">Sem cabeçalhos gravados.</p>;}

/** One call in full: what was sent, what came back and how long it took. Sensitive values were masked when it was recorded. */
function RequestModal({api,call,role,projectId,onClose}:{api:Obj;call?:Obj;role:string;projectId:string;onClose:()=>void}){
 const [detail,setDetail]=useState<Obj|null>(null),[state,setState]=useState<'loading'|'ready'|'missing'|'error'>(call?.detail?'loading':'missing'),[copied,setCopied]=useState('');
 useEffect(()=>{if(!call?.detail)return;let alive=true;fetch('/__navloom/agent/resource?path='+encodeURIComponent(call.detail)+'&project='+encodeURIComponent(projectId)).then(response=>response.ok?response.json():Promise.reject(response.status)).then(data=>{if(alive){setDetail(data as Obj);setState('ready');}}).catch(()=>{if(alive)setState('error');});return()=>{alive=false;};},[call?.detail,projectId]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[onClose]);
 const status=detail?.status??call?.status??api.statuses?.at(-1),failed=status>=400||status===0,copy=(label:string,value:unknown)=>{void navigator.clipboard?.writeText(typeof value==='string'?value:JSON.stringify(value,null,2));setCopied(label);setTimeout(()=>setCopied(''),1500);};
 const copyButton=(label:string,value:unknown)=><button className="walk-copy" onClick={()=>copy(label,value)}>{copied===label?<Check size={12}/>:<Copy size={12}/>}{copied===label?'Copiado':'Copiar'}</button>;
 return <div className="walk-modal" role="dialog" aria-modal="true" aria-label={`Chamada ${apiText(api)}`} onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}><div className="walk-modal-panel">
  <header><b className={'method '+api.method}>{api.method}</b><code>{detail?.url??api.path}</code><span className={'walk-status '+(failed?'is-bad':'is-ok')}>{status??'sem resposta'}</span><button aria-label="Fechar" onClick={onClose}><X size={16}/></button></header>
  <dl className="walk-summary"><div><dt>Papel</dt><dd>{role}</dd></div><div><dt>Host</dt><dd>{detail?.host??api.host??'—'}</dd></div><div><dt>Modelo do caminho</dt><dd><code>{api.path}</code></dd></div><div><dt>Tempo</dt><dd>{(detail?.ms??call?.ms)!=null?`${detail?.ms??call?.ms} ms`:'—'}</dd></div><div><dt>Tamanho da resposta</dt><dd>{detail?.responseBody?.size!=null?`${detail.responseBody.size} bytes`:'—'}</dd></div><div><dt>Quando</dt><dd>{detail?.startedAt?new Date(detail.startedAt).toLocaleString():'—'}</dd></div></dl>
  {state==='loading'&&<p className="agent-quiet">Carregando a chamada…</p>}
  {state==='error'&&<p className="agent-error">Não foi possível ler o registro desta chamada.</p>}
  {state==='missing'&&<p className="walk-missing-detail">Esta chamada foi gravada sem corpo nem cabeçalhos: ela vem de uma missão anterior à gravação completa, ou foi reconhecida por linha de log. Missões novas, com o proxy do <code>adb reverse</code>, guardam a troca inteira.</p>}
  {detail&&<div className="walk-exchange">
   <section><div className="walk-section-title"><h3>Resposta</h3>{detail.responseBody?.json!==undefined&&copyButton('resposta',detail.responseBody.json)}</div><Body body={detail.responseBody} empty="A resposta não trouxe corpo."/><details><summary>Cabeçalhos da resposta</summary><Headers headers={detail.responseHeaders}/></details></section>
   <section><div className="walk-section-title"><h3>Requisição</h3>{detail.requestBody?.json!==undefined&&copyButton('requisição',detail.requestBody.json)}</div><Body body={detail.requestBody} empty="A requisição não enviou corpo."/><details><summary>Cabeçalhos da requisição</summary><Headers headers={detail.requestHeaders}/></details></section>
  </div>}
  <footer><small>Senhas, tokens, cookies e chaves foram mascarados na gravação e aparecem como [REDACTED].</small>{detail&&copyButton('tudo',detail)}</footer>
 </div></div>;
}
