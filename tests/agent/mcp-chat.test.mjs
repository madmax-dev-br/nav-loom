import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {stringify} from 'yaml';
import {createService} from '../../agent/service.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {TIERS} from '../../agent/operations.mjs';
const config={version:2,kind:'navloom-agent-project',id:'chat',name:'Chat app',targets:{web:{platform:'web',url:'http://127.0.0.1:4790',origins:['http://127.0.0.1:4790']}},permissions:{actions:['open','click','fill','wait'],pluginCapabilities:[]}};
async function connect(root,{elicitation,tools}={}){const client=new Client({name:'test-client',version:'1'},elicitation?{capabilities:{elicitation:{}}}:undefined);const env={...process.env};if(tools)env.NAVLOOM_MCP_TOOLS=tools;await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('scripts/agent-mcp.mjs'),root],env}));return client;}
const parse=result=>JSON.parse(result.content.find(c=>c.type==='text').text);
test('core tool tier is small; extended and all widen it; descriptions stay short',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-mcp-')),service=await createService({root,port:0});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const core=await connect(root);t.after(()=>core.close());const {tools}=await core.listTools();assert.equal(tools.length,TIERS.core.length);assert.ok(tools.every(x=>x.description.length<=260),'core descriptions are short');assert.ok(JSON.stringify(tools).length<13500,'core catalog under 13.5k chars (was 33k with every tool)');assert.ok(!tools.some(x=>x.name==='navloom_configure'));
 const all=await connect(root,{tools:'all'});t.after(()=>all.close());assert.ok((await all.listTools()).tools.some(x=>x.name==='navloom_configure'));
 const extended=await connect(root,{tools:'extended'});t.after(()=>extended.close());assert.equal((await extended.listTools()).tools.length,TIERS.extended.length);
});
test('a help request is answered in the chat through MCP elicitation and remembered as a local secret',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-mcp-ask-'));await writeFile(join(root,'navloom.yaml'),stringify(config));const service=await createService({root,port:0});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const shown=[];const client=await connect(root,{elicitation:true});t.after(()=>client.close());
 client.setRequestHandler(ElicitRequestSchema,async request=>{shown.push(request.params);const property=request.params.requestedSchema.properties.answer;return {action:'accept',content:{answer:property.enum?property.enum[1]:'hunter2'}};});
 const asked=parse(await client.callTool({name:'navloom_ask',arguments:{kind:'credential',question:'Qual é a senha da conta de teste?',why:'Login exige senha.',secretRef:'login_password'}}));
 assert.equal(asked.status,'answered');assert.deepEqual(asked.entry.answer,{type:'secretRef',secretRef:'login_password'});assert.equal(asked.entry.resolvedBy,'elicitation');
 assert.match(shown[0].message,/senha da conta de teste/);assert.equal(shown[0].requestedSchema.properties.answer.type,'string');
 assert.equal(JSON.parse(await readFile(join(root,'.navloom/secrets.json'),'utf8')).login_password,'hunter2');
 const decision=parse(await client.callTool({name:'navloom_ask',arguments:{kind:'decision',question:'Posso criar conta?',options:['sim','não']}}));assert.equal(decision.entry.answer.value,'não');assert.deepEqual(shown[1].requestedSchema.properties.answer.enum,['sim','não']);
 const again=parse(await client.callTool({name:'navloom_ask',arguments:{kind:'credential',question:'Senha?',secretRef:'login_password'}}));assert.equal(again.status,'known','not asked twice');
 const help=parse(await client.callTool({name:'navloom_help',arguments:{}}));assert.equal(help.pending.length,0);assert.equal(help.harness.length,2);
});
test('without elicitation the agent is told to ask in the chat and relays the answer with navloom_answer',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-mcp-relay-'));await writeFile(join(root,'navloom.yaml'),stringify(config));const service=await createService({root,port:0});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
 const client=await connect(root);t.after(()=>client.close());
 const asked=parse(await client.callTool({name:'navloom_ask',arguments:{kind:'input',question:'Qual CEP usar?'}}));assert.equal(asked.status,'pending');assert.match(asked.howToAnswer,/ask the person this question in the chat/i);
 const relayed=parse(await client.callTool({name:'navloom_answer',arguments:{requestId:asked.request.id,value:'01310-100'}}));assert.equal(relayed.entry.answer.value,'01310-100');assert.equal(relayed.entry.resolvedBy,'chat');
 const bad=await client.callTool({name:'navloom_answer',arguments:{requestId:asked.request.id,value:'x'}});assert.equal(bad.isError,true);
});
