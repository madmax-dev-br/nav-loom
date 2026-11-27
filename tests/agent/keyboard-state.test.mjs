import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../../agent/runtime.mjs';
import {AndroidExecutor} from '../../agent/executors/android.mjs';
import {mergeStates} from '../../agent/merge.mjs';

/**
 * The keyboard never takes the place of the state it opened on. A form that declares no ids (or, with `keys`, its own
 * screen and state), whose keyboard may land late: after the elements were read and before the screenshot is taken.
 */
const config={version:2,kind:'navloom-agent-project',review:'auto',id:'kbd',name:'Keyboard app',targets:{android:{platform:'android',serial:'emulator-5554',package:'dev.form',activity:'.MainActivity',adb:'adb'}},permissions:{actions:['open','click','fill','scroll','back','wait','deeplink'],deeplinkPrefixes:[],pluginCapabilities:[]}};
const FIELD='field00000000000000000a';
class Form{
 constructor({late=false,keys=false}={}){this.late=late;this.keys=keys;this.keyboard=false;this.opening=false;this.looks=0;}
 async capabilities(){return {available:['capture','interact','hierarchy','logs','back','scroll'],missing:[]};}
 async start(){this.keyboard=false;}async restart(){this.keyboard=false;}async build(){return {version:'1'};}
 // The picture says what was on the glass when it was taken.
 async capture(){return Buffer.from(this.keyboard?'png:keyboard':'png:clean');}
 async keyboardShown(){return this.keyboard;}
 async observe(){this.looks++;const text=(t,y,i)=>({id:`text${i}`.padEnd(24,'0'),identity:`android.widget.TextView:${i}|android.widget.TextView|${t}`,name:t,role:'android.widget.TextView',text:t,actions:[],bounds:{x:.1,y,width:.8,height:.04},visible:true,label:t});
  const elements=[text('Cadastro',.06,0),text('Informe seus dados',.14,1),{id:FIELD,identity:'android.widget.EditText:2|android.widget.EditText|field',name:'Nome',role:'android.widget.EditText',text:'',actions:['click','fill'],bounds:{x:.1,y:.25,width:.8,height:.06},visible:true,label:'Nome'},{id:'save'.padEnd(24,'0'),identity:'android.view.View:3|android.view.View|Salvar',name:'Salvar',role:'android.view.View',text:'Salvar',actions:['click'],bounds:{x:.1,y:.4,width:.8,height:.06},visible:true,label:'Salvar'}];
  const observation={platform:'android',route:'dev.form/.MainActivity',activity:'dev.form/.MainActivity',header:'Cadastro',heading:'Cadastro',keyboard:this.keyboard,...(this.keys?{screenKey:'form',stateKey:'ready'}:{}),text:elements.map(e=>e.text).filter(Boolean).join('\n'),elements,viewport:{width:1080,height:2400},scroll:{position:'unknown'},hierarchy:'available',xml:'<hierarchy/>'};
  // The keyboard lands after the device answered: the next thing taken from it (the screenshot) already has it.
  if(this.opening){this.opening=false;this.keyboard=true;}
  return observation;}
 async act(action){if(action.type==='fill'||action.type==='click'){if(this.late)this.opening=true;else this.keyboard=true;}else if(action.type==='back')this.keyboard=false;else if(action.type==='scroll')this.keyboard=action.direction==='down';}
 async network(){return {calls:[],late:[]};}async deeplinks(){return [];}async diagnostics(){return {availability:'available',logs:[]};}async close(){}
}
async function setup(t,options){const root=await mkdtemp(join(tmpdir(),'navloom-kbd-'));t.after(()=>rm(root,{recursive:true,force:true}));const form=new Form(options);const r=await new Runtime(root,{executorFactory:()=>form}).init();await r.configure(config);const run=await r.start({target:'android',mode:'exploratory',objective:'Teclado'});assert.equal(run.status,'running',run.stopReason);return {r,run,form,top:run.observations[0]};}
const picture=async(r,observation)=>String(await r.store.resource(observation.screenshot));
/** No capture of a state shows another one: every picture agrees with the keyboard its capture and its state say. */
async function consistent(r,run){const graph=await r.store.graph(),all=(await r.store.run(run.id)).observations;
 for(const o of all){const state=graph.states.find(s=>s.id===o.stateId);assert.equal(!!state.keyboard,!!o.keyboard,`capture ${o.id} is on a state with another keyboard`);assert.equal(await picture(r,o),o.keyboard?'png:keyboard':'png:clean',`picture of ${o.id} disagrees with its capture`);}
 for(const state of graph.states)assert.equal(String(await r.store.resource(state.representative.screenshot)),state.keyboard?'png:keyboard':'png:clean',`representative picture of ${state.name}`);
 return graph;}

test('a keyboard that opens between reading the screen and photographing it is its own state, not the clean one',async t=>{
 const {r,run,form,top}=await setup(t,{late:true});assert.equal(await picture(r,top),'png:clean');
 const typed=await r.step(run.id,{type:'fill',elementId:FIELD,value:'Ana'});
 assert.equal(typed.observation.keyboard,true,'the capture says what its picture shows');assert.notEqual(typed.observation.stateId,top.stateId,'the clean state is not written over');assert.equal(typed.observation.screenId,top.screenId,'same screen');assert.equal(await picture(r,typed.observation),'png:keyboard');
 let graph=await consistent(r,run);assert.deepEqual(graph.states.map(s=>[s.screenId,!!s.keyboard]),[[top.screenId,false],[top.screenId,true]]);assert.equal(graph.screens.length,1);
 const clean=graph.states.find(s=>s.id===top.stateId);assert.equal(clean.representative.observationId,top.id);assert.equal(clean.lastSeen,top.id);
 // Closing it is the clean state again; opening it again is the same keyboard state, not a third one.
 assert.equal((await r.step(run.id,{type:'back'})).observation.stateId,top.stateId);assert.equal((await r.step(run.id,{type:'fill',elementId:FIELD,value:'Bia'})).observation.stateId,typed.observation.stateId);
 graph=await consistent(r,run);assert.equal(graph.states.length,2);assert.equal(graph.screens.length,1);await r.finish(run.id);
});

test('a settled screen is read once: the capture is only taken again when the keyboard disagrees with the screenshot',async t=>{
 const looks=async form=>{const {r,run}=form;const before=form.form.looks;await r.step(run.id,{type:'fill',elementId:FIELD,value:'Ana'});await r.observe(run.id);await r.finish(run.id);return form.form.looks-before;};
 const plain=await setup(t);plain.form.keyboardShown=undefined;// an executor that cannot say: the capture as it always was
 assert.equal(await looks(await setup(t)),await looks(plain));
});

test('a scroll that opens or closes the keyboard without moving the view does not land on the state it came from',async t=>{
 const {r,run,top}=await setup(t);
 const typed=await r.step(run.id,{type:'fill',elementId:FIELD,value:'Ana'});assert.notEqual(typed.observation.stateId,top.stateId);
 // The scroll closes the keyboard and nothing moves: the clean state, not the keyboard one it started on.
 assert.equal((await r.step(run.id,{type:'scroll',direction:'up'})).observation.stateId,top.stateId);
 // The scroll opens it: the keyboard state already known, not the clean one it started on.
 assert.equal((await r.step(run.id,{type:'scroll',direction:'down'})).observation.stateId,typed.observation.stateId);
 const graph=await consistent(r,run);assert.equal(graph.states.length,2);assert.equal(graph.screens.length,1);await r.finish(run.id);
});

test('a state chosen by the app key or by a merge is not written over by a capture with another keyboard',async t=>{
 const {r,run,top}=await setup(t,{keys:true});
 const typed=await r.step(run.id,{type:'fill',elementId:FIELD,value:'Ana'});assert.notEqual(typed.observation.stateId,top.stateId);await r.step(run.id,{type:'back'});
 // Someone folds the keyboard state into the clean one: from then on its id answers to the clean state.
 let graph=await r.store.graph();mergeStates(graph,top.stateId,[typed.observation.stateId]);await r.store.saveGraph(graph);assert.equal(graph.states.length,1);
 const again=await r.step(run.id,{type:'fill',elementId:FIELD,value:'Bia'});assert.notEqual(again.observation.stateId,top.stateId,'the keyboard capture stays off the clean state');assert.equal(again.observation.screenId,top.screenId);
 await r.step(run.id,{type:'back'});assert.equal((await r.step(run.id,{type:'fill',elementId:FIELD,value:'Caio'})).observation.stateId,again.observation.stateId,'seen again, the same keyboard state');
 graph=await r.store.graph();assert.deepEqual(graph.states.map(s=>[s.name,!!s.keyboard]),[['ready',false],['ready · teclado',true]]);
 const clean=graph.states.find(s=>s.id===top.stateId);assert.equal(clean.representative.observationId,top.id);assert.equal(String(await r.store.resource(clean.representative.screenshot)),'png:clean');await r.finish(run.id);
});

test('Android: the keyboard is asked about again after the screenshot and the capture is retaken when it changed',async t=>{
 const root=await mkdtemp(join(tmpdir(),'navloom-kbd-adb-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const device={keyboard:false,opening:true,dumps:0,shots:0,silent:false};
 const xml=`<?xml version='1.0'?><hierarchy rotation="0"><node index="0" text="Cadastro" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" scrollable="false" password="false" bounds="[80,120][1000,260]" /><node index="1" text="" resource-id="dev.form:id/name" class="android.widget.EditText" content-desc="Nome" clickable="true" enabled="true" scrollable="false" password="false" bounds="[80,500][1000,640]" /></hierarchy>`;
 const adb=async(file,args)=>{const cmd=args.slice(2).join(' ');
  if(cmd.startsWith('shell dumpsys activity activities')&&cmd.includes('uiautomator dump')){device.dumps++;const out=`  mResumedActivity: ActivityRecord{1a2b u0 dev.form/.MainActivity t42}\n__NAVLOOM_SPLIT__\n${xml}__NAVLOOM_SPLIT__\n  mInputShown=${device.keyboard}\n__NAVLOOM_SPLIT__\n__NAVLOOM_SPLIT__\n`;if(device.opening){device.opening=false;device.keyboard=true;}return out;}
  if(cmd==='exec-out screencap -p'){device.shots++;return Buffer.from(device.keyboard?'png:keyboard':'png:clean');}
  if(cmd.startsWith('shell dumpsys input_method'))return device.silent?'':`  mShowRequested=true mInputShown=${device.keyboard}\n`;
  throw Error('Unexpected adb command: '+cmd);};
 const executor=new AndroidExecutor(config.targets.android,{runCommand:adb});executor.viewport={width:1080,height:2280};
 assert.equal(await executor.keyboardShown(),false);device.silent=true;assert.equal(await executor.keyboardShown(),null,'a device that does not say is not taken for a closed keyboard');device.silent=false;
 const r=await new Runtime(root,{executorFactory:()=>executor}).init();r.executor=executor;
 const seen=await r.sight();assert.equal(seen.observation.keyboard,true);assert.equal(String(seen.image),'png:keyboard');assert.deepEqual([device.dumps,device.shots],[2,2],'read and photographed once more, after the keyboard landed');
 const settled=await r.sight();assert.equal(settled.observation.keyboard,true);assert.deepEqual([device.dumps,device.shots],[3,3],'nothing is read twice once both agree');
});
