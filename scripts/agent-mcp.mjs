import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {operations} from '../agent/operations.mjs';
const root=resolve(process.argv[2]||process.cwd()),owner='mcp-'+randomUUID();
async function call(name,args={}){const {port,token}=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));const response=await fetch(`http://127.0.0.1:${port}/${name}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-navloom-client':owner},body:JSON.stringify(args)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
const server=new McpServer({name:'navloom',version:'2.0.0'});
for(const [name,operation] of Object.entries(operations(null,null)))server.registerTool(`navloom_${name}`,{description:operation.description,inputSchema:operation.schema.shape},async args=>{try{const result=await call(name,args);return result?.mimeType==='image/png'?{content:[{type:'image',mimeType:result.mimeType,data:result.data}]}:{content:[{type:'text',text:JSON.stringify(result)}]};}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
const timer=setInterval(()=>call('heartbeat').catch(()=>{}),10000);timer.unref();let closing=false;async function close(){if(closing)return;closing=true;clearInterval(timer);await call('disconnect').catch(()=>{});await server.close();}
process.stdin.once('end',()=>void close());for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().finally(()=>process.exit(0)));
await server.connect(new StdioServerTransport());
