type Obj=Record<string,any>;
/** Keep distinct interaction origins; only automatic events may start at the screen boundary. */
export function screenRoutes(graph:Obj,runId:string|undefined,kinds:string[],screenIds:string[]){
 const states=new Map<string,string>(graph.states.map((s:Obj)=>[s.id,s.screenId]));
 const groups=new Map<string,Obj>();
 for(const edge of graph.transitions){
  const from=states.get(edge.from),to=states.get(edge.to);
  if(!edge.confirmed||!from||!to||from===to||!screenIds.includes(from)||!screenIds.includes(to)||!kinds.includes(edge.kind)||!edge.evidence.some((e:Obj)=>e.runId===runId))continue;
  const automatic=edge.action?.type==='wait'||['automatic','api_response'].includes(edge.trigger?.type);
  const origin=automatic?'automatic':edge.action?.elementIdentity??edge.id;
  const id=JSON.stringify([edge.from,to,origin]);let group=groups.get(id);
  if(!group){group={id:edge.id,fromScreen:from,toScreen:to,fromState:edge.from,origin:automatic?'automatic':'interaction',elementIdentity:edge.action?.elementIdentity,point:edge.action?.point,evidence:edge.evidence.filter((e:Obj)=>e.runId===runId),actionIds:[]};groups.set(id,group);}
  group.actionIds.push(edge.id);
 }
 return [...groups.values()].map((group,index)=>({...group,lane:index}));
}
