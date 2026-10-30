import {hash,now,uid} from './store.mjs';
export function identity(observation,target){
 const screenKey=observation.screenKey||[observation.route,observation.heading];
 const structural=observation.elements.map(e=>e.identity).sort();
 return {screenId:hash([target,screenKey]),stateId:observation.scrollOfState??hash([target,screenKey,observation.stateKey||[observation.heading,structural,observation.stateMarkers]])};
}
export function recordObservation(graph,observation,run){
 const keys=identity(observation,run.target);Object.assign(observation,keys);
 let screen=graph.screens.find(s=>s.id===keys.screenId);
 if(!screen){screen={id:keys.screenId,target:run.target,name:observation.heading||observation.title||observation.route,description:'',route:observation.route,identity:observation.screenKey?'explicit':'structural',sources:[],createdAt:now()};graph.screens.push(screen);}
 let state=graph.states.find(s=>s.id===keys.stateId);if(!state){state={id:keys.stateId,screenId:screen.id,name:observation.stateKey||observation.heading||'Observed state',firstSeen:observation.id,lastSeen:observation.id};graph.states.push(state);}state.lastSeen=observation.id;
 for(const element of observation.elements){if(!element.actions?.length||element.disabled)continue;const key=hash([observation.stateId,element.identity]);if(!run.frontier.some(f=>f.key===key))run.frontier.push({key,stateId:observation.stateId,elementIdentity:element.identity,label:element.name,actions:element.actions,status:'pending',observationId:observation.id,elementId:element.id});}
 return keys;
}
export function confirmTransition(graph,before,after,action,step,run){
 const element=before.elements.find(e=>e.id===action.elementId);
 const replay={...action};delete replay.observationId;delete replay.elementId;if(replay.secretRef)delete replay.value;
 if(element)replay.elementIdentity=element.identity;
 const signature=hash([before.stateId,after.stateId,replay,run.target,run.profile,run.preconditions,run.version?.fingerprint]);let edge=graph.transitions.find(e=>e.signature===signature);
 if(!edge){edge={id:uid(),signature,from:before.stateId,to:after.stateId,target:run.target,profile:run.profile,preconditions:run.preconditions,kind:action.type==='scroll'?'scroll':before.screenId===after.screenId?'state':'navigation',name:element?.name||action.type,action:replay,confirmed:true,evidence:[],version:run.version,cost:1};graph.transitions.push(edge);}edge.evidence.push({runId:run.id,stepId:step.id,before:before.id,after:after.id});
 const candidate=run.frontier.find(f=>f.stateId===before.stateId&&f.elementIdentity===element?.identity);if(candidate)candidate.status='visited';return edge;
}
export function planRoute(graph,{from,to,target,profile,preconditions={},version,allowUnverifiedVersion=false}){
 const queue=[{state:from,path:[],cost:0}],best=new Map();
 while(queue.length){queue.sort((a,b)=>a.cost-b.cost);const current=queue.shift();if(current.state===to)return {found:true,steps:current.path,cost:current.cost};if((best.get(current.state)??Infinity)<=current.cost)continue;best.set(current.state,current.cost);
 for(const edge of graph.transitions){if(!edge.confirmed||edge.from!==current.state||edge.target!==target||edge.profile!==profile)continue;if(hash(edge.preconditions)!==hash(preconditions))continue;if(!allowUnverifiedVersion&&edge.version?.fingerprint!==version?.fingerprint)continue;if(edge.action.point)continue;queue.push({state:edge.to,path:[...current.path,edge.id],cost:current.cost+edge.cost});}}
 return {found:false,steps:[],reason:'No confirmed compatible route. Explore only the missing section or explicitly revalidate an older route.'};
}
export function compareRuns(a,b){const old=new Set(a.observations.map(o=>o.stateId)),next=new Set(b.observations.map(o=>o.stateId));return {baseline:a.id,current:b.id,added:[...next].filter(x=>!old.has(x)),revisited:[...next].filter(x=>old.has(x)),notRevisited:[...old].filter(x=>!next.has(x)),removed:[],reviewRequired:true};}
