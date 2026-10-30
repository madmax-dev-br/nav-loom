/** First visit determines placement. Revisits never move a screen; unvisited screens remain last. */
export function orderScreenIds(screenIds, observations) {
 const remaining=new Set(screenIds), ordered=[];
 for(const observation of observations){
  if(remaining.delete(observation.screenId))ordered.push(observation.screenId);
 }
 return [...ordered,...remaining];
}
