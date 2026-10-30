import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../../lib/agent-screen-routes.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {screenRoutes}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
test('routes preserve button origins, deduplicate repeated actions, and separate automatic events',()=>{
 const states=[{id:'a',screenId:'A'},{id:'a-error',screenId:'A'},{id:'b',screenId:'B'}];
 const edge=(id,from,to,action,runId='run',kind='navigation')=>({id,from,to,kind,action,confirmed:true,evidence:[{runId}]});
 const graph={states,transitions:[edge('buy','a','b',{type:'click',elementIdentity:'buy'}),edge('buy-again','a','b',{type:'click',elementIdentity:'buy'}),edge('retry','a-error','b',{type:'click',elementIdentity:'retry'}),edge('automatic','a','b',{type:'wait'}),edge('back','b','a',{type:'back'}),edge('state','a','a-error',{type:'click'},'run','state'),edge('other','a','b',{type:'click'},'other')]};
 const paths=screenRoutes(graph,'run',['navigation','state'],['A','B']);assert.equal(paths.length,4);assert.deepEqual(paths[0].actionIds,['buy','buy-again']);assert.equal(paths[0].elementIdentity,'buy');assert.equal(paths[0].origin,'interaction');assert.equal(paths[1].origin,'interaction');assert.equal(paths[2].origin,'automatic');assert.equal(paths[3].origin,'interaction');assert.equal(screenRoutes(graph,'run',['navigation'],['A']).length,0);
});
