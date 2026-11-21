import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {operations,TIERS} from '../agent/operations.mjs';
/**
 * MCP bridge to the local Navloom service. Only the core tools are exposed by default: every tool definition is sent
 * to the model on every turn, so the catalog is kept small. `--tools=extended|all` (or NAVLOOM_MCP_TOOLS) widens it.
 * Help requests are asked in the client's own chat through MCP elicitation when the client supports it.
 */
const args=process.argv.slice(2);const root=resolve(args.find(a=>!a.startsWith('--'))||process.cwd()),owner='mcp-'+randomUUID();
const tier=(args.find(a=>a.startsWith('--tools='))?.slice(8)||process.env.NAVLOOM_MCP_TOOLS||'core').toLowerCase();
const allowed=new Set(TIERS[tier]??TIERS.core);if(tier==='all')for(const name of Object.keys(operations(null,null)))allowed.add(name);
async function call(name,args={},headers={}){const {port,token}=JSON.parse(await readFile(join(root,'.navloom/runtime.json'),'utf8'));const response=await fetch(`http://127.0.0.1:${port}/${name}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-navloom-client':owner,...headers},body:JSON.stringify(args)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
const instructions=`Navloom maps an application by driving it for you and remembers every confirmed path.
1. Call navloom_memory once: it lists known screens, connections, API calls, deeplinks and remembered help.
2. navloom_start opens the app and returns the first screen. Pick the mode: record to map new things, validate to walk what is recorded and report what differs (screens, destinations, API calls), walk to only navigate. What a record/validate mission finds is a draft: it joins the recorded map only after a person approves it in the interface (Execuções), so tell the user when finish returns review=pending. Every step/goto returns the resulting screen, so do not call navloom_observe after them.
3. To reach a known screen, however deep, call navloom_goto {screen}: Navloom walks there by itself with the learned graph and opens a mission if none is active (no start/observe needed). Do not step through known screens or reason about the route; navloom_memory entryPoints says where every screen and flow starts (from the app's opening, deeplinks, tabs). Your judgement is needed only when goto returns stuck: read diagnosis (cause app_error = the app answered with an error on the way, appSays quotes it; unknown_screen = a new case; unknown_state; no_way_forward; blocked = device or app failure; unexpected = what the graph expected and what came instead; branches = the app forks here, e.g. a purchase approved or declined). Map the new part with navloom_step; it is learned for next time. If you cannot tell which scenario or flow the person means, ask with navloom_ask kind=decision and options instead of guessing. Step manually only through unknown territory; navloom_explore probes pending candidates in a batch.
4. Elements read "id label": click is implied, other actions come in parentheses. Ids may be passed in the short form you received. Pass detail="digest" when you need the text graph of a screen with pixel boxes.
5. When you cannot proceed (a credential, a value only a person knows, a decision), call navloom_ask; the answer is remembered for later runs.
6. Screens are recognised by what they always show, not by their exact content: another product or a changed balance is the same screen. A capture reported screen.new with lookalike is for you to judge: if it is that screen, call navloom_merge (navloom_memory lists possibleDuplicates too); if not, leave it. trail is the way you came. Once the main screens are mapped, navloom_harness {suggest:"screen"} writes the screen-identity script from the map; pass it to navloom_harness_propose. When you notice another stable pattern (the app logs its requests in its own format), register a script the same way. A person approves scripts; later runs then recognise it deterministically.
7. Accounts are profiles and places (mock, staging) are environments: pass profile/environment to start or goto. Screens are shared; routes learned in one environment are reused in another. When the mission needs an account with some trait and no profile description fits, navloom_ask kind=account.
8. When done, name screens and flows with one navloom_organize call, then navloom_finish.`;
const server=new McpServer({name:'navloom',version:'2.1.0'},{instructions});
const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
/** Ask the person in the client's chat (MCP elicitation). Returns null when the client cannot show the form. */
async function elicit(request){
 if(!server.server.getClientCapabilities()?.elicitation)return null;
 const secret=request.kind==='credential';const title=secret?'Segredo (guardado só nesta máquina)':request.kind==='decision'?'Decisão':'Resposta';
 const property=request.options?.length?{type:'string',title,enum:request.options}:{type:'string',title,description:secret?`Será guardado em .navloom/secrets.json como "${request.secretRef||'help_'+request.kind}" e usado por secretRef; nunca entra no mapa versionado.`:'Valor ou instrução para o agente'};
 const message=`Navloom precisa de ajuda${request.screenId?' na tela atual':''}: ${request.question}${request.why?`\n\nPor quê: ${request.why}`:''}`;
 try{const result=await server.server.elicitInput({mode:'form',message,requestedSchema:{type:'object',properties:{answer:property},required:['answer']}},{timeout:10*60*1000});
  if(result.action!=='accept'||typeof result.content?.answer!=='string'||!result.content.answer.length)return {status:'declined',request};
  const answer=result.content.answer;const payload=request.options?.length?{requestId:request.id,option:answer,via:'elicitation'}:secret?{requestId:request.id,value:answer,secret:true,secretRef:request.secretRef||undefined,via:'elicitation'}:request.kind==='input'?{requestId:request.id,value:answer,via:'elicitation'}:{requestId:request.id,instruction:answer,via:'elicitation'};
  return call('answer',payload);
 }catch(e){return {status:'pending',request,elicitationError:e.message};}
}
const HOW_TO_ANSWER='The client cannot show a form: ask the person this question in the chat (use your client\'s question tool if it has one, offering the options), end your turn, and when they reply call navloom_answer with requestId and value, option or instruction (secret:true for credentials).';
for(const [name,operation] of Object.entries(operations(null,null))){
 if(!allowed.has(name)||operation.ui)continue;
 server.registerTool(`navloom_${name}`,{description:operation.description,inputSchema:operation.schema.shape},async input=>{try{
  if(name==='ask'){const asked=await call('ask',input);if(asked.status!=='pending')return text(asked);const answered=await elicit(asked.request);if(answered?.entry)return text({status:'answered',entry:answered.entry,note:'Answered in the chat and remembered in the harness.'});return text({...asked,...(answered?.status==='declined'?{declined:true}:{}),howToAnswer:HOW_TO_ANSWER});}
  const result=await call(name,input);
  return result?.mimeType?.startsWith('image/')?{content:[{type:'image',mimeType:result.mimeType,data:result.data}]}:text(result);
 }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
}
const timer=setInterval(()=>call('heartbeat').catch(()=>{}),10000);timer.unref();let closing=false;async function close(){if(closing)return;closing=true;clearInterval(timer);await call('disconnect').catch(()=>{});await server.close();}
process.stdin.once('end',()=>void close());for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().finally(()=>process.exit(0)));
await server.connect(new StdioServerTransport());
