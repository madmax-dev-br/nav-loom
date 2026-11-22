/**
 * Response variants: N answers from the backend, N states of the app.
 *
 * The same action can land in different places depending on what the backend answered (a purchase approved or
 * declined, a search with or without results). Every transition keeps the answers seen when it happened, as short
 * keys: `POST /api/checkout 402 status=declined`. The key is the endpoint, the status and the few values of the body
 * that decide what comes next (fields named status, result, error, code…); ids, dates and masked values never enter it.
 * Comparing the keys of the transitions that start from the same state with the same action tells which answer leads
 * where. Validation then reads a new destination explained by a new answer as a variant, not as a regression; a stalled
 * walk names the answer behind each branch.
 */
const DECISIVE=/^(status|state|result|outcome|error|errors|code|reason|type|kind|approved|success|ok|valid|available|decision|message_code)$/i;
const VOLATILE=v=>/^\d{4}-\d\d-\d\d|^[0-9a-f]{8}-[0-9a-f]{4}-|^\[REDACTED\]$/i.test(String(v));
/** The deciding values of a recorded response body (`readBody` output), up to two levels deep. */
export function answerOf(body){
 const json=body?.json;if(!json||typeof json!=='object')return '';const parts=[];
 const walk=(obj,prefix,depth)=>{if(depth>1||!obj||typeof obj!=='object'||Array.isArray(obj))return;for(const [key,value] of Object.entries(obj)){
  if(['string','number','boolean'].includes(typeof value)){if(DECISIVE.test(key)&&String(value).length<=40&&!VOLATILE(value))parts.push(`${prefix}${key}=${value}`);}
  else if(value&&typeof value==='object')walk(value,`${prefix}${key}.`,depth+1);}};
 walk(Array.isArray(json)?{}:json,'',0);
 // An empty list is an answer of its own (no results), a list with items another.
 if(Array.isArray(json))parts.push(json.length?'items':'empty');else for(const [key,value] of Object.entries(json))if(Array.isArray(value)&&/items|results|data|list|products|entries/i.test(key))parts.push(`${key}=${value.length?'items':'empty'}`);
 return [...new Set(parts)].sort().slice(0,4).join(' ');
}
export const responseKey=call=>`${call.method} ${call.path} ${call.status}${call.answer?' '+call.answer:''}`;
/** Keep the answers seen on a transition: one entry per key, how often, and up to three evidence files to look at or replay. */
export function recordResponses(edge,calls){
 for(const call of calls){if(call.status===null||call.status===undefined)continue;const key=responseKey(call);edge.responses??=[];let entry=edge.responses.find(r=>r.key===key);if(!entry){entry={key,count:0,evidence:[]};edge.responses.push(entry);}entry.count++;if(typeof call.detail==='string'&&!entry.evidence.includes(call.detail))entry.evidence=[...entry.evidence,call.detail].slice(-3);}
 if(edge.responses?.length>12){edge.responses.sort((a,b)=>b.count-a.count);edge.responses=edge.responses.slice(0,12);}
}
/**
 * Transitions leaving the same state with the same action, and for each the answers only it has seen: what explains
 * why it went there and not elsewhere. A branch with nothing of its own is told apart by nothing the backend said.
 */
export function branches(graph,{target}={}){
 const groups=new Map();for(const t of graph.transitions){if(!t.confirmed||t.action?.type==='back'||(target&&t.target!==target))continue;const key=t.from+JSON.stringify(t.action);groups.set(key,[...(groups.get(key)??[]),t]);}
 const out=[];for(const edges of groups.values()){const to=new Set(edges.map(e=>e.to));if(to.size<2)continue;
  const keys=e=>new Set((e.responses??[]).map(r=>r.key)),own=e=>[...keys(e)].filter(k=>edges.every(o=>o.to===e.to||!keys(o).has(k)));
  const byTo=new Map();for(const e of edges){const entry=byTo.get(e.to)??{to:e.to,edges:[],why:new Set()};entry.edges.push(e);for(const k of own(e))entry.why.add(k);byTo.set(e.to,entry);}
  out.push({from:edges[0].from,action:edges[0].action,name:edges[0].name,outcomes:[...byTo.values()].map(o=>({to:o.to,why:[...o.why].slice(0,3),count:o.edges.reduce((n,e)=>n+(e.evidence?.length??0),0)}))});}
 return out;
}
/** One line per action that branches on the backend's answer, for agents and people. */
export function branchLines(graph,{target,limit=20}={}){
 const state=id=>graph.states.find(s=>s.id===id),screen=id=>graph.screens.find(s=>s.id===state(id)?.screenId)?.name??'?';
 return branches(graph,{target}).filter(b=>b.outcomes.some(o=>o.why.length)).slice(0,limit).map(b=>`"${b.name}" em ${screen(b.from)}: ${b.outcomes.map(o=>`${o.why.length?o.why.join(' + '):'outra resposta'} → ${screen(o.to)} (${state(o.to)?.name??'?'})`).join(' | ')}`);
}
