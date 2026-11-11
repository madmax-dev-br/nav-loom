import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {operations} from '../agent/operations.mjs';
const root=resolve(process.argv[2]||process.cwd()),owner='mcp-'+randomUUID();
async function call(name,args={}){const {port,token}=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));const response=await fetch(`http://127.0.0.1:${port}/${name}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-navloom-client':owner},body:JSON.stringify(args)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
const instructions=`Navloom maps an application by driving it for you and remembers every confirmed path.
1. Call navloom_memory once: it lists known screens, connections, API calls and deeplinks.
2. navloom_start opens the app and returns the first observation. Every step/goto/replay returns the resulting observation, so do not call navloom_observe after them.
3. To reach a known screen use navloom_goto (one call) instead of repeating steps. Step manually only through unknown territory.
4. Ids may be passed in the short form you received.
5. When you notice a stable pattern Navloom misses (the app logs its requests in its own format, a screen changes text but is the same screen), read navloom_harness and register a small script with navloom_harness_propose. A person approves it; later runs then recognise it deterministically.
6. When done, name screens and flows with one navloom_organize call, then navloom_finish.`;
const server=new McpServer({name:'navloom',version:'2.1.0'},{instructions});
for(const [name,operation] of Object.entries(operations(null,null))){if(operation.ui)continue;server.registerTool(`navloom_${name}`,{description:operation.description,inputSchema:operation.schema.shape},async args=>{try{const result=await call(name,args);return result?.mimeType==='image/png'?{content:[{type:'image',mimeType:result.mimeType,data:result.data}]}:{content:[{type:'text',text:typeof result==='string'?result:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});}
const timer=setInterval(()=>call('heartbeat').catch(()=>{}),10000);timer.unref();let closing=false;async function close(){if(closing)return;closing=true;clearInterval(timer);await call('disconnect').catch(()=>{});await server.close();}
process.stdin.once('end',()=>void close());for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().finally(()=>process.exit(0)));
await server.connect(new StdioServerTransport());
