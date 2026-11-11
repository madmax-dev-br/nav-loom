type Link={fromScreen:string;toScreen:string};
/**
 * Place screens in columns by how many confirmed transitions separate them from the entry.
 * Screens reached from the same place stack vertically, so most connections are short and point right.
 */
export function layoutColumns(screenIds:string[],links:Link[]){
 const depth=new Map<string,number>(),known=new Set(screenIds);
 for(const root of screenIds){
  if(depth.has(root))continue;
  depth.set(root,0);const queue=[root];
  while(queue.length){const current=queue.shift()!;for(const link of links){if(link.fromScreen!==current||!known.has(link.toScreen)||depth.has(link.toScreen))continue;depth.set(link.toScreen,depth.get(current)!+1);queue.push(link.toScreen);}}
 }
 const columns:string[][]=[];
 for(const id of screenIds){const column=depth.get(id)??0;(columns[column]??=[]).push(id);}
 return {columns:columns.filter(Boolean),depth};
}
/** forward: deeper column · lateral: same column · back: returns towards the entry. */
export function linkDirection(depth:Map<string,number>,link:Link){
 const from=depth.get(link.fromScreen)??0,to=depth.get(link.toScreen)??0;
 return to>from?'forward':to===from?'lateral':'back';
}
