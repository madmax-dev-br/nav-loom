import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {parse} from 'yaml';
test('real Compose app: explore login and purchase, then reuse known Android route',{skip:process.env.NAVLOOM_ANDROID_TEST!=='1',timeout:240000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-android-')),r=await new Runtime(root).init();t.after(async()=>{await r.close();await rm(root,{recursive:true,force:true});});const config=parse(await readFile('examples/android-test-app/navloom.agent.example.yaml','utf8'));config.repositories=[];config.reset.args=[resolve('examples/android-test-app/server/reset.mjs'),'--serial',config.targets.android.serial];config.reset.cwd='.';await r.configure(config);
 const run=await r.start({target:'android',mode:'exploratory',objective:'Android checkout',assertions:[{type:'text',value:'Compra confirmada'}]});assert.equal(run.status,'running',run.stopReason);await r.reset(run.id);
 async function clickTag(tag){const obs=(await r.store.run(run.id)).observations.at(-1),element=obs.elements.find(e=>e.resourceId===tag);assert.ok(element,`Missing ${tag} on ${obs.screenKey}: ${obs.elements.map(e=>e.resourceId).join(',')}`);const result=await r.step(run.id,{type:'click',elementId:element.id});assert.equal(result.status,'completed',result.reason);return result;}
 for(const tag of ['auth_submit','tab_products','product_tote','product_add_cart','cart_checkout','checkout_confirm'])await clickTag(tag);
 const completed=await r.finish(run.id);assert.equal(completed.observations.at(-1).screenKey,'receipt');assert.equal(completed.result,'passed');const receipt=completed.observations.at(-1).stateId;const second=await r.start({target:'android',mode:'focused',objective:'Replay Android checkout'});await r.reset(second.id);const route=await r.route({runId:second.id,scenarioRunId:run.id});assert.equal(route.found,true);const replay=await r.replay(second.id,route.steps);assert.equal(replay.status,'completed',JSON.stringify(replay));const repeated=await r.finish(second.id);assert.equal(repeated.observations.at(-1).screenKey,'receipt');assert.ok(repeated.metrics.replayedSteps>=6);await mkdir('outputs',{recursive:true});await writeFile('outputs/android-runtime-test.json',JSON.stringify({time:new Date().toISOString(),firstRun:completed.id,repeatRun:repeated.id,confirmedTransitions:(await r.store.graph()).transitions.length,replayedSteps:repeated.metrics.replayedSteps,agentCalls:repeated.metrics.agentCalls,passed:true},null,2));
});
