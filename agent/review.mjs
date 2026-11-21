import {mergeApis} from './network.mjs';
import {replayMerges} from './merge.mjs';
import {envOf} from './schema.mjs';
/** How two recordings of the same action differ in where they ran: the environment first, then the account. */
const named=e=>e==='default'?'o ambiente padrão':e,context=(other,mine)=>envOf(other)!==envOf(mine)?{kind:'ambiente',here:named(envOf(mine)),there:named(envOf(other))}:{kind:'conta',here:`conta ${mine.profile}`,there:`conta ${other.profile}`};

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
  if(!known){const action=JSON.stringify(edge.action),same=b=>b.from===edge.from&&b.target===edge.target&&JSON.stringify(b.action)===action,here=b=>b.profile===edge.profile&&envOf(b)===envOf(edge);
   const rival=base.transitions.find(b=>same(b)&&here(b)&&b.to!==edge.to);
   // Landing on the same screen in another state is reported by the state itself; only another screen contradicts the recorded destination.
   if(rival&&screenOf(rival.to)!==to){items.push({type:'different',kind:'destination',...where,expectedScreen:screenOf(rival.to),expectedTransitionId:rival.id,text:`“${edge.name}” em ${at(edge.from)} levou a ${at(edge.to)}; o gravado leva a ${name(screenOf(rival.to))}`});continue;}
   // Recorded for another account or environment. Going to the same screen is just that way confirmed here (kept without asking);
   // going elsewhere is how this account or environment differs, which is not a regression.
   const elsewhere=base.transitions.filter(b=>same(b)&&!here(b));
   if(elsewhere.some(b=>screenOf(b.to)===to))continue;
   const other=elsewhere.find(b=>screenOf(b.to)!==to);
   if(other){const by=context(other,edge);items.push({type:'variant',kind:'destination',...where,expectedScreen:screenOf(other.to),expectedTransitionId:other.id,text:`Varia por ${by.kind}: “${edge.name}” em ${at(edge.from)} leva a ${at(edge.to)} em ${by.here}; em ${by.there} leva a ${name(screenOf(other.to))}`});continue;}
   items.push({type:'new',kind:'transition',...where,text:`Conexão nova: “${edge.name}” de ${name(from)} para ${name(to)}`});
   continue;}
  // The same action as recorded: compare what it asked the backend each time it was taken in this mission.
  const steps=run.steps.filter(s=>s.transitionId===id&&s.status!=='failed'),got=steps.reduce((all,step)=>mergeApis(all,step.network??[]),[]),expected=known.apis??[];
  const gotKeys=new Map(got.map(a=>[apiKey(a),a])),expectedKeys=new Map(expected.map(a=>[apiKey(a),a]));
  const added=got.filter(a=>!expectedKeys.has(apiKey(a))).map(label),missing=expected.filter(a=>!gotKeys.has(apiKey(a))),status=got.flatMap(a=>{const old=expectedKeys.get(apiKey(a)),fresh=old?(a.statuses??[]).filter(s=>!(old.statuses??[]).includes(s)):[];return fresh.length?[`${label(a)} respondeu ${fresh.join(', ')} (gravado: ${(old.statuses??[]).join(', ')||'sem resposta'})`]:[];});
  if(added.length||missing.length||status.length)items.push({type:'different',kind:'api',...where,added,missing:missing.map(label),missingKeys:missing.map(apiKey),status,text:`APIs de “${edge.name}” em ${name(from)}: ${[added.length&&`novas ${added.join(', ')}`,missing.length&&`não chamadas ${missing.map(label).join(', ')}`,...status].filter(Boolean).join('; ')}`});}
 // Screens or states the agent said were recorded twice and folded into one: the person confirms it like any other change.
 const before=new Set((base.merges??[]).map(m=>m.id));for(const m of current.merges??[]){if(before.has(m.id))continue;if(m.kind==='screen')items.push({type:'different',kind:'merge',screenId:m.into,text:`Telas unificadas: ${(m.names??m.from).join(', ')} agora é ${name(m.into)}`});else items.push({type:'different',kind:'merge',screenId:screenOf(m.into),stateId:m.into,text:`Estados unificados em ${at(m.into)}`});}
 for(const step of run.steps)if(step.status==='diverged'&&step.transitionId&&!items.some(i=>i.transitionId===step.transitionId&&i.type==='different')){const edge=current.transitions.find(e=>e.id===step.transitionId);if(edge)items.push({type:'different',kind:'destination',transitionId:edge.id,fromScreen:screenOf(edge.from),toScreen:screenOf(edge.to),text:`“${edge.name}” em ${name(screenOf(edge.from))} levou a ${name(screenOf(edge.to))}, diferente do caminho gravado`});}
 return {walked:{screens:[...new Set(visited.map(screenOf))],states:visited,transitions:walked},items,counts:{new:items.filter(i=>i.type==='new').length,different:items.filter(i=>i.type==='different').length,variant:items.filter(i=>i.type==='variant').length}};
}

const LISTS=['screens','states','transitions','flows','harness'];
/**
 * Bring an approved draft into the recorded map. Only what the mission touched is written, item by item, so edits a
 * person made to the recorded map while the mission ran or waited (a renamed screen, a new flow) are kept.
 */
export function mergeDraft(base,draft,recorded,changes){
 const out=structuredClone(recorded);
 // Field by field: what the mission changed wins, what it left alone keeps the recorded value (a rename made meanwhile survives a visit).
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 for(const key of LISTS){const old=new Map((base[key]??[]).map(x=>[x.id,x]));out[key]??=[];for(const item of draft[key]??[]){const before=old.get(item.id);if(before&&same(before,item))continue;const index=out[key].findIndex(x=>x.id===item.id);
  if(index<0){out[key].push(item);continue;}if(!before){out[key][index]=item;continue;}
  const merged={...out[key][index]};for(const field of new Set([...Object.keys(item),...Object.keys(before)]))if(!same(item[field],before[field])){if(item[field]===undefined)delete merged[field];else merged[field]=item[field];}out[key][index]=merged;}}
 const MAPS=['aliases','stateAliases'],fresh=(draft.merges??[]).filter(m=>!(base.merges??[]).some(b=>b.id===m.id));
 for(const key of Object.keys(draft))if(!LISTS.includes(key)&&key!=='merges'&&JSON.stringify(draft[key])!==JSON.stringify(base[key]))out[key]=MAPS.includes(key)?{...(out[key]??{}),...draft[key]}:draft[key];
 // A merge removes things; copying the draft's items cannot do that, so the merge itself is applied to the recorded map.
 replayMerges(out,fresh,{skipKnown:false});
 // Approving a call that no longer happens means the recorded action stops expecting it.
 for(const item of changes?.items??[])if(item.kind==='api'&&item.missingKeys?.length){const edge=out.transitions.find(e=>e.id===item.transitionId);if(edge)edge.apis=(edge.apis??[]).filter(api=>!item.missingKeys.includes(apiKey(api)));}
 return out;
}
/** What survives a draft that is thrown away: answers a person gave, and how dependable each direct route proved to be. */
export function carryOver(base,draft,recorded){
 const out=structuredClone(recorded);
 for(const key of ['routes','entries','starts'])if(JSON.stringify(draft[key]??{})!==JSON.stringify(base[key]??{}))out[key]={...out[key],...draft[key]};
 const answers=new Map((base.harness??[]).map(x=>[x.id,JSON.stringify(x)]));out.harness??=[];for(const item of draft.harness??[]){if(answers.get(item.id)===JSON.stringify(item))continue;const index=out.harness.findIndex(x=>x.id===item.id);if(index>=0)out.harness[index]=item;else out.harness.push(item);}
 const before=new Map(base.transitions.map(e=>[e.id,e]));for(const edge of draft.transitions){const old=before.get(edge.id),target=old&&out.transitions.find(e=>e.id===edge.id);if(!target)continue;const walks=(edge.walks??0)-(old.walks??0),misses=(edge.misses??0)-(old.misses??0);if(walks>0)target.walks=(target.walks??0)+walks;if(misses>0)target.misses=(target.misses??0)+misses;}
 return out;
}
