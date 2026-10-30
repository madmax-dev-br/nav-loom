export type DiffLine={type:'context'|'added'|'removed';text:string};
/** Ordered line comparison preserves repeated YAML lines and their context. */
export function historyDiff(before:string,after:string):DiffLine[]{
 const a=before.split('\n'),b=after.split('\n');let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix),width=right.length+1,table=new Uint32Array((left.length+1)*width);
 for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)table[i*width+j]=left[i]===right[j]?table[(i+1)*width+j+1]+1:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
 const result:DiffLine[]=a.slice(0,prefix).map(text=>({type:'context',text}));let i=0,j=0;
 while(i<left.length||j<right.length){if(i<left.length&&j<right.length&&left[i]===right[j]){result.push({type:'context',text:left[i++]});j++;}else if(i<left.length&&(j===right.length||table[(i+1)*width+j]>=table[i*width+j+1]))result.push({type:'removed',text:left[i++]});else result.push({type:'added',text:right[j++]});}
 return [...result,...a.slice(a.length-suffix).map(text=>({type:'context' as const,text}))];
}
