type Obj=Record<string,any>;
/**
 * Keep distinct interaction origins; only automatic events may start at the screen boundary. Without a run, every
 * confirmed connection of the project is shown. A `state` transition stays on its screen (`fromScreen===toScreen`).
 */
export function screenRoutes(graph:Obj,runId:string|undefined,kinds:string[],screenIds:string[]){
 const states=new Map<string,string>(graph.states.map((s:Obj)=>[s.id,s.screenId]));
 const groups=new Map<string,Obj>();
 for(const edge of graph.transitions){
  const from=states.get(edge.from),to=states.get(edge.to);
  const evidence=runId?edge.evidence.filter((e:Obj)=>e.runId===runId):edge.evidence;
  if(!edge.confirmed||!from||!to||!screenIds.includes(from)||!screenIds.includes(to)||!kinds.includes(edge.kind)||!evidence.length)continue;
  if(from===to&&edge.kind!=='state')continue;
  const automatic=edge.action?.type==='wait'||['automatic','api_response'].includes(edge.trigger?.type);
  const origin=automatic?'automatic':edge.action?.elementIdentity??edge.id;
  const id=JSON.stringify([edge.from,edge.kind==='state'?edge.to:to,origin]);let group=groups.get(id);
  if(!group){group={id:edge.id,fromScreen:from,toScreen:to,fromState:edge.from,toState:edge.to,origin:automatic?'automatic':'interaction',elementIdentity:edge.action?.elementIdentity,point:edge.action?.point,evidence,actionIds:[],name:edge.name,kind:edge.kind,actionType:edge.action?.type,apis:[],loadApis:[]};groups.set(id,group);}
  // When a route crosses screens, a GET on arrival is the destination loading, not something the action did.
  for(const api of edge.apis??[]){const list=api.method==='GET'&&from!==to?group.loadApis:group.apis;if(!list.some((a:Obj)=>a.method===api.method&&a.path===api.path))list.push(api);}
  group.actionIds.push(edge.id);
 }
 return [...groups.values()].map((group,index)=>({...group,lane:index}));
}
