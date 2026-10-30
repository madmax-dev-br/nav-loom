import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {fixture} from './fixture.mjs';
test('real web checkout, loading capture, scroll identity, graph reuse and failure diagnostics',async t=>{const app=await fixture(),root=await mkdtemp(join(tmpdir(),'navloom-web-'));const r=await new Runtime(root).init();t.after(async()=>{await r.close();await app.close();await rm(root,{recursive:true,force:true});});await r.configure({version:2,kind:'navloom-agent-project',id:'web',name:'Web test',targets:{web:{platform:'web',url:app.url,origins:[app.url]}},permissions:{actions:['open','click','scroll','wait'],pluginCapabilities:[]}});const capability=await r.capabilities('web');assert.deepEqual(capability.missing,[],'Install Chromium before running the integration test');
 const run=await r.start({target:'web',mode:'exploratory',objective:'Checkout',assertions:[{type:'text',value:'ORDER-001'},{type:'no_errors'}]});assert.equal(run.status,'running',run.stopReason);const original=run.observations.at(-1);const scrolled=await r.step(run.id,{type:'scroll',direction:'down'});assert.equal(scrolled.observation.stateId,original.stateId);assert.ok(scrolled.observation.scroll.y>0);await r.step(run.id,{type:'scroll',direction:'up'});
 async function click(name){const obs=(await r.store.run(run.id)).observations.at(-1),element=obs.elements.find(e=>e.name===name);assert.ok(element,name);const result=await r.step(run.id,{type:'click',elementId:element.id});assert.equal(result.status,'completed',result.reason);return result;}
 for(const name of ['Explore the tote','Add to bag','Checkout'])await click(name);const loading=await click('Place order');assert.equal(loading.observation.stateKey,'loading');await r.step(run.id,{type:'wait',durationMs:500});const finished=await r.finish(run.id);assert.equal(finished.result,'passed');const receipt=finished.observations.at(-1).stateId;
 const focused=await r.start({target:'web',mode:'focused',objective:'Repeat checkout',assertions:[{type:'text',value:'ORDER-001'}]});const route=await r.route({runId:focused.id,to:receipt});assert.equal(route.found,true);const replay=await r.replay(focused.id,route.steps);assert.equal(replay.status,'completed',JSON.stringify(replay));const done=await r.finish(focused.id);assert.equal(done.result,'passed');assert.ok(done.metrics.replayedSteps>0);assert.equal(done.metrics.agentCalls,0);
});
