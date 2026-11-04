/** Declared deeplinks are candidates read from the platform; a deeplink is verified only after an observed deeplink step. */
export function parseDumpsysDeeplinks(text,pkg){
 const filters=[];let current=null;
 for(const raw of String(text).split('\n')){const line=raw.replace(/\r$/,'');
  const head=line.match(/^\s*[0-9a-f]+\s+(\S+)\s+filter\s+[0-9a-f]+/i);
  if(head){current={activity:head[1],actions:[],schemes:[],hosts:[],paths:[],categories:[]};filters.push(current);continue;}
  if(!current)continue;
  let m;
  if((m=line.match(/^\s+Action:\s+"([^"]+)"/)))current.actions.push(m[1]);
  else if((m=line.match(/^\s+Category:\s+"([^"]+)"/)))current.categories.push(m[1]);
  else if((m=line.match(/^\s+Scheme:\s+"([^"]+)"/)))current.schemes.push(m[1]);
  else if((m=line.match(/^\s+Authority:\s+"([^"]+)"/)))current.hosts.push(m[1]);
  else if((m=line.match(/^\s+Path:\s+"PatternMatcher\{(\w+):\s*([^}]*)\}"/)))current.paths.push({type:m[1],pattern:m[2]});
  else if(/^\S/.test(line))current=null;
 }
 const seen=new Set(),declared=[];
 for(const f of filters){if(!f.actions.includes('android.intent.action.VIEW')||!f.schemes.length)continue;if(pkg&&!f.activity.startsWith(pkg+'/'))continue;
  const key=JSON.stringify([f.activity,f.schemes,f.hosts,f.paths]);if(seen.has(key))continue;seen.add(key);
  const examples=[];for(const scheme of f.schemes){const hosts=f.hosts.length?f.hosts:[''];for(const host of hosts){const paths=f.paths.length?f.paths.map(examplePath):['/'];for(const path of paths)examples.push(`${scheme}://${host}${path}`);}}
  declared.push({activity:f.activity,schemes:f.schemes,hosts:f.hosts,paths:f.paths,browsable:f.categories.includes('android.intent.category.BROWSABLE'),examples:[...new Set(examples)].slice(0,20)});}
 return declared;
}
function examplePath({type,pattern}){let path=pattern;if(/GLOB/i.test(type))path=path.replace(/\.\*/g,'').replace(/\\/g,'');if(!path.startsWith('/'))path='/'+path;return path;}
