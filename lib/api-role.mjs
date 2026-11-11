/**
 * Who an API call belongs to. A GET seen while arriving at another screen is that screen loading its data,
 * so it belongs to the destination. Everything else (writes, and any call that keeps you on the same screen)
 * was caused by the action itself.
 */
export const isLoadCall=(api,crossesScreens)=>crossesScreens&&api.method==='GET';
const key=api=>`${api.method} ${api.path}`;
/** Calls of one transition, split into what the action did and what the destination loaded. */
export function splitApis(graph,edge){
 const screenOf=id=>graph.states.find(s=>s.id===id)?.screenId,crosses=screenOf(edge.from)!==screenOf(edge.to);
 return {action:(edge.apis??[]).filter(api=>!isLoadCall(api,crosses)),load:(edge.apis??[]).filter(api=>isLoadCall(api,crosses))};
}
/** Calls of one screen: what it loads when you arrive, and what its own actions trigger (with the action name). */
export function screenApis(graph,screenId){
 const screenOf=id=>graph.states.find(s=>s.id===id)?.screenId,load=new Map(),action=new Map();
 for(const edge of graph.transitions){
  if(!edge.confirmed||!edge.apis?.length)continue;
  const from=screenOf(edge.from),to=screenOf(edge.to),parts=splitApis(graph,edge);
  if(to===screenId)for(const api of parts.load)if(!load.has(key(api)))load.set(key(api),{...api});
  if(from===screenId)for(const api of parts.action)if(!action.has(key(api)))action.set(key(api),{...api,via:edge.action?.type==='wait'?'carregamento':edge.name});
 }
 return {load:[...load.values()],action:[...action.values()]};
}
