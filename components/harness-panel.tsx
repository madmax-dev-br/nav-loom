'use client';
import {Bot,Braces,Check,CircleDashed,Eye,FileCode2,GitBranch,Link2,MousePointerClick,Route,ScrollText,Sparkles,X} from 'lucide-react';
import {apiText} from '@/components/agent-map';
import {splitApis} from '@/lib/api-role.mjs';
import {useState} from 'react';
import {Pencil,Plus} from 'lucide-react';
import {ScriptEditor} from '@/components/script-editor';

type Obj=Record<string,any>;
const KIND:Record<string,{label:string;help:string}>={
 logcat:{label:'Requests no log',help:'Reconhece chamadas de API nas linhas de log do app.'},
 screen:{label:'Identidade de tela',help:'Dá o mesmo identificador à mesma tela, mesmo quando o texto muda.'},
 path:{label:'Caminho de API',help:'Agrupa chamadas iguais trocando as partes variáveis do caminho.'},
 capture:{label:'Informação da tela',help:'Extrai de cada captura os campos e etiquetas que aparecem no menu de cada tela salva.'},
};
const STATUS:Record<string,string>={proposed:'Aguardando aprovação',active:'Ativo',failed:'Exemplos falharam',disabled:'Desativado',rejected:'Rejeitado'};
const EVENT:Record<string,string>={match:'reconheceu',proposed:'proposto',approved:'aprovado',failed:'falhou',disabled:'desativado',rejected:'rejeitado'};
const show=(value:unknown)=>typeof value==='string'?value:JSON.stringify(value);
/** One number of the panel, never shown bare: the amount, its unit, what to say when there is none, and the sentence that explains what is being counted. */
type Count={n:number;of?:number;own?:boolean;one:string;many:string;none?:string;title:string};
// The unit agrees with the total ("2 de 5 scripts ativos") unless it describes the part itself (own: "1 de 20 concluída").
const countNumber=(c:Count)=>`${c.n}${c.of===undefined?'':` de ${c.of}`}`,countUnit=(c:Count)=>(c.own?c.n:c.of??c.n)===1?c.one:c.many,countText=(c:Count)=>`${countNumber(c)} ${countUnit(c)}`;

/** What the harness knows and how it got there: the working loop, the project, its flows, learned scripts and their activity. */
export function HarnessPanel({data,graph,busy,onReview,onPropose,onTry}:{data?:Obj;graph:Obj;busy:boolean;onReview:(id:string,decision:string)=>void;onPropose:(script:Obj,activate:boolean)=>Promise<void>;onTry:(kind:string,code:string,input:Obj)=>Promise<Obj>}){
 const [editing,setEditing]=useState<Obj|null|undefined>(undefined);
 const config=data?.config,scripts:Obj[]=data?.harness?.scripts??[],activity:Obj[]=(data?.harness?.activity??[]).slice().reverse(),runs:Obj[]=data?.runs??[],active=runs.find(r=>r.id===data?.activeRun);
 const screenOf=(stateId:string)=>graph.screens.find((s:Obj)=>s.id===graph.states.find((x:Obj)=>x.id===stateId)?.screenId);
 const apis=new Set<string>(graph.transitions.flatMap((t:Obj)=>(t.apis??[]).map(apiText)));
 const steps=runs.reduce((n,r)=>n+r.steps.length,0),reused=runs.reduce((n,r)=>n+(r.metrics?.replayedSteps??0),0),failedSteps=runs.reduce((n,r)=>n+r.steps.filter((s:Obj)=>['failed','diverged'].includes(s.status)).length,0),finished=runs.filter(r=>r.status==='completed').length;
 const matches=scripts.reduce((n,s)=>n+(s.stats?.matches??0),0),activeScripts=scripts.filter(s=>s.status==='active').length,waiting=scripts.filter(s=>s.status==='proposed').length;
 // A transition is every distinct action kept in the map; only those that leave a screen are the connections drawn between screens.
 const screenIdOf=new Map<string,string>(graph.states.map((s:Obj)=>[s.id,s.screenId])),between=graph.transitions.filter((t:Obj)=>screenIdOf.get(t.from)!==screenIdOf.get(t.to)).length;
 const nameOf=(id?:string)=>graph.screens.find((x:Obj)=>x.id===id)?.name??'uma tela desconhecida';
 const routes:Obj[]=Object.entries((graph.routes??{}) as Record<string,Obj>).map(([id,memo]):Obj=>({id,name:nameOf(id),...memo})).sort((x,y)=>String(y.lastAt).localeCompare(String(x.lastAt)));
 const targets=Object.values(config?.targets??{}) as Obj[],declared=Object.values(graph.declaredDeeplinks??{}).flat() as Obj[];
 // Every number is a total of this project, over all its missions. Zero is said in words; a second number only appears when the first one exists.
 const stages:{icon:typeof Bot;title:string;text:string;counts:Count[]}[]=[
  {icon:Bot,title:'Agente',text:'Um agente externo decide o que fazer e fala com o Navloom por MCP.',counts:[
   {n:runs.length,one:'missão aberta',many:'missões abertas',none:'Nenhuma missão ainda',title:'Missões que o agente abriu neste projeto, em qualquer situação: concluídas, pausadas, bloqueadas ou em andamento.'},
   {n:finished,of:runs.length,own:true,one:'concluída',many:'concluídas',title:'Missões que chegaram ao fim. As outras estão em andamento, pausadas ou bloqueadas.'}]},
  {icon:Eye,title:'Observa',text:'O Navloom lê a tela do app e devolve só o que importa: elementos, texto e saídas conhecidas.',counts:[
   {n:graph.screens.length,one:'tela no mapa',many:'telas no mapa',none:'Nenhuma tela mapeada ainda',title:'Telas diferentes do app guardadas no mapa deste projeto.'},
   {n:graph.states.length,one:'estado de tela',many:'estados de tela',title:'Variações das telas guardadas no mapa: a mesma tela vazia, com erro, preenchida ou em outra aba conta como estados diferentes.'}]},
  {icon:MousePointerClick,title:'Age',text:'Cada toque, preenchimento ou deeplink é executado no dispositivo com captura antes e depois.',counts:[
   {n:steps,one:'passo executado',many:'passos executados',none:'Nenhum passo executado ainda',title:'Ações executadas no dispositivo, somando todas as missões do projeto. Inclui os passos repetidos de caminhos conhecidos e os que falharam.'},
   {n:failedSteps,of:steps,one:'com falha',many:'com falha',title:'Passos em que a ação deu erro ou o app foi para um lugar diferente do esperado.'}]},
  {icon:GitBranch,title:'Registra',text:'A transição vira uma conexão do mapa, com as chamadas de API que ela disparou.',counts:[
   {n:graph.transitions.length,one:'transição no mapa',many:'transições no mapa',none:'Nenhuma transição registrada ainda',title:'Ações diferentes guardadas no mapa, cada uma com o estado de origem e o de destino. Um passo repetido não conta de novo. Inclui preenchimentos e rolagens que ficam na mesma tela.'},
   {n:between,of:graph.transitions.length,own:true,one:'muda de tela',many:'mudam de tela',title:'Transições que saem de uma tela e chegam em outra: são as conexões entre telas do mapa.'},
   {n:apis.size,one:'API diferente',many:'APIs diferentes',title:'Chamadas de API distintas (método e caminho) disparadas por essas transições.'}]},
  {icon:Sparkles,title:'Aprende',text:'Padrões estáveis viram scripts do projeto. Depois de aprovados, o reconhecimento deixa de depender do agente.',counts:[
   {n:activeScripts,of:scripts.length,one:'script ativo',many:'scripts ativos',none:'Nenhum script ainda',title:'Scripts aprovados e em uso, entre todos os scripts do projeto (propostos, desativados e rejeitados também contam no total).'},
   {n:reused,of:steps,one:'passo sem o agente',many:'passos sem o agente',title:'Passos que o Navloom repetiu sozinho por um caminho já conhecido, sem o agente decidir, entre todos os passos executados no projeto.'}]},
 ];
 const narrative=(flow:Obj)=>{const order=new Map<string,number>(flow.screenIds.map((id:string,i:number)=>[id,i])),lines=new Map<string,Obj>(),exits=new Map<string,Obj>();
  for(const t of graph.transitions){if(!t.confirmed||['back','deeplink'].includes(t.action?.type))continue;const from=screenOf(t.from),to=screenOf(t.to);if(!from||!to||from.id===to.id||!order.has(from.id))continue;
   if(order.has(to.id)){const key=from.id+to.id+t.name,line=lines.get(key)??{from,to,via:t.action?.type==='wait'?'carregamento':t.name,apis:new Set<string>()};for(const api of splitApis(graph,t).action)line.apis.add(apiText(api));lines.set(key,line);}
   else{const other=(graph.flows??[]).find((f:Obj)=>f.id!==flow.id&&f.screenIds.includes(to.id));if(other)exits.set(from.id+other.id,{from,via:t.name,flow:other});}}
  return {lines:[...lines.values()].sort((a,b)=>order.get(a.from.id)!-order.get(b.from.id)!),exits:[...exits.values()]};};
 return <div className="harness">
  <header className="harness-intro"><p className="agent-eyebrow">Harness</p><h2>O Navloom dirige o app, guarda o que viu e aprende os padrões do projeto.</h2><p>O agente explora uma vez. O que foi confirmado vira mapa, e o que se repete vira script: da próxima vez o Navloom reconhece sozinho, do mesmo jeito, sem gastar raciocínio do agente.</p><span className={'harness-live '+(active?'is-running':'')}><i/>{active?`Agente navegando: ${active.objective}`:'Nenhuma missão em andamento'}</span></header>

  <section aria-label="Como funciona"><ol className="harness-loop">{stages.map((stage,i)=><li key={stage.title} className={active&&i>0&&i<4?'is-live':''}><span className="harness-step" title={`Etapa ${i+1} de ${stages.length} do ciclo. Não é uma contagem.`}>Etapa {i+1}</span><stage.icon size={20}/><h3>{stage.title}</h3><p>{stage.text}</p>
    <div className="harness-counts">{stage.counts.map((c,k)=>k&&!stage.counts[0].n?null:c.n||c.of?<span key={c.many} title={c.title}><b>{countNumber(c)}</b> {countUnit(c)}</span>:c.none?<span key={c.many} className="is-zero" title={c.title}>{c.none}</span>:null)}</div></li>)}</ol>
   <p className="harness-counts-note">Os números de cada etapa são totais deste projeto, somando todas as missões. Passe o mouse sobre um número para ver o que ele conta.</p></section>

  <div className="harness-columns">
   <section className="harness-card"><h3>O projeto</h3><h4>{config?.name??'Projeto sem configuração'}</h4><p>{config?.description||'Sem descrição. Ela vem do navloom.yaml do projeto.'}</p>
    <dl className="harness-facts">{targets.map((t,i)=><div key={i}><dt>{t.platform==='android'?'App Android':'Aplicação web'}</dt><dd><code>{t.package??t.url}</code></dd></div>)}
     <div><dt>Captura de API</dt><dd>{targets.some(t=>t.network?.reverse?.length)?'Proxy no adb reverse e linhas de log':'Linhas de log do app'}</dd></div>
     <div><dt>Deeplinks declarados</dt><dd>{declared.length?declared.map(d=><code key={d.pattern+d.match}>{d.pattern}{d.match==='prefix'?'*':''}</code>):'Nenhum lido ainda'}</dd></div>
     <div><dt>Última missão</dt><dd>{runs[0]?`${runs[0].objective} · ${runs[0].status}`:'Nenhuma ainda'}</dd></div></dl></section>

   <section className="harness-card"><h3>Os fluxos</h3>{(graph.flows??[]).length?graph.flows.map((flow:Obj)=>{const {lines,exits}=narrative(flow);return <article className="harness-flow" key={flow.id}><h4>{flow.name}</h4>{flow.description&&<p>{flow.description}</p>}
     <ol>{lines.map((line,i)=><li key={i}><span>Em <b>{line.from.name}</b>, “{line.via}” leva a <b>{line.to.name}</b>.</span>{[...line.apis].map(api=><code key={api as string}><Braces size={11}/>{api as string}</code>)}</li>)}
      {exits.map((exit,i)=><li key={'x'+i} className="is-exit"><span>De <b>{exit.from.name}</b>, “{exit.via}” segue para o fluxo <b>{exit.flow.name}</b>.</span></li>)}</ol>
     {!lines.length&&!exits.length&&<p className="agent-quiet">As telas deste fluxo ainda não têm conexões confirmadas entre si.</p>}
     {flow.screenIds.some((id:string)=>graph.screens.find((s:Obj)=>s.id===id)?.deeplinks?.length)&&<p className="harness-entry"><Link2 size={12}/>Entradas por deeplink: {flow.screenIds.flatMap((id:string)=>graph.screens.find((s:Obj)=>s.id===id)?.deeplinks??[]).map((d:Obj)=>d.url).join(', ')}</p>}</article>;})
    :<p className="agent-quiet">Nenhum fluxo ainda. O agente agrupa telas em fluxos ao terminar uma exploração.</p>}</section>
  </div>

  <section className="harness-card"><div className="harness-card-title"><h3><Route size={15}/> Rotas diretas</h3>{routes.length>0&&<span title="Telas de destino para as quais o Navloom já tentou ir sozinho, e em quantas delas a tentativa mais recente chegou.">{countText({n:routes.filter(r=>r.lastStatus==='arrived').length,of:routes.length,one:'rota chegou',many:'rotas chegaram',title:''})} na última tentativa</span>}</div>
   <p className="harness-note">Para cada tela já mapeada, o Navloom monta um grafo de decisão: em cada estado conhecido, qual ação leva mais perto. Chegar lá não usa o agente; ele só é chamado quando o app cai em terreno desconhecido, e o passo que ele der entra no grafo.</p>
   {routes.length?<ul className="harness-routes">{routes.map(r=><li key={r.id}><strong>{r.name}</strong><span className={'harness-status '+(r.lastStatus==='arrived'?'is-active':'is-proposed')}>{r.lastStatus==='arrived'?'Chegou':'Parou'}</span>
     <span title="Quantas vezes o Navloom chegou a esta tela sozinho, entre todas as vezes em que tentou.">Chegou em {r.arrived} de {r.runs} {r.runs===1?'tentativa':'tentativas'}</span><span title="Números da tentativa mais recente: ações executadas, tempo gasto e quantas vezes precisou reencontrar o caminho.">Última: {r.lastSteps} {r.lastSteps===1?'passo':'passos'} · {(r.lastMs/1000).toFixed(1)} s{r.lastRecoveries?` · ${r.lastRecoveries} ${r.lastRecoveries===1?'recuperação':'recuperações'}`:''}</span>
     <small>{r.lastStatus==='arrived'?`Saindo de ${nameOf(r.lastFrom)}, sem chamadas ao agente.`:`Parou em ${nameOf(r.stuckAt)}: daqui o agente continua, e o caminho fica aprendido.`}</small></li>)}</ul>
   :<p className="agent-quiet">Nenhuma rota direta usada ainda. Quando o agente pedir para ir a uma tela conhecida, o resultado aparece aqui.</p>}</section>

  <section className="harness-card"><div className="harness-card-title"><h3>Scripts aprendidos</h3>{scripts.length>0&&<span title="Scripts aprovados e em uso entre todos os do projeto; propostas que esperam a sua aprovação; e quantas entradas (linhas de log, telas, caminhos de API) os scripts reconheceram, somando as revisões atuais.">{countText({n:activeScripts,of:scripts.length,one:'script ativo',many:'scripts ativos',title:''})}{waiting?` · ${waiting} aguardando você`:''} · {matches?`${matches} ${matches===1?'entrada reconhecida':'entradas reconhecidas'}`:'nenhuma entrada reconhecida ainda'}</span>}</div>
   <p className="harness-note">O agente propõe; nada escrito por ele roda antes da sua aprovação. Ao aprovar, os exemplos são executados e o script só é ativado se todos conferirem. Você também pode escrever os seus ou editar qualquer um: um script de <b>informação da tela</b> roda em cada captura e mostra o que você quiser no menu de cada tela salva.</p>
   <button className="agent-primary" disabled={busy} onClick={()=>setEditing(null)}><Plus size={13}/> Novo script</button>
   {editing!==undefined&&<ScriptEditor key={editing?.id??'new'} initial={editing??undefined} busy={busy} onTry={onTry} onClose={()=>setEditing(undefined)} onSave={async(script,activate)=>{await onPropose(script,activate);setEditing(undefined);}}/>}
   {scripts.length?<div className="harness-scripts">{scripts.map(script=><article key={script.id} className={'harness-script is-'+script.status}>
     <header><FileCode2 size={16}/><div><h4>{script.name}</h4><small>{KIND[script.kind]?.label} · <code>{script.id}.js</code> · revisão {script.revision}</small></div><span className={'harness-status is-'+script.status}>{STATUS[script.status]??script.status}</span></header>
     <p>{script.description||KIND[script.kind]?.help}</p>
     <dl className="harness-stats"><div title={`Vezes em que o script rodou sobre uma entrada (uma linha de log, uma tela, um caminho de API) desde a revisão ${script.revision}. Só roda enquanto está ativo.`}><dt>Entradas analisadas</dt><dd>{script.stats?.runs??0}</dd></div><div title="Entradas em que o script devolveu um resultado. Nas outras ele respondeu que não era com ele."><dt>Reconhecidas</dt><dd>{script.stats?.matches??0}</dd></div><div title="Entradas em que o código falhou ou devolveu um formato inválido. Com 20 erros seguidos o script é desligado."><dt>Erros</dt><dd>{script.stats?.errors??0}</dd></div></dl>
     <details><summary>Código</summary><pre>{script.code}</pre></details>
     <button className="agent-subtle" disabled={busy} onClick={()=>setEditing(script)}><Pencil size={12}/> Editar</button>
     <details open={script.status!=='active'}><summary>{script.samples.length} {script.samples.length===1?'exemplo':'exemplos'}{script.results?` · ${script.results.filter((r:Obj)=>r.ok).length} de ${script.results.length} ${script.results.length===1?'confere':'conferem'}`:' · ainda não testados'}</summary><ul className="harness-samples">{script.samples.map((sample:Obj,i:number)=>{const result=script.results?.[i];return <li key={i} className={result?(result.ok?'is-ok':'is-bad'):''}>{result?(result.ok?<Check size={13}/>:<X size={13}/>):<CircleDashed size={13}/>}<code>{show(sample.input.line??sample.input)}</code><span>→ <code>{show(sample.expect??null)}</code></span>{result&&!result.ok&&<small>obtido: {show(result.error??result.got??null)}</small>}</li>;})}</ul></details>
     <footer>{['proposed','failed','disabled','rejected'].includes(script.status)&&<button className="agent-primary" disabled={busy} onClick={()=>onReview(script.id,'approve')}>{script.status==='proposed'?'Aprovar e testar':'Testar e ativar'}</button>}{script.status==='proposed'&&<button disabled={busy} onClick={()=>onReview(script.id,'reject')}>Rejeitar</button>}{script.status==='active'&&<button disabled={busy} onClick={()=>onReview(script.id,'disable')}>Desativar</button>}</footer>
    </article>)}</div>:<p className="agent-quiet">Nenhum script ainda. Quando o agente notar um padrão estável — por exemplo, o formato em que o app registra suas requisições no log — ele propõe um script aqui.</p>}</section>

  <section className="harness-card"><div className="harness-card-title"><h3><ScrollText size={15}/> Atividade do harness</h3>{activity.length>0&&<span title="Propostas, aprovações e reconhecimentos dos scripts. A lista guarda só os eventos mais recentes; o total de cada script está no cartão dele.">{Math.min(activity.length,40)} {Math.min(activity.length,40)===1?'evento mais recente':'eventos mais recentes'}, do mais novo ao mais antigo</span>}</div>
   {activity.length?<ol className="harness-activity">{activity.slice(0,40).map((entry,i)=><li key={i} className={'is-'+entry.event}><time>{new Date(entry.time).toLocaleTimeString()}</time><b>{scripts.find(s=>s.id===entry.scriptId)?.name??entry.scriptId}</b><span>{EVENT[entry.event]??entry.event}</span>{entry.input&&<code>{entry.input}</code>}<code className="is-output">{entry.output}</code></li>)}</ol>:<p className="agent-quiet">Sem atividade ainda. Cada reconhecimento feito por um script aparece aqui enquanto o agente navega.</p>}</section>
 </div>;
}
