import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {fixture} from './fixture.mjs';
test('web error evidence, browser logs, missing hierarchy and unsupported capabilities',async t=>{const app=await fixture(),root=await mkdtemp(join(tmpdir(),'navloom-errors-')),r=await new Runtime(root).init();t.after(async()=>{await r.close();await app.close();await rm(root,{recursive:true,force:true});});await r.configure({version:2,kind:'navloom-agent-project',id:'errors',name:'Errors',targets:{web:{platform:'web',url:app.url,origins:[app.url]}}});const unavailable=await r.start({target:'web',mode:'focused',objective:'Missing capability',requiredCapabilities:['adb']});assert.equal(unavailable.status,'blocked');await fetch(app.url+'/fail');const run=await r.start({target:'web',mode:'focused',objective:'Declined checkout',assertions:[{type:'no_errors'}]});for(const label of ['Explore the tote','Add to bag','Checkout','Place order']){const current=await r.store.run(run.id),element=current.observations.at(-1).elements.find(e=>e.name===label);assert.equal((await r.step(run.id,{type:'click',elementId:element.id})).status,'completed');}await r.step(run.id,{type:'wait',durationMs:500});const ended=await r.finish(run.id);assert.equal(ended.result,'failed');assert.equal(ended.observations.at(-1).stateKey,'declined');assert.ok(ended.diagnostics.logs.some(l=>l.message.includes('402')));});
