import {screenApis,splitApis} from './api-role.mjs';
const clip=(text,max)=>{const value=String(text??'').replace(/\s+/g,' ').trim();return value.length>max?value.slice(0,max-1)+'…':value;};
const api=a=>`${a.method} ${a.path}`;
const screenOf=(graph,stateId)=>graph.screens.find(s=>s.id===graph.states.find(x=>x.id===stateId)?.screenId);

/** Controls of an observed state that can be tapped but have never been followed from it. */
export function unmappedActions(graph,observation){
 if(!observation)return [];
 const used=new Set(graph.transitions.filter(t=>t.confirmed&&t.from===observation.stateId&&t.action?.elementIdentity).map(t=>t.action.elementIdentity));
 return (observation.elements??[]).filter(e=>e.visible!==false&&!e.disabled&&e.actions?.includes('click')&&!used.has(e.identity)).map(e=>({identity:e.identity,label:e.label||e.name,tag:e.resourceId?.split(/[:/]/).at(-1)}));
}
/** What is known to happen from a screen: each action, where it leads (another screen or a state of this one) and what it calls. */
export function mappedActions(graph,screenId){
 const seen=new Map();
 for(const t of graph.transitions){
  if(!t.confirmed||t.action?.type==='deeplink'||screenOf(graph,t.from)?.id!==screenId)continue;
  const to=screenOf(graph,t.to),same=to?.id===screenId,state=graph.states.find(s=>s.id===t.to);
  if(same&&t.to===t.from)continue;
  const name=t.action?.type==='wait'?'(automático)':t.action?.type==='back'?'(voltar)':t.action?.type==='scroll'?`(rolar ${t.action.direction??'down'})`:t.name,target=same?`estado ${state?.name??'?'}`:to?.name??'?',key=name+'>'+target;
  const entry=seen.get(key)??{name,target,same,apis:new Set()};for(const a of splitApis(graph,t).action)entry.apis.add(`${api(a)}${a.statuses?.length?' '+a.statuses.join('/'):''}`);seen.set(key,entry);
 }
 return [...seen.values()];
}
/**
 * Everything an agent needs to place itself on one screen, as a few plain lines:
 * what the app calls it, how to get there, what it loads, what its controls do and which ones nobody has tried.
 */
export function screenContext(graph,screen,{observation,appId,platform,stateLabel,stateLabels}={}){
 const calls=screenApis(graph,screen.id),mapped=mappedActions(graph,screen.id),unmapped=unmappedActions(graph,observation),declared=graph.declaredDeeplinks?.[screen.target]??[];
 const lines=[`Tela: ${screen.name} (id ${screen.id.slice(0,8)})${appId?` · ${platform??'app'} ${appId}`:''}`];
 if(screen.description)lines.push(`Finalidade: ${clip(screen.description,300)}`);
 if(screen.fragment)lines.push(`Fragment: ${screen.fragment}`);
 if(screen.header)lines.push(`Cabeçalho: ${screen.header}`);
 if(screen.route)lines.push(`Activity/rota: ${screen.route}`);
 if(stateLabel)lines.push(`Estado exibido: ${stateLabel}${stateLabels?.length>1?` (estados conhecidos: ${stateLabels.join(', ')})`:''}`);
 if(screen.deeplinks?.length)lines.push(`Deeplink verificado: ${screen.deeplinks.map(d=>d.url).join(', ')}`);
 else if(declared.length)lines.push(`Deeplink: nenhum verificado para esta tela (o app declara ${declared.map(d=>d.pattern+(d.match==='prefix'?'*':'')).join(', ')})`);
 if(calls.load.length)lines.push(`Ao entrar chama: ${calls.load.map(api).join(', ')}`);
 if(mapped.length)lines.push('Ações mapeadas:',...mapped.slice(0,25).map(m=>`- "${clip(m.name,50)}" → ${m.target}${m.apis.size?` [${[...m.apis].join(', ')}]`:''}`));
 if(unmapped.length)lines.push(`Ações não mapeadas (${unmapped.length}): ${unmapped.slice(0,30).map(u=>`"${clip(u.label,40)}"`).join(', ')}`);
 lines.push(`No Navloom (MCP): navloom_goto com screen "${screen.name}" leva até aqui pelo caminho já conhecido.`);
 return lines.join('\n');
}
