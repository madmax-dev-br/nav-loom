'use client';
import {useState} from 'react';
import {KeyRound,LifeBuoy,Trash2} from 'lucide-react';

type Obj=Record<string,any>;
const KIND:Record<string,string>={credential:'Credencial',input:'Valor',decision:'Decisão',precondition:'Pré-condição',environment:'Ambiente',other:'Outro'};

/** What the agent could not get on its own: open questions a person answers here, and the answers remembered for later runs. */
export function HelpPanel({requests,graph,busy,onAction,onOpenScreen}:{requests:Obj[];graph:Obj;busy:boolean;onAction:(name:string,args:Obj)=>Promise<unknown>;onOpenScreen:(id:string)=>void}){
 const [answers,setAnswers]=useState<Record<string,string>>({});
 const remembered:Obj[]=graph.harness??[],screenName=(id:string)=>graph.screens.find((s:Obj)=>s.id===id)?.name??'tela';
 const where=(item:Obj)=><>{item.screenId&&<button className="help-screen" onClick={()=>onOpenScreen(item.screenId)}>{screenName(item.screenId)}</button>}{item.elementIdentity&&<code>{String(item.elementIdentity).split('|')[0]}</code>}</>;
 return <div className="harness">
  <header className="harness-intro"><p className="agent-eyebrow">Ajuda</p><h2>Quando o agente não consegue seguir sozinho, ele pergunta aqui.</h2><p>Uma senha de teste, um valor que só você conhece, uma decisão. A resposta fica guardada no projeto e as próximas missões não perguntam de novo. Segredos ficam apenas nesta máquina, em <code>.navloom/secrets.json</code>; o mapa guarda só a referência.</p></header>

  <section className="harness-card"><div className="harness-card-title"><h3><LifeBuoy size={15}/> Perguntas abertas</h3><span>{requests.length?`${requests.length} aguardando você`:''}</span></div>
   {requests.length?<div className="help-list">{requests.map(q=>{const secret=q.kind==='credential',value=answers[q.id]??'';
    return <article key={q.id} className="help-request"><header><span className={'harness-status '+(secret?'is-proposed':'')}>{secret&&<KeyRound size={11}/>} {KIND[q.kind]??q.kind}</span>{where(q)}<time>{new Date(q.askedAt).toLocaleString()}</time></header>
     <h4>{q.question}</h4>{q.why&&<p>{q.why}</p>}
     {q.options?.length?<div className="help-options">{q.options.map((option:string)=><button key={option} disabled={busy} onClick={()=>void onAction('answer',{requestId:q.id,option})}>{option}</button>)}<button className="agent-subtle" disabled={busy} onClick={()=>void onAction('dismiss_request',{requestId:q.id})}>Descartar</button></div>
     :<form onSubmit={e=>{e.preventDefault();if(!value)return;void onAction('answer',secret?{requestId:q.id,value,secret:true,secretRef:q.secretRef||undefined}:{requestId:q.id,...(q.kind==='input'?{value}:{instruction:value})}).then(()=>setAnswers(old=>({...old,[q.id]:''})));}}>
      {secret?<input type="password" autoComplete="off" aria-label="Valor do segredo" placeholder="Valor do segredo (fica só nesta máquina)" value={value} onChange={e=>setAnswers(old=>({...old,[q.id]:e.target.value}))}/>:<textarea aria-label="Resposta" placeholder={q.kind==='input'?'Valor a usar':'Instrução para o agente'} value={value} onChange={e=>setAnswers(old=>({...old,[q.id]:e.target.value}))}/>}
      <footer><button type="submit" className="agent-primary" disabled={busy||!value}>{secret?`Responder como segredo${q.secretRef?` “${q.secretRef}”`:''}`:'Responder'}</button><button type="button" disabled={busy} onClick={()=>void onAction('dismiss_request',{requestId:q.id})}>Descartar</button></footer></form>}
    </article>;})}</div>:<p className="agent-quiet">Nenhuma pergunta aberta. Quando o agente precisar de algo, ela aparece aqui e no chat dele.</p>}</section>

  <section className="harness-card"><div className="harness-card-title"><h3>Respostas lembradas</h3><span>{remembered.length?`${remembered.length} no projeto`:''}</span></div>
   {remembered.length?<div className="help-list">{remembered.map(h=><article key={h.id} className="help-request"><header><span className="harness-status">{KIND[h.kind]??h.kind}</span>{where(h)}<small>usada em {h.uses?.length??0} {h.uses?.length===1?'missão':'missões'}</small><button className="help-forget" aria-label="Esquecer esta resposta" title="Esquecer" disabled={busy} onClick={()=>void onAction('forget_help',{id:h.id})}><Trash2 size={13}/></button></header>
     <h4>{h.question}</h4><p>{h.answer?.type==='secretRef'?<>Segredo local <code>{h.answer.secretRef}</code>, usado pelo agente por referência.</>:h.answer?.value}</p></article>)}</div>
   :<p className="agent-quiet">Nada lembrado ainda. As respostas aparecem aqui e no mapa versionado do projeto.</p>}</section>
 </div>;
}
