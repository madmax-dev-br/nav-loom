type Link={fromScreen:string;toScreen:string};
/**
 * Place screens in columns by how many confirmed transitions separate them from the entry.
 * Screens reached from the same place stack vertically, so most connections are short and point right.
 * `pending` is the placeholder of a live mission's next screen, reached from the screen `from`: it gets a depth, so its
 * arrow points forward, but no place in a column. It is laid over the map by `placePending`, so no known screen moves.
 */
export function layoutColumns(screenIds:string[],links:Link[],pending?:{id:string;from:string}){
 const depth=new Map<string,number>(),known=new Set(screenIds);
 for(const root of screenIds){
  if(depth.has(root))continue;
  depth.set(root,0);const queue=[root];
  while(queue.length){const current=queue.shift()!;for(const link of links){if(link.fromScreen!==current||!known.has(link.toScreen)||depth.has(link.toScreen))continue;depth.set(link.toScreen,depth.get(current)!+1);queue.push(link.toScreen);}}
 }
 const columns:string[][]=[];
 for(const id of screenIds){const column=depth.get(id)??0;(columns[column]??=[]).push(id);}
 if(pending&&depth.has(pending.from))depth.set(pending.id,depth.get(pending.from)!+1);
 return {columns:columns.filter(Boolean),depth};
}
/** forward: deeper column · lateral: same column · back: returns towards the entry. */
export function linkDirection(depth:Map<string,number>,link:Link){
 const from=depth.get(link.fromScreen)??0,to=depth.get(link.toScreen)??0;
 return to>from?'forward':to===from?'lateral':'back';
}
type Box={x:number;y:number;width:number;height:number};
/** Room between two columns, as in the stylesheet (`.map-column{margin-right}`): where a new column would start. */
export const COLUMN_GAP=440;
/**
 * Where to draw the placeholder of the screen a live mission is heading to, so it is seen beside the screen it comes from.
 * First choice: the next column, level with the source — a short arrow to the right. When a screen already sits there,
 * the placeholder stays in the gap between the two columns (or a little up or down the next column, when that is closer),
 * as near to the source's height as it can be without touching a screen, and away from the labels drawn in that gap.
 * `columnX` is the left of the next column, absent when the source is in the last one; `cards` are the known screens,
 * the source included; `labels` what is drawn between them; `top` the highest a screen may sit.
 */
export function placePending(source:Box,size:{width:number;height:number},around:{columnX?:number;cards:Box[];labels?:Box[];top?:number}){
 const right=source.x+source.width,columnX=around.columnX??right+COLUMN_GAP,top=around.top??Math.min(source.y,...around.cards.map(card=>card.y)),reach=Math.max(source.height,size.height);
 const overlap=(a:Box,b:Box,mx=0,my=0)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width+mx)-Math.max(a.x,b.x-mx))*Math.max(0,Math.min(a.y+a.height,b.y+b.height+my)-Math.max(a.y,b.y-my));
 // In the gap the arrow needs some length to be seen as one; the placeholder must also end before the next column.
 const spots=[{x:columnX,slot:'column' as const,cost:0},...[64,112,160].map(offset=>({x:right+offset,slot:'gap' as const,cost:60+offset/4})).filter((spot,i)=>!i||spot.x+size.width<=columnX-24)];
 let best:{x:number;y:number;slot:'column'|'gap';cost:number}|undefined;
 for(const spot of spots)for(let dy=0;dy<=reach;dy+=24)for(const y of dy?[source.y+dy,source.y-dy]:[source.y]){
  if(y<top)continue;
  const box={x:spot.x,y,...size};
  // A screen is never covered, and keeps its breathing room; a label can be, at a price that grows with how much of it is hidden.
  if(around.cards.some(card=>overlap(box,card,20,40)>0))continue;
  const cost=spot.cost+dy+(around.labels??[]).reduce((sum,label)=>sum+overlap(box,label,6,6),0)/40;
  if(!best||cost<best.cost)best={x:spot.x,y,slot:spot.slot,cost};
 }
 return best?{x:best.x,y:best.y,slot:best.slot}:{x:right+64,y:source.y,slot:'gap' as const};
}
