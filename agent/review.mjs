import {mergeApis} from './network.mjs';

/**
 * Mission modes.
 * - `record`: the agent maps; what it found waits for a person to approve before it joins the recorded map.
 * - `validate`: the agent walks what is recorded; anything that differs (a screen, a destination, an API) is reported
 *   and only replaces the recorded map when approved.
 * - `walk`: just get somewhere. Nothing is recorded and nothing is compared.
 */
export const MODES=['record','validate','walk'];
export const normalizeMode=mode=>({exploratory:'record',focused:'validate'})[mode]??mode;

const apiKey=api=>`${api.method} ${api.host??''}${api.path}`,label=api=>`${api.method} ${api.path}`;
/**
 * What one mission did against the map as it was recorded when the mission began.
 * `walked` is where it went. `items` are the things a person has to look at: `new` did not exist, `different` contradicts
 * what was recorded (another destination for the same action, a known screen in a state never seen while validating,
 * API calls that appeared, disappeared or answered with another status).
 */
export function reviewChanges(base,current,run){
 const screens=new Map(current.screens.map(s=>[s.id,s])),states=new Map(current.states.map(s=>[s.id,s])),screenOf=id=>states.get(id)?.screenId,name=id=>screens.get(id)?.name??'?';
 // A screen with several states is named with the state, so two differences on the same screen do not read the same.
 const at=id=>{const state=states.get(id),many=current.states.filter(s=>s.screenId===state?.screenId).length>1;return name(state?.screenId)+(many&&state?.name?` (${state.name})`:'');};
 const baseScreens=new Set(base.screens.map(s=>s.id)),baseStates=new Set(base.states.map(s=>s.id)),baseEdges=new Map(base.transitions.map(e=>[e.id,e]));
 const visited=[...new Set(run.observations.map(o=>o.stateId))].filter(id=>states.has(id)),walked=[...new Set(run.steps.map(s=>s.transitionId).filter(Boolean))].filter(id=>current.transitions.some(e=>e.id===id));
 const items=[];
 for(const id of new Set(visited.map(screenOf)))if(id&&!baseScreens.has(id))items.push({type:'new',kind:'screen',screenId:id,text:`Tela nova: ${name(id)}`});
 for(const id of visited){const state=states.get(id);if(baseStates.has(id)||!baseScreens.has(state.screenId))continue;const different=run.mode==='validate';items.push({type:different?'different':'new',kind:'state',screenId:state.screenId,stateId:id,text:different?`${name(state.screenId)} apareceu num estado que não estava gravado (${state.name})`:`Estado novo em ${name(state.screenId)}: ${state.name}`});}
 for(const id of walked){const edge=current.transitions.find(e=>e.id===id),from=screenOf(edge.from),to=screenOf(edge.to),where={transitionId:id,fromScreen:from,toScreen:to},known=baseEdges.get(id);
  if(!known){const action=JSON.stringify(edge.action),rival=base.transitions.find(b=>b.from===edge.from&&b.to!==edge.to&&b.target===edge.target&&b.profile===edge.profile&&JSON.stringify(b.action)===action);
   // Landing on the same screen in another state is reported by the state itself; only another screen contradicts the recorded destination.
   if(rival&&screenOf(rival.to)!==to)items.push({type:'different',kind:'destination',...where,expectedScreen:screenOf(rival.to),expectedTransitionId:rival.id,text:`“${edge.name}” em ${at(edge.from)} levou a ${at(edge.to)}; o gravado leva a ${name(screenOf(rival.to))}`});
   else items.push({type:'new',kind:'transition',...where,text:`Conexão nova: “${edge.name}” de ${name(from)} para ${name(to)}`});
   continue;}
  // The same action as recorded: compare what it asked the backend each time it was taken in this mission.
  const steps=run.steps.filter(s=>s.transitionId===id&&s.status!=='failed'),got=steps.reduce((all,step)=>mergeApis(all,step.network??[]),[]),expected=known.apis??[];
  const gotKeys=new Map(got.map(a=>[apiKey(a),a])),expectedKeys=new Map(expected.map(a=>[apiKey(a),a]));
  const added=got.filter(a=>!expectedKeys.has(apiKey(a))).map(label),missing=expected.filter(a=>!gotKeys.has(apiKey(a))),status=got.flatMap(a=>{const old=expectedKeys.get(apiKey(a)),fresh=old?(a.statuses??[]).filter(s=>!(old.statuses??[]).includes(s)):[];return fresh.length?[`${label(a)} respondeu ${fresh.join(', ')} (gravado: ${(old.statuses??[]).join(', ')||'sem resposta'})`]:[];});
  if(added.length||missing.length||status.length)items.push({type:'different',kind:'api',...where,added,missing:missing.map(label),missingKeys:missing.map(apiKey),status,text:`APIs de “${edge.name}” em ${name(from)}: ${[added.length&&`novas ${added.join(', ')}`,missing.length&&`não chamadas ${missing.map(label).join(', ')}`,...status].filter(Boolean).join('; ')}`});}
 for(const step of run.steps)if(step.status==='diverged'&&step.transitionId&&!items.some(i=>i.transitionId===step.transitionId&&i.type==='different')){const edge=current.transitions.find(e=>e.id===step.transitionId);if(edge)items.push({type:'different',kind:'destination',transitionId:edge.id,fromScreen:screenOf(edge.from),toScreen:screenOf(edge.to),text:`“${edge.name}” em ${name(screenOf(edge.from))} levou a ${name(screenOf(edge.to))}, diferente do caminho gravado`});}
 return {walked:{screens:[...new Set(visited.map(screenOf))],states:visited,transitions:walked},items,counts:{new:items.filter(i=>i.type==='new').length,different:items.filter(i=>i.type==='different').length}};
}

const LISTS=['screens','states','transitions','flows','harness'];
/**
 * Bring an approved draft into the recorded map. Only what the mission touched is written, item by item, so edits a
 * person made to the recorded map while the mission ran or waited (a renamed screen, a new flow) are kept.
 */
export function mergeDraft(base,draft,recorded,changes){
 const out=structuredClone(recorded);
 for(const key of LISTS){const old=new Map((base[key]??[]).map(x=>[x.id,JSON.stringify(x)]));out[key]??=[];for(const item of draft[key]??[]){if(old.get(item.id)===JSON.stringify(item))continue;const index=out[key].findIndex(x=>x.id===item.id);if(index>=0)out[key][index]=item;else out[key].push(item);}}
 for(const key of Object.keys(draft))if(!LISTS.includes(key)&&JSON.stringify(draft[key])!==JSON.stringify(base[key]))out[key]=draft[key];
 // Approving a call that no longer happens means the recorded action stops expecting it.
 for(const item of changes?.items??[])if(item.kind==='api'&&item.missingKeys?.length){const edge=out.transitions.find(e=>e.id===item.transitionId);if(edge)edge.apis=(edge.apis??[]).filter(api=>!item.missingKeys.includes(apiKey(api)));}
 return out;
}
/** What survives a draft that is thrown away: answers a person gave, and how dependable each direct route proved to be. */
export function carryOver(base,draft,recorded){
 const out=structuredClone(recorded);
 for(const key of ['routes','entries'])if(JSON.stringify(draft[key]??{})!==JSON.stringify(base[key]??{}))out[key]={...out[key],...draft[key]};
 const answers=new Map((base.harness??[]).map(x=>[x.id,JSON.stringify(x)]));out.harness??=[];for(const item of draft.harness??[]){if(answers.get(item.id)===JSON.stringify(item))continue;const index=out.harness.findIndex(x=>x.id===item.id);if(index>=0)out.harness[index]=item;else out.harness.push(item);}
 const before=new Map(base.transitions.map(e=>[e.id,e]));for(const edge of draft.transitions){const old=before.get(edge.id),target=old&&out.transitions.find(e=>e.id===edge.id);if(!target)continue;const walks=(edge.walks??0)-(old.walks??0),misses=(edge.misses??0)-(old.misses??0);if(walks>0)target.walks=(target.walks??0)+walks;if(misses>0)target.misses=(target.misses??0)+misses;}
 return out;
}
