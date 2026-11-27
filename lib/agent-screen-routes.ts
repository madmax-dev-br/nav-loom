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
/** Id of the placeholder card drawn for the screen a live mission has not captured yet. */
export const PENDING_SCREEN='__pending__';
/**
 * Where a live mission is, read from the run the interface already polls: its last capture is the screen the agent is
 * on, and a last step still `running` from that capture is an action whose resulting screen has not been recorded.
 * Null when the run is not running or has captured nothing: then there is no screen being assembled.
 */
export function pendingStep(run:Obj|undefined|null){
 if(!run||run.status!=='running')return null;
 const last=run.observations?.at(-1);if(!last?.screenId)return null;
 const step=run.steps?.at(-1),acting=step?.status==='running'&&step.before===last.id,action=acting?step.action:undefined;
 const element=action?.elementId?last.elements?.find((e:Obj)=>e.id===action.elementId):undefined;
 return {fromScreen:last.screenId as string,fromState:last.stateId as string,acting:!!acting,actionType:action?.type as string|undefined,elementIdentity:element?.identity as string|undefined,name:(element?.label||element?.name) as string|undefined};
}
