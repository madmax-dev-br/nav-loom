import type {ScreenshotBounds} from './connector-geometry';
export type Point={x:number;y:number};
export type Segment={start:Point;end:Point};
export type Continuation={start:Point;end:Point;label:string};
// Split orthogonal routes at screenshots. Matching markers preserve the connection
// without painting a line over unrelated screen content.
export function splitRoute(points:Point[],obstacles:ScreenshotBounds[],prefix:string){
 const segments:Segment[]=[],continuations:Continuation[]=[];let openGap:Point|undefined;
 for(let i=1;i<points.length;i++){
  const start=points[i-1],end=points[i],horizontal=start.y===end.y,length=Math.abs(horizontal?end.x-start.x:end.y-start.y);
  if(!length)continue;
  const delta=horizontal?end.x-start.x:end.y-start.y;
  const intervals=obstacles.flatMap(b=>{
   const fixed=horizontal?start.y:start.x,lo=horizontal?b.y:b.x,hi=lo+(horizontal?b.height:b.width);
   if(fixed<=lo||fixed>=hi)return [];
   const a=((horizontal?b.x:b.y)-(horizontal?start.x:start.y))/delta;
   const z=((horizontal?b.x+b.width:b.y+b.height)-(horizontal?start.x:start.y))/delta;
   const from=Math.max(0,Math.min(a,z)),to=Math.min(1,Math.max(a,z));
   return to>from?[{from,to}]:[];
  }).sort((a,b)=>a.from-b.from);
  const merged:typeof intervals=[];for(const gap of intervals){const last=merged.at(-1);if(last&&gap.from<=last.to)last.to=Math.max(last.to,gap.to);else merged.push({...gap});}
  const at=(t:number)=>({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t});let cursor=0;
  for(const gap of merged){
   if(gap.from>cursor)segments.push({start:at(cursor),end:at(gap.from)});
   if(gap.from>0&&!openGap)openGap=at(gap.from);
   if(gap.to<1&&openGap){continuations.push({start:openGap,end:at(gap.to),label:`${prefix}.${continuations.length+1}`});openGap=undefined;}
   cursor=gap.to;
  }
  if(!merged.length&&openGap){continuations.push({start:openGap,end:start,label:`${prefix}.${continuations.length+1}`});openGap=undefined;}
  if(cursor<1)segments.push({start:at(cursor),end});
 }
 return {segments,continuations};
}
export function overlappingLength(a:Segment,b:Segment){
 const horizontal=a.start.y===a.end.y;
 if(horizontal!==(b.start.y===b.end.y))return 0;
 if(horizontal?a.start.y!==b.start.y:a.start.x!==b.start.x)return 0;
 const axis=(p:Point)=>horizontal?p.x:p.y;
 return Math.max(0,Math.min(Math.max(axis(a.start),axis(a.end)),Math.max(axis(b.start),axis(b.end)))-Math.max(Math.min(axis(a.start),axis(a.end)),Math.min(axis(b.start),axis(b.end))));
}
