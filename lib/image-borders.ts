import type {TouchArea} from './connector-geometry';
/** Find closed regions separated by contrast edges. Input is already scaled for bounded work. */
export function detectBorders(pixels:Uint8ClampedArray,width:number,height:number):TouchArea[]{
 const result:TouchArea[]=[];
 for(const threshold of [5,12,24]){
 const edge=new Uint8Array(width*height),seen=new Uint8Array(width*height),queue=new Int32Array(width*height);
 const difference=(a:number,b:number)=>Math.max(Math.abs(pixels[a*4]-pixels[b*4]),Math.abs(pixels[a*4+1]-pixels[b*4+1]),Math.abs(pixels[a*4+2]-pixels[b*4+2]));
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;if(difference(i,i+1)>threshold||difference(i,i+width)>threshold||difference(i,i-1)>threshold||difference(i,i-width)>threshold)edge[i]=1;}
 // Close small antialiasing gaps in boundaries.
 const mask=edge.slice();for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;if(edge[i])for(const j of [i-1,i+1,i-width,i+width])mask[j]=1;}
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const start=y*width+x;if(mask[start]||seen[start])continue;let head=0,tail=1,minX=x,maxX=x,minY=y,maxY=y,touches=false;queue[0]=start;seen[start]=1;
 while(head<tail){const i=queue[head++],px=i%width,py=Math.floor(i/width);minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);if(px===0||py===0||px===width-1||py===height-1)touches=true;for(const next of [px>0?i-1:-1,px<width-1?i+1:-1,py>0?i-width:-1,py<height-1?i+width:-1])if(next>=0&&!mask[next]&&!seen[next]){seen[next]=1;queue[tail++]=next;}}
 const w=maxX-minX+1,h=maxY-minY+1;if(touches||w<width*.045||h<height*.012||w*h>width*height*.85||tail/(w*h)<.38)continue;
 const left=Math.max(0,minX-2),top=Math.max(0,minY-2),right=Math.min(width,maxX+3),bottom=Math.min(height,maxY+3);result.push({x:left/width,y:top/height,width:(right-left)/width,height:(bottom-top)/height});
 }
 }
 return result.sort((a,b)=>a.width*a.height-b.width*b.height).filter((v,i,all)=>!all.slice(0,i).some(a=>Math.abs(a.x-v.x)<.016&&Math.abs(a.y-v.y)<.012&&Math.abs(a.width-v.width)<.025&&Math.abs(a.height-v.height)<.02)).slice(0,150);
}
