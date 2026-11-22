import {entryPoints,entryLines,flowTree} from './flowgraph.mjs';
import {branchLines} from './outcomes.mjs';
import {mkdir,readFile,writeFile,rename,access} from 'node:fs/promises';
import {join} from 'node:path';
import {parse,stringify} from 'yaml';
import {decodePng,scalePng} from './png.mjs';
import {encodeJpeg} from './jpeg.mjs';
import {endpointIndex} from './network.mjs';
import {emptyGraph,uid} from './store.mjs';
import {publicEntry} from './help.mjs';
/**
 * The map is the committed, text-only memory of an application: screens, states, transitions, API endpoints and
 * deeplinks with deterministic summaries and agent descriptions. Runs and full-size evidence stay local; thumbnails are
 * optional. A fresh checkout renders this map without any local service state.
 */
const byTime=(a,b)=>String(a.createdAt??a.firstSeen??'').localeCompare(String(b.createdAt??b.firstSeen??''))||a.id.localeCompare(b.id);
function trimDiff(diff){if(!diff)return null;const {textAdded=[],textRemoved=[],elementsAdded=[],elementsRemoved=[],markersAdded=[],routeChanged=false,headingChanged=false,textAddedCount=0,textRemovedCount=0}=diff;return {routeChanged,headingChanged,textAdded:textAdded.slice(0,6),textRemoved:textRemoved.slice(0,6),textAddedCount,textRemovedCount,elementsAdded:elementsAdded.slice(0,6),elementsRemoved:elementsRemoved.slice(0,6),markersAdded};}
export function serializeMap(config,graph){
 const states=[...graph.states].sort(byTime),screens=[...graph.screens].sort(byTime),transitions=[...graph.transitions].sort((a,b)=>String(a.evidence?.[0]?.stepId??'').localeCompare(String(b.evidence?.[0]?.stepId??''))||a.id.localeCompare(b.id));
 return {version:1,kind:'navloom-map',project:{id:config.id,name:config.name,description:config.description},
  screens:screens.map(s=>({id:s.id,target:s.target,name:s.name,route:s.route,identity:s.identity,screenKey:s.screenKey??null,...(s.fragment?{fragment:s.fragment}:{}),...(s.header?{header:s.header}:{}),...(s.activity?{activity:s.activity}:{}),description:s.description||'',links:s.links??[],sources:s.sources??[],createdAt:s.createdAt})),
  states:states.map(s=>({id:s.id,screenId:s.screenId,name:s.name,stateKey:s.stateKey??null,...(s.scrollOf?{scrollOf:s.scrollOf}:{}),...(s.keyboard?{keyboard:true}:{}),...(s.semantic?.length?{semantic:s.semantic}:{}),...(s.info?{info:Object.fromEntries(Object.entries(s.info).map(([k,v])=>[k,{fields:v.fields,...(v.tags?.length?{tags:v.tags}:{})}]))}:{}),description:s.description||'',markers:s.markers??[],firstSeen:s.firstSeen,screenshot:s.thumbnail??null,digest:s.digest??null,hotspots:s.hotspots??[]})),
  transitions:transitions.map(t=>({id:t.id,signature:t.signature,from:t.from,to:t.to,kind:t.kind,outcome:t.outcome??null,name:t.name,action:t.action,target:t.target,profile:t.profile,preconditions:t.preconditions??{},version:t.version?{fingerprint:t.version.fingerprint}:null,confirmed:t.confirmed,cost:t.cost??1,summary:t.summary||'',description:t.description||'',network:t.apis??t.network??[],...(t.responses?.length?{responses:t.responses.map(r=>({key:r.key,count:r.count}))}:{}),diff:trimDiff(t.diff),imageChange:t.imageChange?{changedRatio:t.imageChange.changedRatio,region:t.imageChange.region}:null,evidence:t.evidence??[]})),
  deeplinks:(Array.isArray(graph.deeplinks)?graph.deeplinks:[]).map(d=>({url:d.url,target:d.target,screenId:d.screenId,stateId:d.stateId,verifiedAt:d.verifiedAt,runId:d.runId,observationId:d.observationId})),
  endpoints:endpointIndex(graph).map(e=>({...e,links:graph.endpointLinks?.[`${e.method} ${e.path}`]??[]})),
  harness:(graph.harness??[]).filter(e=>e.remembered!==false).map(e=>{const p=publicEntry(e);return {id:p.id,kind:p.kind,question:p.question,why:p.why||'',screenId:p.screenId,stateId:p.stateId,elementIdentity:p.elementIdentity,answer:p.answer,resolvedAt:p.resolvedAt,uses:p.uses?.length??0};}),
  flows:(graph.flows??[]).map(f=>({id:f.id,name:f.name,description:f.description,screenIds:f.screenIds,runIds:f.runIds??[]})),
  // How to get into each screen and flow, for an agent or a person asked to go somewhere.
  entryPoints:entryPoints(graph),
  // Screens and states folded into others: a capture that still produces an old id lands on the one kept.
  ...(Object.keys(graph.aliases??{}).length?{aliases:graph.aliases}:{}),...(Object.keys(graph.stateAliases??{}).length?{stateAliases:graph.stateAliases}:{})};
}
export function renderMarkdown(map){
 const screen=id=>map.screens.find(s=>s.id===id),state=id=>map.states.find(s=>s.id===id);
 const lines=[`# ${map.project.name} — mapa de navegação`,'',map.project.description||'','',`Gerado pelo Navloom a partir de interações observadas. Cada transição tem evidência de uma ação real; descrições de negócio são interpretações versionadas.`,'',`- Telas: ${map.screens.length}`,`- Estados: ${map.states.length}`,`- Transições confirmadas: ${map.transitions.filter(t=>t.confirmed).length}`,`- Endpoints de API observados: ${map.endpoints.length}`,`- Deeplinks verificados: ${map.deeplinks.length}`,''];
 const ways=map.entryPoints?entryLines(map.entryPoints):[];if(ways.length){lines.push('## Pontos de entrada','','Como chegar a cada tela sem explorar: o caminho mais curto desde a abertura do app (o que `navloom_goto` segue), as telas por onde se passa sempre, deeplinks verificados e controles que abrem a tela de qualquer lugar.','',...ways.map(l=>`- ${l}`),'');}
 for(const env of Object.keys(map.entryPoints?.tree??{})){const tree=flowTree(map.entryPoints,env);if(tree.length>1)lines.push(`## Árvore de fluxo${env!=='default'?` (${env})`:''}`,'','Cada tela fica sob a tela por onde todo caminho até ela passa (dominador imediato). Um ramo é um fluxo que só começa dali.','',...tree,'');}
 const answers=branchLines(map);if(answers.length)lines.push('## Respostas que mudam o destino','','A mesma ação leva a telas ou estados diferentes conforme o que o backend respondeu.','',...answers.map(l=>`- ${l}`),'');
 if(map.flows.length){lines.push('## Fluxos','');for(const flow of map.flows)lines.push(`- **${flow.name}**: ${flow.description||''} — ${flow.screenIds.map(id=>screen(id)?.name??id).join(' → ')}`);lines.push('');}
 lines.push('## Telas','');
 for(const s of map.screens){lines.push(`### ${s.name}`,'',`\`${s.route}\` · identidade ${s.identity} · alvo ${s.target}`,'');if(s.description)lines.push(s.description,'');
  const states=map.states.filter(x=>x.screenId===s.id);lines.push(`**Estados (${states.length})**`,'');
  for(const st of states){lines.push(`- ${st.name}${st.markers?.length?` · ${st.markers.join(', ')}`:''}${st.description?` — ${st.description}`:''}`);if(st.screenshot)lines.push(`  ![${st.name}](${st.screenshot})`);if(st.digest)lines.push('  <details><summary>Grafo textual da tela</summary>','','  ```',...st.digest.split('\n').map(l=>'  '+l),'  ```','','  </details>');
   const out=map.transitions.filter(t=>t.from===st.id&&t.confirmed);for(const t of out){const dest=state(t.to),destScreen=dest?screen(dest.screenId):null;lines.push(`  - ${t.summary||t.name} → ${destScreen?.name??'?'}${dest&&dest.name!==destScreen?.name?` / ${dest.name}`:''}${t.network?.length?` · API: ${t.network.map(n=>`${n.method} ${n.path}${n.statuses.length?` (${n.statuses.join('/')})`:''}`).join(', ')}`:''}${t.description?`\n    - ${t.description}`:''}`);}}
  if(s.sources?.length)lines.push('',`Código: ${s.sources.map(l=>`\`${l.repository}:${l.path}${l.line?':'+l.line:''}\` (${l.role}, ${l.status})`).join(', ')}`);
  const links=map.deeplinks.filter(d=>d.screenId===s.id);if(links.length)lines.push('',`Deeplinks verificados: ${links.map(d=>`\`${d.url}\``).join(', ')}`);
  if(s.links?.length)lines.push('',`Links observados: ${s.links.slice(0,12).map(l=>`\`${l}\``).join(', ')}${s.links.length>12?' …':''}`);
  lines.push('');}
 if(map.endpoints.length){lines.push('## Endpoints de API','','| Método | Caminho | Status | Chamadas | Telas de origem | Backend |','| --- | --- | --- | --- | --- | --- |');for(const e of map.endpoints)lines.push(`| ${e.method} | \`${e.path}\` | ${e.statuses.join(', ')||'—'} | ${e.count} | ${e.screens.map(id=>screen(id)?.name??id).join(', ')} | ${(e.links??[]).map(l=>`\`${l.repository}:${l.path}${l.line?':'+l.line:''}\` (${l.status})`).join(', ')||'—'} |`);lines.push('');}
 if(map.harness?.length){lines.push('## Harness: ajuda registrada','','Respostas dadas por pessoas quando o agente não conseguiu avançar. Segredos ficam fora do repositório; aqui só a referência.','');for(const h of map.harness)lines.push(`- **${h.kind}** em ${screen(h.screenId)?.name??'(sem tela)'}${h.elementIdentity?` · \`${h.elementIdentity.split('|')[0]}\``:''}: ${h.question} → ${h.answer?.type==='secretRef'?`segredo \`${h.answer.secretRef}\``:h.answer?.value}${h.uses?` · usado em ${h.uses} execução(ões)`:''}`);lines.push('');}
 if(map.deeplinks.length){lines.push('## Deeplinks','','| URL | Tela | Estado | Verificado em |','| --- | --- | --- | --- |');for(const d of map.deeplinks)lines.push(`| \`${d.url}\` | ${screen(d.screenId)?.name??d.screenId} | ${state(d.stateId)?.name??''} | ${d.verifiedAt} |`);lines.push('');}
 return lines.join('\n');
}
async function atomic(file,data){const temp=`${file}.${uid()}.tmp`;await writeFile(temp,data);await rename(temp,file);}
export async function exportMap(store,config,graph){
 const settings=config.map;if(!settings?.enabled)return null;const dir=join(store.root,settings.dir);await mkdir(join(dir,'states'),{recursive:true});
 if(settings.screenshots){for(const state of graph.states){/* States recorded before a representative capture was kept fall back to their latest observation. */const shot=state.representative?.screenshot??(state.lastSeen?`evidence/${state.lastSeen}.png`:null);if(state.thumbnail||!shot)continue;const file=`states/${state.id}.jpg`;try{await access(join(dir,file));state.thumbnail=file;continue;}catch{}
  try{const image=scalePng(decodePng(await store.resource(shot)),settings.thumbnailWidth);await atomic(join(dir,file),encodeJpeg(image,settings.thumbnailQuality??70));state.thumbnail=file;}catch{/* evidence missing locally; the map keeps text only for this state */}}}
 const map=serializeMap(config,graph);await atomic(join(dir,'map.yaml'),stringify(map,{lineWidth:0}));await atomic(join(dir,'README.md'),renderMarkdown(map));return {dir,screens:map.screens.length,states:map.states.length,transitions:map.transitions.length,endpoints:map.endpoints.length,deeplinks:map.deeplinks.length};
}
/** Rebuild a graph from the committed map. Evidence references stay as recorded; they may not exist locally. */
export async function importMap(dir){
 const map=parse(await readFile(join(dir,'map.yaml'),'utf8'));if(map?.kind!=='navloom-map'||map.version!==1)throw Error('Unsupported map file');
 const graph=emptyGraph();
 graph.screens=map.screens.map(s=>({...s,sources:s.sources??[],links:s.links??[]}));
 graph.states=map.states.map(s=>({id:s.id,screenId:s.screenId,name:s.name,...(s.scrollOf?{scrollOf:s.scrollOf}:{}),...(s.keyboard?{keyboard:true}:{}),...(s.semantic?{semantic:s.semantic}:{}),...(s.info?{info:s.info}:{}),description:s.description??'',markers:s.markers??[],firstSeen:s.firstSeen,lastSeen:s.firstSeen,hotspots:s.hotspots??[],thumbnail:s.screenshot??null,digest:s.digest??null,stateKey:s.stateKey??null}));
 graph.transitions=map.transitions.map(({network,...t})=>({...t,evidence:t.evidence??[],apis:network??[],version:t.version??null,description:t.description??'',summary:t.summary??''}));
 graph.deeplinks=map.deeplinks??[];for(const d of graph.deeplinks){const screen=graph.screens.find(s=>s.id===d.screenId);if(screen){screen.deeplinks??=[];if(!screen.deeplinks.some(x=>x.url===d.url))screen.deeplinks.push({url:d.url,state:d.stateId});}}graph.harness=(map.harness??[]).map(h=>({...h,uses:[],resolvedBy:'user',remembered:true}));graph.endpointLinks=Object.fromEntries((map.endpoints??[]).filter(e=>e.links?.length).map(e=>[`${e.method} ${e.path}`,e.links]));graph.flows=(map.flows??[]).map(f=>({...f,updatedAt:null}));if(map.aliases)graph.aliases=map.aliases;if(map.stateAliases)graph.stateAliases=map.stateAliases;graph.imported={from:'map',at:new Date().toISOString()};
 return graph;
}
