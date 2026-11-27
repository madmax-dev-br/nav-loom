import {orderScreenIds} from '../lib/screen-order.mjs';
import {readFile,realpath,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Store,uid,now,hash,safePath,emptyGraph} from './store.mjs';
import {actionSchema,missionSchema,defaultEnvironment,targetIn,envOf,envKey} from './schema.mjs';
import {recordObservation,confirmTransition,planRoute,compareRuns,resolveScreen,resolveState,placeScroll} from './graph.mjs';
import {structureKey,locate,tokensOf,learn,similarScreens,controlsOfHotspots,selectedTab} from './recognize.mjs';
import {mergeScreens,mergeStates} from './merge.mjs';
import {screenScript} from './learn.mjs';
import {entryPoints} from './flowgraph.mjs';
import {ownerStep,ruled,reattribute} from './apis.mjs';
import {answerOf,recordResponses} from './outcomes.mjs';
import {decisionGraph,describeDecisions} from './navigate.mjs';
import {reviewChanges,mergeDraft,carryOver,normalizeMode} from './review.mjs';
import {observationDiff,imageDiff,classifyOutcome,summarizeTransition} from './diff.mjs';
import {mergeApis,endpointIndex,normalizeCall,normalizePath} from './network.mjs';
import {exportMap,importMap} from './map.mjs';
import {Harness} from './harness.mjs';
import {Help,publicEntry} from './help.mjs';
import {repositoryRoot,searchSource,tree,suggestLinks,guessRole} from './sources.mjs';
import {sourceLinkSchema} from './schema.mjs';
import {decodePng,scalePng} from './png.mjs';
import {encodeJpeg} from './jpeg.mjs';
import {digest,leanGraph,leanScreen,leanTransition} from './lean.mjs';
import {screenContext} from '../lib/screen-context.mjs';
import {fileURLToPath} from 'node:url';
import {WebExecutor} from './executors/web.mjs';
import {AndroidExecutor} from './executors/android.mjs';
import {IosExecutor} from './executors/ios.mjs';
import {command,gitVersion} from './process.mjs';
const executors={web:WebExecutor,android:AndroidExecutor,ios:IosExecutor};
/** Where the app opens differs per environment (a mock may skip the sign-in), so the entry screen is kept per target and environment. */
export const entryKey=item=>envOf(item)==='default'?item.target:`${item.target}@${envOf(item)}`;
/** The screen an operation shows: the one named, or the one of the state named alone. */
const shownScreen=(graph,ref,stateRef)=>ref?resolveScreen(graph,ref):graph.screens.find(s=>s.id===resolveState(graph,stateRef).screenId);
export class Runtime{
 constructor(root,{executorFactory}={}){this.store=new Store(root);this.harness=new Harness(this.store);this.help=new Help(this.store);const create=executorFactory??(target=>new executors[target.platform](target));/* Every executor consults the scripts learned for this project. */this.factory=target=>Object.assign(create(target),{harness:this.harness});this.executor=null;this.active=null;this.tail=Promise.resolve();this.mapError=null;this.draftRun=null;this.store.draftId=()=>this.active&&this.draftRun===this.active?this.active:null;
  this.store.graphFallback=async()=>{const config=await this.store.config();return config.map.enabled?importMap(join(this.store.root,config.map.dir)):null;};}
 async init(){await this.store.init();await this.harness.load();for(const run of await this.store.runs())if(run.status==='running'){run.status='paused';run.stopReason='service_restarted';await this.store.saveRun(run);}return this;}
 exclusive(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
 async mapDir(){try{const config=await this.store.config();return config.map.enabled?join(this.store.root,config.map.dir):null;}catch{return null;}}
 /** Compact by default; 'full' returns the complete records. */
 async view(detail,full,lean){return detail==='full'?full:lean();}
 /** One screen in depth, as text: state digests, transitions in and out, deeplinks, code links and remembered help. */
 async screenDetail({screen:ref,state:stateRef}){const graph=await this.store.graph(),screen=shownScreen(graph,ref,stateRef);return {...leanScreen(graph,screen.id),...(stateRef?{shownState:resolveState(graph,stateRef,screen.id).id}:{})};}
 async transition({id,detail='compact'}){const graph=await this.store.graph();const t=graph.transitions.find(x=>x.id===id);if(!t)throw Error('Transition not found');return detail==='full'?t:{...leanTransition(t,graph),diff:t.diff?{textAdded:t.diff.textAdded,textRemoved:t.diff.textRemoved,elementsAdded:t.diff.elementsAdded,elementsRemoved:t.diff.elementsRemoved,markersAdded:t.diff.markersAdded}:null,region:t.imageChange?.region??null,replay:t.action};}
 /** Screenshots go to the model downscaled and compressed; the full PNG stays on disk. */
 async evidence({path,maxWidth,quality=60,format='jpeg'}){const data=await this.store.resource(path);if(path.endsWith('.json'))return {text:data.toString('utf8')};if(path.endsWith('.jpg')&&format==='jpeg'&&!maxWidth)return {mimeType:'image/jpeg',data:data.toString('base64')};const config=await this.store.config();const width=maxWidth??config.captures.modelWidth;if(path.endsWith('.jpg'))return {mimeType:'image/jpeg',data:data.toString('base64'),note:'Preview already compressed; request the .png path with maxWidth for a different size'};const image=scalePng(decodePng(data),width);if(format==='png'){const {encodePng}=await import('./png.mjs');return {mimeType:'image/png',data:encodePng(image).toString('base64')};}return {mimeType:'image/jpeg',data:encodeJpeg(image,quality).toString('base64'),width:image.width,height:image.height};}
 async status({detail='compact'}={}){const full=await this.fullStatus();if(detail==='full')return full;const graph=full.graph;return {config:full.config?{id:full.config.id,name:full.config.name,targets:Object.fromEntries(Object.entries(full.config.targets).map(([k,t])=>[k,t.platform])),profiles:Object.keys(full.config.profiles),permissions:full.config.permissions.actions,repositories:(full.config.repositories??[]).map(r=>r.id),limits:full.config.limits}:null,configurationError:full.configurationError,counts:{screens:graph.screens.length,states:graph.states.length,transitions:graph.transitions.length,endpoints:full.endpoints.length,deeplinks:(graph.deeplinks??[]).length,harness:(graph.harness??[]).length,scripts:full.harness.scripts.filter(s=>s.status==='active').length},endpoints:full.endpoints.map(e=>`${e.method} ${e.path}${e.statuses.length?' '+e.statuses.join('/'):''}`),requests:full.requests.map(r=>({id:r.id,kind:r.kind,question:r.question})),runs:full.runs.slice(0,10).map(r=>({id:r.id,objective:r.objective,status:r.status,result:r.result??null,steps:r.steps.length})),activeRun:full.activeRun,service:full.service};}
 async fullStatus(){await this.settleAll();let config=null,configurationError=null;try{config=await this.store.config();}catch(e){configurationError=e.message;}const graph=await this.store.graph();return {config,configurationError,graph:{...graph,harness:(graph.harness??[]).map(publicEntry)},endpoints:endpointIndex(graph).map(e=>({...e,links:graph.endpointLinks?.[`${e.method} ${e.path}`]??[]})),requests:await this.help.pending(),runs:await this.store.runs(),activeRun:this.active,harness:{scripts:this.harness.list(),activity:this.harness.activity.slice(-60)},service:{version:2,root:this.store.root,mcp:fileURLToPath(new URL('../scripts/agent-mcp.mjs',import.meta.url)),map:config?.map?.enabled?{dir:config.map.dir,error:this.mapError}:null}};}
 async configure(config){if(this.active)throw Error('Pause the current mission before changing configuration');return this.store.saveConfig(config);}
 async capabilities(targetId){const config=await this.store.config(),target=config.targets[targetId];if(!target)throw Error('Unknown target');const executor=this.factory(target);return executor.capabilities();}
 async version(config,target,executor){const repositories=await gitVersion(config,this.store.root),build=await executor.build();/* The fingerprint identifies the application build. How Navloom captures it (network recording, reset routine) is not part of that. */const {network,reset,...app}=target;void network;void reset;return {repositories,build,sourceCorrespondence:'unverified',fingerprint:hash({target:app,build,repositories})};}
 /** Mirror the graph into the committed text map. Failures are reported in status instead of blocking the mission. */
 async syncMap(graph){if(this.store.draftId())return;try{const config=await this.store.config();if(!config.map.enabled)return;const before=JSON.stringify(graph.states.map(s=>s.thumbnail));await exportMap(this.store,config,graph);if(JSON.stringify(graph.states.map(s=>s.thumbnail))!==before)await this.store.saveGraph(graph);this.mapError=null;}catch(e){this.mapError=e.message;}}
 async start(input,owner='interface'){
 if(this.active)throw Error('A mission is already active');const mission=missionSchema.parse(input);await this.settleAll();mission.mode=normalizeMode(mission.mode);const config=await this.store.config();mission.environment??=defaultEnvironment(config);if(mission.environment!=='default'&&!config.environments?.[mission.environment])throw Error(`Unknown environment "${mission.environment}"; declared: ${Object.keys(config.environments??{}).join(', ')||'none'}`);const target=targetIn(config,mission.target,mission.environment);if(!target||!config.profiles[mission.profile])throw Error('Unknown target or profile');mission.envKey=envKey(config,mission.environment);
 const executor=this.factory(target),capabilities=await executor.capabilities();const missing=mission.requiredCapabilities.filter(c=>!capabilities.available.includes(c)&&!capabilities.conditional?.includes(c));
 const run={id:uid(),...mission,owner,startedAt:now(),updatedAt:now(),status:missing.length?'blocked':'running',capabilities,observations:[],steps:[],frontier:[],checks:[],limits:config.limits,stopReason:missing.length?`Missing capabilities: ${missing.join(', ')}`:null,metrics:{agentCalls:0,replayedSteps:0,recoveryRequests:0,probes:0},configHash:hash(config)};
 await this.store.saveRun(run);if(missing.length)return run;
 // Before the draft opens: profiles derived from the recorded evidence are not something the mission found.
 await this.bootstrapProfiles();await this.openDraft(run,config);await this.store.saveRun(run);
 this.interruptRequested=false;this.executor=executor;this.active=run.id;try{await executor.start();run.version=await this.version(config,target,executor);const links=await executor.deeplinks?.(),declared=Array.isArray(links)?links:links?.patterns??[];const entry=await this.captureRun(run);await this.settleNetwork(run,{quick:false});entry.network=run.entryNetwork??[];{const graph=await this.store.graph();this.runCaptures(graph,entry,{calls:entry.network});
  // Where missions found the app when they began: the likely entry until a cold start (goto) confirms it in `entries`.
  graph.starts??={};const opened=(graph.starts[entryKey(run)]??={});opened[entry.stateId]=(opened[entry.stateId]??0)+1;await this.store.saveGraph(graph);
  graph.declaredDeeplinks??={};if(JSON.stringify(graph.declaredDeeplinks[run.target]??[])!==JSON.stringify(declared)){graph.declaredDeeplinks[run.target]=declared;await this.store.saveGraph(graph);}}if(mission.requiredCapabilities.includes('hierarchy')&&run.observations.at(-1).hierarchy==='unavailable')throw Error('Required hierarchy capability is unavailable');await this.store.saveRun(run);return run;}catch(e){run.status='blocked';run.stopReason=e.message;await this.store.saveRun(run);await executor.close().catch(()=>{});this.active=null;this.executor=null;return run;}
 }
 async live(id){if(this.active!==id||!this.executor)throw Error('Mission is paused or not active. Resume it first.');const run=await this.store.run(id);if(run.status!=='running')throw Error('Mission is not running');return run;}
 /** Profile secrets come from environment variables; answers to help requests from the ignored local secret store. */
 async secretValues(run){const config=await this.store.config();const local=await this.help.secrets();return [...Object.values(config.profiles[run.profile]?.secrets??{}).map(env=>process.env[env]),...Object.values(local)].filter(Boolean);}
 async resolveSecret(config,run,secretRef){const env=config.profiles[run.profile].secrets[secretRef];if(env&&process.env[env]!==undefined)return process.env[env];const local=await this.help.secrets();if(local[secretRef]!==undefined)return local[secretRef];throw Error(env?`Environment variable ${env} for secret ${secretRef} is not set`:`Secret ${secretRef} is not configured in the profile nor answered as a help request`);}
 /**
  * What the device says (elements, whether the keyboard is up) and what it shows (the screenshot) are two round trips. A keyboard
  * that opens or closes between them would put the picture of one state on the capture of another, so the keyboard is asked
  * about again after the screenshot and both are taken again until they agree.
  */
 async sight(){let observation=await this.look(),image=await this.executor.capture();
  if(typeof this.executor.keyboardShown==='function')for(let attempt=0;attempt<3;attempt++){const shown=await this.executor.keyboardShown().catch(()=>null);if(typeof shown!=='boolean'||shown===!!observation.keyboard)break;observation=await this.look();image=await this.executor.capture();}
  return {observation,image};}
 async captureRun(run,{scrolledFrom,action,element}={}){
 const {observation,image}=await this.sight();observation.id=uid();observation.runId=run.id;observation.version=run.version;
 const graph=await this.store.graph(),previous=run.observations.at(-1);placeScroll(graph,observation,run.target,scrolledFrom,previous);
 // What the navigation says about where this capture is: where the action started, where the same action led before, the way here.
 const expected=action&&previous?graph.transitions.filter(t=>t.from===previous.stateId&&t.action.type===action.type&&(t.action.elementIdentity??null)===(element?.identity??null)&&(t.action.url??null)===(action.url??null)).map(t=>graph.states.find(s=>s.id===t.to)?.screenId).filter(Boolean):[];
 const trail=run.observations.slice(-12).map(o=>o.screenId);
 recordObservation(graph,observation,run,{previous,action,element,expected,trail});observation.trail=[...trail.filter((id,i)=>id!==trail[i-1]).slice(-5),observation.screenId].filter((id,i,all)=>id!==all[i-1]);observation.help=this.help.help(graph,observation,await this.profileSecrets(run.profile));observation.digest=digest(observation);observation.screenshot=`evidence/${observation.id}.png`;this.lastImage=image;
 const state=graph.states.find(s=>s.id===observation.stateId);if(state&&!state.representative)state.representative={observationId:observation.id,screenshot:observation.screenshot,capturedAt:observation.capturedAt};if(state&&!state.digest)state.digest=observation.digest;
 // One decode per capture: the compressed preview for the site/model and the pixel diff share it.
 const config=await this.store.config();this.lastDecoded=null;try{this.lastDecoded=decodePng(image);}catch{}
 // The compressed preview is written off the critical path; the site falls back to the PNG until it exists.
 if(this.lastDecoded){observation.preview=`evidence/${observation.id}.jpg`;const decoded=this.lastDecoded,path=observation.preview;this.previews=(this.previews??Promise.resolve()).then(()=>this.store.immutable(path,encodeJpeg(scalePng(decoded,config.captures.previewWidth),config.captures.previewQuality))).catch(()=>{});}else observation.preview=null;
 await this.store.immutable(observation.screenshot,image);await this.store.immutable(`evidence/${observation.id}.json`,observation);delete observation.xml;/* the raw hierarchy stays in the evidence file; run records are rewritten on every step */
 run.observations.push(observation);run.updatedAt=now();await this.store.saveGraph(graph);await this.store.saveRun(run);return observation;
 }
 async observe(id){const run=await this.live(id);run.metrics.agentCalls++;return this.captureRun(run);}
 budget(run){if(this.interruptRequested)return 'interrupted';if(run.steps.length>=run.limits.steps)return 'step_budget';if(Date.now()-Date.parse(run.startedAt)>=run.limits.minutes*60000)return 'time_budget';return null;}
 /** Observe, letting a learned script name the screen when the app does not declare its own id. */
 async look(){const o=await this.executor.observe();if(!o.screenKey){const hit=this.harness.apply('screen',screenInput(o));if(hit){o.screenKey=hit.value.screen;if(hit.value.state)o.stateKey=hit.value.state;if(hit.value.name)o.screenName=hit.value.name;o.identifiedBy=hit.scriptId;}}return o;}
 /** Calls since the previous drain. Executors either keep a call log (`network`) or hand over raw calls (`drainNetwork`). */
 async drain(options){try{let data={calls:[],late:[]};if(typeof this.executor?.network==='function')data=await this.executor.network(options);else if(this.executor?.drainNetwork)data={calls:(await this.executor.drainNetwork()).slice(0,200).map(raw=>{const call=normalizeCall(raw);return {id:uid(),method:call.method,host:call.host??'',path:normalizePath(call.path),status:call.status,ms:call.durationMs};}),late:[]};for(const call of [...data.calls,...data.late]){const template=this.harness.apply('path',{method:call.method,host:call.host,path:call.path});if(template)call.path=template.value;}await this.keepExchanges([...data.calls,...data.late]);await this.harness.flush();return data;}catch{return {calls:[],late:[]};}}
 /** The full exchange of a call (headers, bodies) goes to its own evidence file; the step only keeps a pointer to it. */
 async keepExchanges(calls){const config=await this.store.config().catch(()=>null),secrets=[...Object.values(config?.profiles??{}).flatMap(profile=>Object.values(profile.secrets??{})).map(env=>process.env[env]),...Object.values(await this.help.secrets().catch(()=>({})))].filter(Boolean);for(const call of calls){if(!call.detail||typeof call.detail==='string')continue;/* What the answer said that decides the next screen, kept beside the call (never the body). */call.answer=answerOf(call.detail.responseBody);if(!call.answer)delete call.answer;const path=`evidence/net-${uid()}.json`;await this.store.immutable(path,redact(JSON.stringify({...call.detail,pathTemplate:call.path},null,2),secrets));call.detail=path;}}
 /**
  * Keep the app's log lines written during each step: from the action to the next action (by the lines' own time),
  * so they stay readable after the mission ends. The previous step's file grows with lines read late. Secrets are masked.
  * Returns the current step's lines.
  */
 async keepStepLogs(run){if(!this.executor?.linesBetween)return [];const secrets=await this.secretValues(run).catch(()=>[]);let current=[];
  for(const step of run.steps.slice(-2)){if(!Number.isFinite(step.actedAt))continue;const next=run.steps[run.steps.indexOf(step)+1],from=step.actedAt-300,to=Number.isFinite(next?.actedAt)?next.actedAt-300:Date.now()+1;
   const lines=this.executor.linesBetween(from,to).slice(-400).map(l=>({at:l.at,line:redact(l.line,secrets)}));if(step===run.steps.at(-1))current=lines;if(!lines.length&&!step.log)continue;
   step.log=`evidence/log-${step.id}.json`;await this.store.save(step.log,{stepId:step.id,from,to,lines});}
  return current;}
 /** Learned `capture` scripts: what each one makes of a screen (fields, tags), saved on the state and the capture for the interface to show. */
 runCaptures(graph,observation,{calls=[],lines=[]}={}){const state=graph.states.find(s=>s.id===observation.stateId),screen=graph.screens.find(s=>s.id===observation.screenId);if(!state)return;
  const hits=this.harness.applyAll('capture',{...screenInput(observation),screen:{id:screen?.id,name:screen?.name},state:{id:state.id,name:state.name},apis:calls.map(c=>({method:c.method,path:c.path,status:c.status,...(c.answer?{answer:c.answer}:{})})),logs:lines.slice(-200).map(l=>l.line)});
  if(!hits.length)return;observation.info={};state.info??={};for(const hit of hits){const entry={...hit.value,at:now(),observationId:observation.id};state.info[hit.scriptId]=entry;observation.info[hit.scriptId]=entry;}}
 async logs({runId,step,contains,limit=40}){
  // A step of any run, from what was kept while it happened; the mission need not be running.
  if(step!==undefined){const run=await this.store.run(runId),s=run.steps[step];if(!s)throw Error(`Run has ${run.steps.length} steps (0-${run.steps.length-1})`);const kept=s.log?await this.store.json(s.log,null):null;const lines=(kept?.lines??[]).filter(l=>!contains||l.line.toLowerCase().includes(contains.toLowerCase()));
   return {step,action:s.action?.type,...(kept?{from:new Date(kept.from).toISOString(),to:new Date(kept.to).toISOString()}:{note:'No lines were kept for this step (no log source, or a run recorded before step logs existed).'}),lines:lines.slice(-limit).map(l=>`${new Date(l.at).toISOString().slice(11,23)} ${l.line.length>300?l.line.slice(0,299)+'…':l.line}`)};}
  await this.live(runId);if(!this.executor.logLines)throw Error('Log lines are not available on this platform');return {lines:await this.executor.logLines({contains,limit})};}
 /** Fill in results of calls that were still in flight when their step was saved. */
 async applyLate(run,late){if(!late.length)return;const touched=new Map();for(const step of run.steps.slice(-6))for(const call of step.network??[]){const done=late.find(l=>l.id===call.id);if(done){Object.assign(call,done);if(step.transitionId)touched.set(step.transitionId,[...(touched.get(step.transitionId)??[]),done]);}}if(!touched.size)return;const graph=await this.store.graph();for(const [edgeId,calls] of touched){const edge=graph.transitions.find(e=>e.id===edgeId);if(edge){edge.apis=mergeApis(edge.apis,calls,{count:false});recordResponses(edge,calls);}}await this.store.saveGraph(graph);}
 /** Calls seen between actions were caused by the previous action (lazy loading, redirects), or by startup. */
 async settleNetwork(run,options={quick:true}){const {calls,late}=await this.drain(options);await this.applyLate(run,late);if(calls.length)await this.placeCalls(run,calls);}
 /**
  * Put calls on the step that caused them. A call belongs to the last action taken before it started (its own time,
  * not when its log line was read), so a slow response or a log read one step late still lands on the right screen.
  * Calls with no time of their own go to the latest step, as before. `current` is the step being recorded now: its
  * calls are returned for its summary instead of being written. A rule the agent set (`apiRules`) has the last word.
  */
 async placeCalls(run,calls,{current}={}){
  const graph=await this.store.graph(),mine=[],byStep=new Map();
  for(const call of calls){let owner=ownerStep(run,call);owner=ruled(graph,run,call,owner);if(owner===undefined){run.entryNetwork=[...(run.entryNetwork??[]),call].slice(-40);continue;}if(owner===current){mine.push(call);continue;}byStep.set(owner,[...(byStep.get(owner)??[]),call]);}
  let changed=false;for(const [step,list] of byStep){step.network=[...(step.network??[]),...list].slice(-40);const edge=step.transitionId&&graph.transitions.find(e=>e.id===step.transitionId);if(edge){edge.apis=mergeApis(edge.apis,list);recordResponses(edge,list);changed=true;}}
  if(changed)await this.store.saveGraph(graph);return mine;}
 /** What an action changed: structural diff, pixel region, the calls it triggered and a deterministic summary. */
 async effects(graph,before,after,action,element,beforeImage,calls){
 const diff=observationDiff(before,after),outcome=classifyOutcome(before,after,action);
 let imageChange=null;try{imageChange=imageDiff(beforeImage??await this.store.resource(before.screenshot),this.lastDecoded??this.lastImage);}catch(e){imageChange={comparable:false,reason:e.message};}
 const fromScreen=graph.screens.find(s=>s.id===before.screenId),toScreen=graph.screens.find(s=>s.id===after.screenId),toState=graph.states.find(s=>s.id===after.stateId);
 return {calls,diff,outcome,imageChange,summary:summarizeTransition({action,element,outcome,fromScreen,toScreen,toState,diff,imageChange,network:mergeApis([],calls)})};
 }
 async step(id,input,{replay=false,verify=!replay,expectedState,soft=false}={}){
 const run=await this.live(id),reason=this.budget(run);if(reason){await this.pause(id,reason);return {status:'paused',reason};}
 const config=await this.store.config(),action=actionSchema.parse(input);if(!config.permissions.actions.includes(action.type))throw Error(`Action ${action.type} is not permitted by setup`);
 if(action.type==='deeplink'&&!config.permissions.deeplinkPrefixes.some(prefix=>action.url?.startsWith(prefix))){const declared=(await this.store.graph()).declaredDeeplinks?.[run.target]??[];if(!action.url||!declared.some(d=>action.url.startsWith(d.pattern)))throw Error('Deeplink is not permitted by setup');}
 const before=run.observations.at(-1);if(!before)throw Error('Observe before interacting');
 if(action.observationId&&action.observationId!==before.id)throw Error('Stale observation. Observe again before interacting');
 if(action.point&&!action.observationId)throw Error('Coordinate interactions require the current observationId');
 let element;if(action.elementId){const matches=before.elements.filter(e=>e.id===action.elementId||(action.elementId.length>=6&&e.id.startsWith(action.elementId)));if(matches.length!==1)throw Error(matches.length?'Element reference is ambiguous; use the full id':'Element not found in current observation');element=matches[0];action.elementId=element.id;}if(element?.disabled)throw Error('Element is disabled');
 // Resolve against fresh structure before acting, unless the observation is seconds old. A replay verifies once, then trusts the capture it just made.
 const age=Date.now()-Date.parse(before.capturedAt||0);if(verify&&action.type!=='wait'&&!(age>=0&&age<config.exploration.staleCheckMs)){const fresh=await this.look();if(structureKey(fresh)!==(before.structure??structureKey(before))&&fresh.hierarchy!=='unavailable'&&!before.scrollBase)throw Error('Screen changed since observation; observe before interacting');
 if(element){element=locate(fresh.elements,element.identity,element.label||element.name);if(!element)throw Error('Element changed; re-exploration required');}}
 if(element?.sensitive&&!action.secretRef)throw Error('Sensitive fields require a profile secretRef');
 if(action.secretRef){action.value=await this.resolveSecret(config,run,action.secretRef);}
 const persisted={...action};if(action.secretRef)delete persisted.value;
 await this.settleNetwork(run);
 const step={id:uid(),startedAt:now(),actedAt:Date.now(),action:persisted,before:before.id,status:'running',expectedState:expectedState??null};run.steps.push(step);if(replay)run.metrics.replayedSteps++;else run.metrics.agentCalls++;await this.store.saveRun(run);
 const beforeImage=this.lastDecoded??this.lastImage;
 try{await this.executor.act(action,element);const after=await this.captureRun(run,{scrolledFrom:action.type==='scroll'?before:undefined,action:persisted,element});const network=await this.drain();await this.applyLate(run,network.late);network.calls=await this.placeCalls(run,network.calls,{current:step});if(network.calls.length)step.network=network.calls.slice(0,40);const lines=await this.keepStepLogs(run);step.after=after.id;step.status=expectedState&&after.stateId!==expectedState?'diverged':'completed';step.finishedAt=now();const graph=await this.store.graph();
  const effects=await this.effects(graph,before,after,persisted,element,beforeImage,network.calls);Object.assign(step,{outcome:effects.outcome,diff:effects.diff,imageChange:effects.imageChange,summary:effects.summary});
  const edge=confirmTransition(graph,before,after,persisted,step,run,effects);step.transitionId=edge.id;this.runCaptures(graph,after,{calls:network.calls,lines});if(action.secretRef)this.help.recordUse(graph,action.secretRef,run.id);
  await this.store.saveGraph(graph);await this.syncMap(graph);if(step.status==='diverged'&&!soft){run.status='paused';run.stopReason='replay_diverged';run.metrics.recoveryRequests++;}await this.store.saveRun(run);if(run.status==='paused'){await this.executor.close().catch(()=>{});this.executor=null;this.active=null;}const apiHint=await this.networkHint(run);return {step,observation:after,previous:before,status:step.status,outcome:effects.outcome,summary:effects.summary,transitionId:edge.id,...(apiHint?{apiHint}:{})};}
 catch(e){step.status='failed';step.error=redact(e.message,action.secretRef?[action.value]:[]);step.finishedAt=now();
  if(e.recoverable){
   // The executor already restored the application; keep the mission running and show where it landed.
   let observation=null;try{observation=await this.captureRun(run);step.after=observation.id;/* What the recovery itself requested (a relaunch loads the entry screen) stays on this step, not on the next action. */const network=await this.drain();await this.applyLate(run,network.late);if(network.calls.length)step.network=network.calls.slice(0,40);}catch(inner){run.status='blocked';run.stopReason=inner.message;}
   await this.store.saveRun(run);if(run.status==='blocked'){await this.executor.close().catch(()=>{});this.executor=null;this.active=null;return {step,status:'blocked',reason:run.stopReason};}
   return {step,status:'failed',reason:step.error,recovered:true,observation};}
  run.status='blocked';run.stopReason=step.error;try{await this.captureRun(run);}catch{}run.diagnostics=await this.diagnostics(run);await this.store.saveRun(run);await this.executor.close().catch(()=>{});this.executor=null;this.active=null;return {step,status:'blocked',reason:step.error};}
 }
 /** Declared deeplinks from the platform plus the ones verified by observed deeplink steps. */
 async deeplinks({target,runId}={}){const config=await this.store.config(),graph=await this.store.graph();let targetId=target;if(!targetId&&runId)targetId=(await this.store.run(runId)).target;if(!targetId)targetId=Object.keys(config.targets)[0];const definition=config.targets[targetId];if(!definition)throw Error('Unknown target');
  const executor=this.active&&this.executor&&(await this.store.run(this.active)).target===targetId?this.executor:this.factory(definition);const links=await executor.deeplinks?.(),platform=Array.isArray(links)?{source:'platform',declared:links}:links??{source:'unavailable',declared:[]};
  const observedLinks=definition.platform==='web'?[...new Set(graph.screens.filter(s=>s.target===targetId).flatMap(s=>s.links??[]))]:[];
  return {target:targetId,platform:definition.platform,permittedPrefixes:config.permissions.deeplinkPrefixes,declared:platform.declared,declaredSource:platform.source,note:platform.note??platform.error,observedLinks,verified:(graph.deeplinks??[]).filter(d=>d.target===targetId)};}
 /** Interact with one candidate, classify the effect and optionally return to the origin state. */
 async probe(id,{candidateKey,elementId,returnPolicy='back'}={}){
 const run=await this.live(id);const before=run.observations.at(-1);let candidate=null;
 if(candidateKey){candidate=run.frontier.find(f=>f.key===candidateKey);if(!candidate)throw Error('Unknown frontier candidate');if(candidate.stateId!==before.stateId)throw Error('Candidate belongs to another state; navigate there first (route/replay) or explore from the current state');const element=locate(before.elements,candidate.elementIdentity,candidate.label);if(!element)throw Error('Candidate element is not present in the current observation');elementId=element.id;}
 if(!elementId)throw Error('Provide candidateKey or elementId');const element=before.elements.find(e=>e.id===elementId);if(!element)throw Error('Element not found in current observation');
 if(!element.actions?.includes('click'))throw Error('Probe only performs click interactions; use step for fill/scroll');
 run.metrics.probes=(run.metrics.probes??0)+1;await this.store.saveRun(run);
 const result=await this.step(id,{type:'click',elementId,observationId:before.id});
 if(result.status!=='completed')return {...result,candidate:candidate?.key??null,returned:false};
 const graph=await this.store.graph();const transition=graph.transitions.find(t=>t.id===result.transitionId);
 let returned=null,backObservation=null,backTransitionId=null,returnSkipped=null;
 // Going back from a screen that was already visited before the origin (closing a dialog, "home" shortcuts) can leave the app; only new or deeper screens are backed out of.
 const originIndex=run.observations.findLastIndex(o=>o.stateId===before.stateId);const ancestor=run.observations.slice(0,Math.max(0,originIndex)).some(o=>o.screenId===result.observation.screenId);
 if(result.outcome==='navigation'&&returnPolicy==='back'&&ancestor)returnSkipped='ancestor_screen';
 else if(result.outcome==='navigation'&&returnPolicy==='back'&&this.executor?.canGoBack&&!(await this.executor.canGoBack().catch(()=>true)))returnSkipped='no_history';
 if(result.outcome==='navigation'&&returnPolicy==='back'&&!returnSkipped){const config=await this.store.config();if(config.permissions.actions.includes('back')){const back=await this.step(id,{type:'back'});if(back.status==='completed'){backObservation=back.observation;backTransitionId=back.transitionId;returned=back.observation.stateId===before.stateId;}else if(back.recovered){returned=false;returnSkipped='back_left_app';backObservation=back.observation;}else return {...result,candidate:candidate?.key??null,transition,returned:false,back};}}
 return {status:'completed',candidate:candidate?.key??null,outcome:result.outcome,summary:result.summary,transition,observation:result.observation,returned,returnSkipped,backObservation,backTransitionId};
 }
 /** Deterministic walk of pending candidates: stable order, bounded, each click recorded as evidence. */
 async explore(id,{maxCandidates=10,returnPolicy='back',avoid,onlyCurrentState=false,settleMs=500}={}){
 const config=await this.store.config();const patterns=(avoid??config.exploration.avoid).map(p=>new RegExp(p,'i'));const results=[];let stopReason=null;
 const order=(a,b)=>((a.bounds?.y??0)-(b.bounds?.y??0))||((a.bounds?.x??0)-(b.bounds?.x??0))||a.elementIdentity.localeCompare(b.elementIdentity);
 const eligible=f=>f.status==='pending'&&f.actions.includes('click')&&!f.sensitive;let lastBackFrom=null,divergences=0,lastDiverged=null;
 while(results.length<maxCandidates){
  let run;try{run=await this.live(id);}catch(e){stopReason=e.message;break;}
  const reason=this.budget(run);if(reason){stopReason=reason;break;}
  for(const f of run.frontier)if(eligible(f)&&patterns.some(p=>p.test(f.label||''))){f.status='skipped';f.skipReason='avoid_pattern';}
  await this.store.saveRun(run);
  const current=run.observations.at(-1);let candidate=run.frontier.filter(f=>eligible(f)&&f.stateId===current.stateId).sort(order)[0];
  if(!candidate){
   // Nothing left here: the application may have moved on by itself (loading finished, redirect). Record that before planning a route.
   let fresh=null;for(let attempt=0;attempt<4;attempt++){fresh=await this.executor.observe().catch(()=>null);if(!fresh||structureKey(fresh)!==(current.structure??structureKey(current)))break;await new Promise(r=>setTimeout(r,attempt===3?0:settleMs));}
   if(fresh&&structureKey(fresh)!==(current.structure??structureKey(current))){const automatic=config.permissions.actions.includes('wait')?await this.step(id,{type:'wait',durationMs:0}):await this.observe(id);results.push({candidate:null,label:'(automático)',status:automatic.status??'completed',outcome:automatic.outcome??null,summary:automatic.summary??null,transitionId:automatic.transitionId??null,toScreenId:(automatic.observation??automatic).screenId??null,toStateId:(automatic.observation??automatic).stateId??null,returned:null});if(automatic.status&&automatic.status!=='completed'){stopReason=automatic.reason??automatic.status;break;}continue;}
   if(onlyCurrentState){stopReason='state_exhausted';break;}
   const graph=await this.store.graph();const elsewhere=run.frontier.filter(eligible);if(!elsewhere.length){stopReason='frontier_exhausted';break;}
   // Nearest frontier first: one shortest-path search to every state that still has pending candidates, and the
   // cheapest one wins (not the first in screen order, which could cross the whole app while a candidate waits one tap away).
   let route=null,chosen=null;{const goals=new Set(elsewhere.map(f=>f.stateId)),plan=planRoute(graph,{from:current.stateId,to:goals,target:run.target,profile:run.profile,environment:envOf(run),preconditions:run.preconditions,version:run.version});if(plan.found){route=plan;chosen=elsewhere.filter(f=>f.stateId===plan.to).sort(order)[0];}}
   if(!chosen){
    // Dead end: try one back (recoverable on Android even when it leaves the app) before giving up.
    if(config.permissions.actions.includes('back')&&lastBackFrom!==current.stateId){lastBackFrom=current.stateId;const back=await this.step(id,{type:'back'});if(back.status==='completed'||back.recovered){results.push({candidate:null,label:'(voltar)',status:back.status,outcome:back.outcome??null,summary:back.summary??back.reason??null,transitionId:back.transitionId??null,toScreenId:back.observation?.screenId??null,toStateId:back.observation?.stateId??null,returned:null});continue;}}
    // A candidate whose only known route no longer leads there is reported as unreachable, not silently dropped.
    if(lastDiverged){stopReason='route_recovery_required';results.push({candidate:lastDiverged.chosen.key,label:lastDiverged.chosen.label,status:'unreachable',replay:lastDiverged.moved});break;}
    stopReason='no_reachable_candidates';break;}
   // Preparation replays are not tests: a divergence is new evidence and exploration continues from where the app landed.
   const moved=await this.replay(id,route.steps,{purpose:'preparation',strict:false,anyVersion:false});
   if(moved.status==='diverged'){lastDiverged={chosen,moved};if(++divergences>3){stopReason='route_recovery_required';results.push({candidate:chosen.key,label:chosen.label,status:'unreachable',replay:moved});break;}continue;}
   if(moved.status!=='completed'){stopReason='route_recovery_required';results.push({candidate:chosen.key,label:chosen.label,status:'unreachable',replay:moved});break;}
   divergences=0;lastDiverged=null;continue;}
  const before=run.observations.at(-1);if(!locate(before.elements,candidate.elementIdentity,candidate.label)){candidate.status='missing';await this.store.saveRun(run);continue;}
  let probe;try{probe=await this.probe(id,{candidateKey:candidate.key,returnPolicy});}
  catch(e){if(/Screen changed since observation/.test(e.message)){
    // The application moved on its own (loading finished, redirect). Record it as an automatic transition and continue.
    const automatic=config.permissions.actions.includes('wait')?await this.step(id,{type:'wait',durationMs:0}):await this.observe(id);results.push({candidate:null,label:'(automático)',status:automatic.status??'completed',outcome:automatic.outcome??null,summary:automatic.summary??null,transitionId:automatic.transitionId??null,toScreenId:(automatic.observation??automatic).screenId??null,toStateId:(automatic.observation??automatic).stateId??null,returned:null});if(automatic.status&&automatic.status!=='completed'){stopReason=automatic.reason??automatic.status;break;}continue;}
   results.push({candidate:candidate.key,label:candidate.label,status:'error',outcome:null,summary:e.message,transitionId:null,toScreenId:null,toStateId:null,returned:null});stopReason='error';break;}
  const entry={candidate:candidate.key,label:candidate.label,status:probe.status,outcome:probe.outcome??null,summary:probe.summary??probe.reason??null,transitionId:probe.transition?.id??null,toScreenId:probe.observation?.screenId??null,toStateId:probe.observation?.stateId??null,returned:probe.returned??null};results.push(entry);
  if(probe.status!=='completed'){stopReason=probe.status==='paused'?probe.reason:'blocked';break;}
 }
 const run=await this.store.run(id);const pending=run.frontier.filter(eligible).length;const help=run.observations.at(-1)?.help??{needs:[],hints:[]};
 const apiHint=(await this.store.run(id).catch(()=>null))?.networkHint;return {help,explored:results.filter(r=>r.status==='completed').length,results,stopReason:stopReason??'max_candidates',pending,scope:'discovered_click_candidates',...(apiHint?{apiHint}:{})};
 }
 async pauseMission(id,reason='interrupted'){const run=await this.store.run(id);if(run.status==='running'){run.status='paused';run.stopReason=reason;if(this.active===id){run.diagnostics=await this.diagnostics(run);await this.executor?.close().catch(()=>{});this.active=null;this.executor=null;}await this.store.saveRun(run);}return run;}
 async disconnect(owner){if(this.active){const run=await this.store.run(this.active);if(run.owner===owner)await this.pause(run.id,'agent_disconnected');}}
 async resume(id,owner){if(this.active)throw Error('Pause the active mission first');const run=await this.store.run(id),config=await this.store.config();if(!['paused','blocked'].includes(run.status))throw Error('Only paused or blocked missions may resume');if(hash(config)!==run.configHash)throw Error('Configuration changed; start a new mission');this.executor=this.factory(targetIn(config,run.target,run.environment??'default'));try{await this.executor.start();const version=await this.version(config,targetIn(config,run.target,run.environment??'default'),this.executor);if(version.fingerprint!==run.version?.fingerprint)throw Error('Application version changed; start a new mission');if(owner&&owner!=='interface')run.owner=owner;run.status='running';run.stopReason=null;this.interruptRequested=false;await this.openDraft(run,config);this.active=id;const expected=run.observations.at(-1)?.stateId;const observed=await this.captureRun(run);run.resume={expectedState:expected,currentState:observed.stateId,recoveryRequired:expected!==observed.stateId};await this.store.saveRun(run);return run;}catch(e){await this.executor.close().catch(()=>{});this.active=null;this.executor=null;throw e;}}
 async route(input){const run=await this.store.run(input.runId),graph=await this.store.graph();if(input.scenarioRunId){const scenario=await this.store.run(input.scenarioRunId),steps=scenario.steps.slice(input.startStep??0,input.endStep===undefined?undefined:input.endStep+1);if(!steps.length||steps.some(s=>s.status!=='completed'||!s.transitionId))return {found:false,steps:[],reason:'Scenario segment contains incomplete or unconfirmed steps'};const edges=steps.map(s=>graph.transitions.find(e=>e.id===s.transitionId));if(edges.some(e=>!e||e.target!==run.target||e.profile!==run.profile||envOf(e)!==envOf(run)||hash(e.preconditions)!==hash(run.preconditions)||e.version?.fingerprint!==run.version?.fingerprint))return {found:false,steps:[],reason:'Scenario platform, profile, environment, preconditions or version is incompatible'};if(edges[0].from!==(input.from??run.observations.at(-1)?.stateId))return {found:false,steps:[],reason:'Prepare the scenario entry before replaying the test segment',requiredEntry:edges[0].from};for(let i=1;i<edges.length;i++)if(edges[i-1].to!==edges[i].from)return {found:false,steps:[],reason:'Scenario contains a context gap; reconstruct that section explicitly'};return {found:true,steps:edges.map(e=>e.id),cost:edges.length,scenarioRunId:scenario.id,scope:'exact_scenario_segment'};}if(!input.to)throw Error('Provide a destination or a recorded scenario');return planRoute(graph,{...input,from:input.from??run.observations.at(-1)?.stateId,target:run.target,profile:run.profile,environment:envOf(run),preconditions:run.preconditions,version:run.version});}
 /** `strict:false` (or `soft`) keeps the mission running when the application lands elsewhere: the divergence is recorded as new evidence. */
 async replay(id,transitionIds,{purpose='test',strict=true,soft=!strict,anyVersion=false}={}){if(!transitionIds.length||transitionIds.length>100)throw Error('Choose 1–100 transitions');const results=[];for(const [index,edgeId] of transitionIds.entries()){const run=await this.live(id),graph=await this.store.graph(),edge=graph.transitions.find(e=>e.id===edgeId);if(!edge?.confirmed||edge.target!==run.target||edge.profile!==run.profile||envOf(edge)!==envOf(run)||hash(edge.preconditions)!==hash(run.preconditions))throw Error('Incompatible transition');if(!anyVersion&&edge.version?.fingerprint!==run.version.fingerprint)throw Error('Version changed: explicitly re-explore this section');const observation=run.observations.at(-1),shortcut=edge.action.type==='deeplink'&&purpose==='preparation';if(observation.stateId!==edge.from&&!shortcut)return {status:'recovery_required',reason:'Unexpected source state',at:edgeId,results};const action={...edge.action,observationId:observation.id};const elementIdentity=action.elementIdentity;delete action.elementIdentity;if(elementIdentity){const element=locate(observation.elements,elementIdentity,edge.name);if(!element)return {status:'recovery_required',reason:'Locator missing',at:edgeId,results};action.elementId=element.id;}if(action.type==='deeplink'&&purpose!=='preparation')throw Error('Deeplink shortcuts are only permitted during preparation');const result=await this.step(id,action,{replay:true,verify:index===0,expectedState:edge.to,soft});results.push(result);if(result.status!=='completed')return {status:soft&&result.status==='diverged'?'diverged':'recovery_required',reason:result.reason??(result.status==='diverged'?'The application reached a different state than the recorded one':undefined),at:edgeId,results};}return {status:'completed',results};}
 /** Take one transition of the decision graph from wherever the mission is now. */
 async follow(id,edge,options={}){const run=await this.store.run(id),observation=run.observations.at(-1),action={...edge.action,observationId:observation.id},wanted=action.elementIdentity;delete action.elementIdentity;
  if(wanted){const element=locate(observation.elements,wanted,edge.name);if(!element)throw Error('Locator missing');action.elementId=element.id;}
  return this.step(id,action,{replay:true,soft:true,...options});}
 /** What was typed during the visit to the screen that ended with this action, when it was recorded: the form's fields, in order, last value of each. */
 async fillsBefore(graph,edge){for(const proof of (edge.evidence??[]).filter(e=>!e.diverged).reverse().slice(0,3)){const run=await this.store.run(proof.runId).catch(()=>null),index=run?.steps.findIndex(s=>s.id===proof.stepId)??-1;if(index<0)continue;
   const screenOf=new Map(run.observations.map(o=>[o.id,o.screenId])),screen=screenOf.get(run.steps[index].before),fills=new Map();
   for(let i=index-1;i>=0;i--){const step=run.steps[i],made=graph.transitions.find(t=>t.id===step.transitionId);if(screenOf.get(step.before)!==screen||screenOf.get(step.after)!==screen)break;if(step.action.type==='fill'&&step.status==='completed'&&made?.action.elementIdentity&&!fills.has(made.action.elementIdentity))fills.set(made.action.elementIdentity,made);}
   return [...fills.values()].reverse();}return [];}
 /** Back at the entry screen, keeping the mission. */
 async restart(run){if(this.executor.restart)await this.executor.restart();else{const config=await this.store.config();await this.executor.close().catch(()=>{});this.executor=this.factory(targetIn(config,run.target,run.environment??'default'));await this.executor.start();}
  // A cold start takes a moment to draw: wait until there is something on screen, so a blank frame is never taken for the entry screen.
  for(let i=0;i<12;i++){const seen=await this.look().catch(()=>null);if(seen?.elements?.length)break;await new Promise(r=>setTimeout(r,600));}
  const entry=await this.captureRun(run),graph=await this.store.graph();graph.entries??={};if(graph.entries[entryKey(run)]!==entry.stateId){graph.entries[entryKey(run)]=entry.stateId;await this.store.saveGraph(graph);}return entry;}
 /**
  * Reach a known screen without reasoning. The decision graph of the destination says, for every state seen so far, which
  * action comes next; this loop observes, looks the action up and acts until it arrives. Because it decides again after
  * every step, it works from wherever the app is: a state whose content changed, a detour, a deeplink that needed a session.
  * Unknown ground is left with back, then one restart. It starts its own mission when none is active, and what happened
  * is kept per screen so a person can see how dependable each direct route is.
  */
 async goto({runId,target,profile='default',environment,screen,state,plan:dry=false,mode='walk'},owner='interface'){if(!screen&&!state)throw Error('Provide a screen or a state');
  const config=await this.store.config();let graph=await this.store.graph(),run=runId?await this.live(runId):this.active?await this.live(this.active):null,goals,wanted;
  if(state){const goal=resolveState(graph,state);goals=new Set([goal.id]);wanted=graph.screens.find(s=>s.id===goal.screenId);}
  else{wanted=resolveScreen(graph,screen,run?.target??target);goals=new Set(graph.states.filter(s=>s.screenId===wanted.id).map(s=>s.id));}
  const scope=run??{target:target??wanted.target,profile,environment:environment??defaultEnvironment(config),envKey:envKey(config,environment),preconditions:{},version:null};
  let ownMission=false;const build=(known,avoid)=>decisionGraph(known,{entries:[known.entries?.[entryKey(scope)],ownMission?null:run?.observations[0]?.stateId].filter(Boolean),goals,target:scope.target,profile:scope.profile,environment:envOf(scope),preconditions:scope.preconditions,version:scope.version,allowDeeplinks:config.permissions.actions.includes('deeplink'),avoid});
  if(dry)return {status:'planned',screen:wanted.name,...describeDecisions(graph,build(graph,new Set())),learned:graph.routes?.[wanted.id]??null};
  let started=false;if(!run){run=await this.start({target:scope.target,profile,environment:scope.environment,mode,objective:`Ir para ${wanted.name}`},owner);if(run.status!=='running')return {status:'blocked',steps:0,reason:run.stopReason,runId:run.id};started=true;ownMission=true;
   // Launching may only bring forward an app left in the middle of something. A walk of its own begins at the real entry screen, which is also what tells needed writes (signing in) from accidental ones.
   const first=run.observations.at(-1);if(graph.entries?.[entryKey(run)]!==first.stateId){if(this.executor.restart)await this.restart(run);else{graph=await this.store.graph();graph.entries??={};graph.entries[entryKey(run)]=first.stateId;await this.store.saveGraph(graph);}run=await this.store.run(run.id);}}
  const id=run.id,began=Date.now(),origin=run.observations.at(-1);if(goals.has(origin.stateId))return {status:'already_there',steps:0,runId:id,started,observation:origin};
  const results=[],avoid=new Set(),tried=new Map(),walked=new Map(),filled=new Set(),allowBack=config.permissions.actions.includes('back'),limit=Math.min(80,run.limits.steps);
  let backs=0,blanks=0,restarted=false,recoveries=0,errors=0,status='stuck',reason='Step limit of one goto reached';const surprises=[];
  while(results.length+recoveries<limit){
   run=await this.store.run(id);if(run.status!=='running'||this.active!==id){status=run.status==='running'?'stuck':run.status;reason=run.stopReason;break;}
   const here=run.observations.at(-1);graph=await this.store.graph();const decisions=build(graph,avoid),choice=decisions.decide(here);
   if(choice?.kind==='arrived'){status='arrived';break;}
   // When starting over at the entry screen is clearly shorter than the way from here (which may run through purchases and the like), start over.
   const fromEntry=decisions.left.get(graph.entries?.[entryKey(run)]);if(choice&&!restarted&&fromEntry!==undefined&&choice.left>fromEntry+2){restarted=true;recoveries++;try{await this.restart(run);}catch(e){reason=e.message;break;}continue;}
   if(!choice&&!here.elements.length&&blanks<4){blanks++;await new Promise(r=>setTimeout(r,700));await this.captureRun(run);continue;}
   if(!choice){
    // Unknown ground. A mission that has just opened the app is already at the entry screen: going back or restarting would change nothing.
    const moved=results.length||recoveries||!started;
    if(moved&&allowBack&&backs<2&&(!this.executor.canGoBack||await this.executor.canGoBack().catch(()=>true))){backs++;recoveries++;const back=await this.step(id,{type:'back'},{replay:true,soft:true});if(['blocked','paused'].includes(back.status)){status=back.status;reason=back.reason;break;}continue;}
    if(moved&&!restarted){restarted=true;recoveries++;try{await this.restart(run);}catch(e){reason=e.message;break;}continue;}
    reason='No known action leads from this screen to the destination';break;}
   const edge=choice.edge,key=here.stateId+edge.id,count=(tried.get(key)??0)+1;tried.set(key,count);if(count>2){avoid.add(edge.id);continue;}
   try{
    if(edge.action.type==='click'&&!filled.has(here.screenId+edge.id)){filled.add(here.screenId+edge.id);for(const fill of await this.fillsBefore(graph,edge)){const typed=await this.follow(id,fill,{verify:false}).catch(()=>null);if(typed)results.push(typed);}}
    const result=await this.follow(id,edge,{verify:!results.length,expectedState:['screen','global'].includes(choice.kind)?undefined:edge.to});results.push(result);
    // Landing on the expected screen sooner or later than its loading frame is the same way, not a miss.
    const expectedState=graph.states.find(x=>x.id===edge.to),landedState=result.observation&&graph.states.find(x=>x.id===result.observation.stateId),onTime=result.status==='diverged'&&result.observation?.screenId===expectedState?.screenId&&(expectedState?.semantic?.includes('loading')||landedState?.semantic?.includes('loading')||result.observation?.semantic?.includes('loading'));
    // What did not go as the graph said: kept so that, if the walk gives up, the agent is told exactly where and how.
    const landed=result.observation;if(landed&&landed.stateId!==edge.to&&!onTime){const expectedScreen=graph.states.find(x=>x.id===edge.to)?.screenId;surprises.push({at:here.screenId,action:edge.name,expected:expectedScreen,expectedState:edge.to,got:landed.screenId,gotState:landed.stateId,recognition:landed.recognition?.how??null});}
    // The app answered with an error on the way: that is not a detour to walk around. Stop and hand it to the agent.
    if(landed&&!goals.has(landed.stateId)&&landed.semantic?.includes('error')&&!graph.states.find(x=>x.id===edge.to)?.semantic?.includes('error')){status='stuck';reason='The app showed an error on the way';break;}
    if(!['screen','global'].includes(choice.kind)){const tally=walked.get(edge.id)??{walks:0,misses:0};tally.walks++;if(result.status!=='completed'&&!onTime)tally.misses++;walked.set(edge.id,tally);}
    if(['blocked','paused'].includes(result.status)){status=result.status;reason=result.reason;break;}
    // A link that lands elsewhere, or a control that changes nothing, is not asked again in this walk.
    if((result.status==='diverged'&&choice.kind==='deeplink')||(result.observation?.stateId===here.stateId&&edge.action.type!=='wait'))avoid.add(edge.id);
   }catch(e){reason=e.message;if(++errors>4)break;if(!/Screen changed|Stale observation/.test(e.message))avoid.add(edge.id);try{await this.captureRun(await this.live(id));}catch{}}
  }
  // Loading states settle through recorded waits; follow them so the caller lands on the usable state.
  if(status==='arrived')for(let i=0;i<3;i++){const here=(await this.store.run(id)).observations.at(-1),settle=graph.transitions.find(e=>e.from===here.stateId&&e.confirmed&&e.action.type==='wait'&&e.to!==here.stateId&&goals.has(e.to)&&e.target===run.target&&e.profile===run.profile);if(!settle)break;const settled=await this.follow(id,settle,{verify:false,expectedState:settle.to}).catch(()=>null);if(settled?.status!=='completed')break;results.push(settled);}
  const final=await this.store.run(id),observation=final.observations.at(-1),ms=Date.now()-began;graph=await this.store.graph();graph.routes??={};
  for(const [edgeId,tally] of walked){const edge=graph.transitions.find(e=>e.id===edgeId);if(edge){edge.walks=(edge.walks??0)+tally.walks;edge.misses=(edge.misses??0)+tally.misses;}}
  const memo=graph.routes[wanted.id]??={runs:0,arrived:0};memo.runs++;if(status==='arrived'){memo.arrived++;memo.bestSteps=Math.min(memo.bestSteps??Infinity,results.length);delete memo.stuckAt;delete memo.stuckReason;}else Object.assign(memo,{stuckAt:observation.screenId,stuckReason:reason});
  Object.assign(memo,{lastAt:now(),lastStatus:status,lastSteps:results.length,lastMs:ms,lastRecoveries:recoveries,lastFrom:origin.screenId});await this.store.saveGraph(graph);
  return {status,steps:results.length,ms,recoveries,runId:id,started,...(status==='arrived'?{}:{reason,diagnosis:diagnose(graph,observation,wanted,surprises,run,status,reason),hint:'Only now is your judgement needed. Read diagnosis: map the new case with step (it joins the decision graph, so the next goto goes further on its own). If you cannot tell which scenario or flow the person means here, ask with navloom_ask kind=decision.'}),runStatus:final.status,results,observation};}
 /** Missions that stopped without passing through pause or finish (blocked, service restarted) are settled the next time anyone looks. */
 async settleAll(){for(const run of await this.store.runs())if(run.review?.status==='open'&&run.id!==this.active)await this.settleReview(run.id);}
 /** Once per mission: no API call was recognised after a few actions, yet the app process logs lines that look like requests.
  * The agent is told so it can read them (navloom_logs) and teach the format with a logcat script, instead of mapping blind. */
 async networkHint(run){
  if(run.networkHint!==undefined||run.steps.length<4||run.steps.some(s=>s.network?.length)||!this.executor?.logLines)return null;
  const lines=await this.executor.logLines({limit:300}).catch(()=>[]);
  const request=/\b(GET|POST|PUT|PATCH|DELETE)\b|https?:\/\/|\/(api|v\d+)\//i;
  const samples=lines.filter(l=>request.test(l));
  run.networkHint=samples.length?{recognisedCalls:0,requestLikeLines:samples.length,samples:samples.slice(-3),next:'No API call was recognised, but the app logs lines that look like requests. Read them with navloom_logs and teach the format with navloom_harness_propose kind "logcat" (samples from real lines); propose it now, in this mission: proposing needs no permission, it only runs after a person approves it in the interface, and from then on every call is attributed to the action that made it.'}:null;
  await this.store.saveRun(run);return run.networkHint;
 }
 async finish(id){const run=await this.finishMission(id);return await this.settleReview(run.id)??run;}
 async pause(id,reason){const run=await this.pauseMission(id,reason);return await this.settleReview(run.id)??run;}
 /**
  * A mission never writes the recorded map directly when review is required (and never in `walk`): it works on a draft
  * that starts as a copy of the recorded map. The copy taken at the start stays beside it as the baseline to compare with.
  */
 async openDraft(run,config){let drafting=run.mode==='walk'||config.review==='required';
  // A mission resumed keeps the draft it already has, even if the review setting changed meanwhile: its work is never overwritten.
  const existing=['pending','open'].includes(run.review?.status)&&await this.store.json(`drafts/${run.id}.base.json`,null)&&(await this.store.json(`drafts/${run.id}.json`,null)?'draft':'base');if(existing)drafting=existing==='draft';const resumed=!!existing;
  if(!resumed){const recorded=await this.store.recorded();await this.store.save(`drafts/${run.id}.base.json`,recorded);if(drafting)await this.store.save(`drafts/${run.id}.json`,recorded);}
  run.review={status:'open',drafting,mode:run.mode};delete run.changes;this.draftRun=drafting?run.id:null;}
 /** A draft is never deleted: it moves to `drafts/archive/`, so a mission discarded by mistake (or by an error) can come back. */
 async dropDraft(id){const {mkdir,rename,readdir,stat}=await import('node:fs/promises'),dir=join(this.store.dir,'drafts'),archive=join(dir,'archive');await mkdir(archive,{recursive:true});
  for(const name of [`${id}.json`,`${id}.base.json`]){try{await rename(join(dir,name),join(archive,name));}catch{}}
  // The archive keeps the latest 60 missions.
  try{const files=await Promise.all((await readdir(archive)).map(async name=>({name,time:(await stat(join(archive,name))).mtimeMs})));files.sort((a,b)=>b.time-a.time);for(const f of files.slice(120))await rm(join(archive,f.name),{force:true});}catch{}}
 /** Bring an archived draft back for a decision (a person's action, from the interface). */
 async restoreDraft(id){const {rename}=await import('node:fs/promises'),dir=join(this.store.dir,'drafts');let restored=0;for(const name of [`${id}.json`,`${id}.base.json`]){try{await rename(join(dir,'archive',name),join(dir,name));restored++;}catch{}}return restored;}
 /** Once a mission stops, say what it did against the recorded map and leave it waiting for a decision (or clean up when there is nothing to decide). */
 async settleReview(id){const run=await this.store.run(id).catch(()=>null);if(!run?.review||run.review.status!=='open'||this.active===id)return run;
  let base=await this.store.json(`drafts/${id}.base.json`,null);const recorded=await this.store.recorded(),draft=run.review.drafting?await this.store.json(`drafts/${id}.json`,null):recorded;
  // The copy taken at the start is gone (an error, a cleanup): what the mission found is still compared, with the recorded map as the base.
  if(!base&&draft&&run.review.drafting){base=recorded;run.review.baseMissing=true;await this.store.save(`drafts/${id}.base.json`,recorded);}
  if(!base||!draft){run.review.status='none';run.review.reason=draft?'base_missing':'draft_missing';await this.store.saveRun(run);return run;}
  if(run.mode==='walk'){
   // A walk records nothing, unless it went where the map had never been (a goto that got stuck and was continued by hand): that is kept for a person to decide, never dropped.
   const changes=reviewChanges(base,draft,run),found=changes.items.filter(i=>i.type==='new');
   if(found.length){run.changes={...changes,items:found,counts:{new:found.length,different:0,variant:0}};run.review.status='pending';run.review.kept='walk_found_new';await this.store.saveRun(run);return run;}
   await this.store.saveRecorded(carryOver(base,draft,recorded));await this.dropDraft(id);run.review.status='walk';await this.store.saveRun(run);return run;}
  run.changes=reviewChanges(base,draft,run);
  if(!run.review.drafting){run.review.status='auto';await this.dropDraft(id);}
  // Nothing a person needs to look at: the fresh captures of known screens are simply kept.
  else if(!run.changes.items.length){const merged=mergeDraft(base,draft,recorded);await this.store.saveRecorded(merged);await this.syncMap(merged);await this.dropDraft(id);run.review.status='unchanged';}
  else run.review.status='pending';
  await this.store.saveRun(run);return run;}
 /** The draft of a mission waiting for a decision, for the interface to draw. */
 async review({runId}){const run=await this.settleReview(runId);if(!run)throw Error('Run not found');const graph=run.review?.status==='pending'?await this.store.json(`drafts/${runId}.json`,null):null;return {runId,review:run.review??null,changes:run.changes??null,graph:graph&&{...emptyGraph(),...graph}};}
 /** Only a person decides: approve writes what the mission found into the recorded map, discard throws it away. */
 async decideReview({runId,decision}){
  if(decision==='restore'){const run=await this.store.run(runId);if(!['discarded','walk','none'].includes(run?.review?.status))throw Error('Only a discarded mission, a walk or one that lost its comparison can be brought back');if(!(await this.restoreDraft(runId)))throw Error('This mission has no archived draft');run.review={...run.review,status:'open',restoredAt:now()};await this.store.saveRun(run);const settled=await this.settleReview(runId);if(settled.review.status==='walk'||settled.review.status==='unchanged'){/* nothing new in it after all */}return settled;}
  const run=await this.settleReview(runId);if(run?.review?.status!=='pending')throw Error('This mission has nothing waiting for approval');
  const base=await this.store.json(`drafts/${runId}.base.json`,null),draft=await this.store.json(`drafts/${runId}.json`,null),recorded=await this.store.recorded();if(!base||!draft)throw Error('The draft of this mission is no longer available');
  if(decision==='approve'){const merged=mergeDraft(base,draft,recorded,run.changes);await this.store.saveRecorded(merged);if(!this.store.draftId())await this.syncMap(merged);}else await this.store.saveRecorded(carryOver(base,draft,recorded));
  await this.dropDraft(runId);run.review={...run.review,status:decision==='approve'?'approved':'discarded',decidedAt:now()};await this.store.saveRun(run);return run;}
 /** One screen in a few lines, built from what is already recorded: no device access and no agent reasoning needed. */
 async screenContext({screen:ref,state:stateRef}){const graph=await this.store.graph(),config=await this.store.config(),screen=shownScreen(graph,ref,stateRef),target=config.targets[screen.target],states=graph.states.filter(s=>s.screenId===screen.id),/* The state asked for (a link to one state, or `state`); without one, the latest state the screen got. */state=stateRef?resolveState(graph,stateRef,screen.id):states.at(-1);let observation;try{observation=state&&JSON.parse((await this.store.resource(`evidence/${state.lastSeen}.json`)).toString());}catch{}
  return screenContext(graph,screen,{observation,appId:target?.package??target?.url,platform:target?.platform,stateLabel:state?.name,stateLabels:[...new Set(states.map(s=>s.name))],entry:entryPoints(graph,{target:screen.target}).screens[screen.id]});}
 /** Name screens and group flows in a single call. */
 async organize({screens=[],flows=[],apis=[]}){const updated=[],owners=[];for(const rule of apis)owners.push(await this.apiOwner(rule));for(const item of screens){const graph=await this.store.graph(),screen=resolveScreen(graph,item.id);await this.annotate({screenId:screen.id,name:item.name,description:item.description??screen.description??''});updated.push(screen.id);}const grouped=[];for(const flow of flows)grouped.push(await this.groupFlow(flow));return {screens:updated.length,flows:grouped.map(f=>({id:f.id,screens:f.screenIds.length})),...(owners.length?{apis:owners}:{})};}
 async reset(id){const run=await this.live(id),config=await this.store.config();const reset=targetIn(config,run.target,run.environment??'default').reset??config.reset;if(!reset||!config.permissions.actions.includes('reset'))throw Error('Reset is not configured or permitted');const cwd=await safePath(this.store.root,reset.cwd);const output=await command(reset.executable,reset.args,{cwd,timeout:reset.timeoutMs});run.resets??=[];run.resets.push({time:now(),output:output.slice(0,4000)});await this.executor.close();this.executor=this.factory(targetIn(config,run.target,run.environment??'default'));await this.executor.start();return this.captureRun(run);}
 async diagnostics(run){const data=await this.executor?.diagnostics()??{availability:'unavailable',logs:[]};const secrets=await this.secretValues(run);return JSON.parse(redact(JSON.stringify(data),secrets));}
 async finishMission(id){const run=await this.live(id);await this.settleNetwork(run,{quick:false});const observation=await this.captureRun(run);run.diagnostics=await this.diagnostics(run);run.checks=run.assertions.map(assertion=>{let passed;if(assertion.type==='state')passed=assertion.value.length>=6&&observation.stateId.startsWith(assertion.value);if(assertion.type==='text')passed=observation.text.includes(assertion.value);if(assertion.type==='no_errors')passed=run.diagnostics.availability==='available'?!run.diagnostics.logs.some(l=>l.level==='error'):undefined;return {assertion,result:passed===undefined?'not_verified':passed?'passed':'failed',evidence:observation.id};});run.status='completed';run.finishedAt=now();run.result=!run.checks.length?'not_verified':run.checks.some(c=>c.result==='failed')?'failed':run.checks.some(c=>c.result==='not_verified')?'not_verified':'passed';run.coverage={visited:run.frontier.filter(f=>f.status==='visited').length,pending:run.frontier.filter(f=>f.status==='pending').length,skipped:run.frontier.filter(f=>f.status==='skipped').length,scope:'discovered_interactions'};await this.store.saveRun(run);await this.syncMap(await this.store.graph());await this.executor.close();this.active=null;this.executor=null;return run;}
 async annotate({screenId,description,name,sources,evidence=[]}){const graph=await this.store.graph(),screen=resolveScreen(graph,screenId);screenId=screen.id;for(const ref of evidence)await this.store.resource(`evidence/${ref}.json`);const revision={id:uid(),kind:'screen',screenId,description,name,...(sources?{sources}:{}),evidence,time:now(),interpretation:true};graph.descriptions.push(revision);Object.assign(screen,{description,name:name||screen.name,...(sources?{sources}:{})});await this.store.saveGraph(graph);await this.syncMap(graph);return revision;}
 /** Agent understanding of a transition, state or flow, versioned separately from the deterministic summary. */
 async describe({kind,id,description,name}){const graph=await this.store.graph();const collection={transition:graph.transitions,state:graph.states,flow:graph.flows??[]}[kind];const item=kind==='state'?graph.states.find(s=>s.id===id)??(()=>{try{return resolveState(graph,id);}catch{}})():collection?.find(x=>x.id===id);if(!item)throw Error(`${kind} not found`);id=item.id;const revision={id:uid(),kind,targetId:id,description,name,time:now(),interpretation:true};graph.descriptions.push(revision);item.description=description;if(name)item.name=name;await this.store.saveGraph(graph);await this.syncMap(graph);return revision;}
 async exportMap(){const config=await this.store.config();const graph=await this.store.graph();const result=await exportMap(this.store,config,graph);if(!result)return {enabled:false};await this.store.saveGraph(graph);this.mapError=null;return {enabled:true,...result};}
 /** The agent recognises it cannot proceed and asks; the answer is remembered in the harness. */
 /** Secret references the profile already provides (environment variable set, or a stored answer). */
 async profileSecrets(profile){const config=await this.store.config().catch(()=>null),local=await this.help.secrets().catch(()=>({}));return Object.entries(config?.profiles?.[profile]?.secrets??{}).filter(([ref,env])=>(env&&process.env[env]!==undefined)||local[ref]!==undefined).map(([ref])=>ref);}
 async ask(input){const graph=await this.store.graph();if(input.kind==='credential'){const run=input.runId?await this.store.run(input.runId).catch(()=>null):null;const refs=await this.profileSecrets(run?.profile??'default');const ref=input.secretRef&&refs.includes(input.secretRef)?input.secretRef:refs.length===1?refs[0]:null;if(ref)return {status:'known',entries:[{kind:'credential',answer:{type:'secretRef',secretRef:ref}}],note:`The profile already provides this secret: navloom_step fill with secretRef "${ref}".`,profileSecrets:refs};}if(input.kind==='account'&&!input.options?.length){const config=await this.store.config();input={...input,options:Object.keys(config.profiles)};}const result=await this.help.ask(graph,input);if(result.status==='pending'&&input.runId&&this.active===input.runId){const run=await this.store.run(input.runId);run.helpRequests=[...new Set([...(run.helpRequests??[]),result.request.id])];await this.store.saveRun(run);}return result;}
 async awaitAnswer(input){return this.help.await(input);}
 /** Answers come from a person: the interface, an MCP elicitation form, or the chat relayed by the agent. */
 /**
  * A new account a person gives the agent: it becomes a profile whose sign-in values live only in the local secret store
  * (`<profile>_login`, `<profile>_password`), so missions use them by reference. Only the interface may create one.
  */
 async createAccount({id,description='',login,password},owner){if(owner!=='interface')throw Error('Only a person creates an account, in the interface');if(!/^[a-zA-Z0-9][\w-]{0,40}$/.test(id??''))throw Error('Account id: letters, digits, - and _');if(!password)throw Error('An account needs a password');
  const config=await this.store.config();if(config.profiles[id])throw Error(`Account "${id}" already exists`);const secrets={};
  if(login){await this.help.saveSecret(`${id}_login`,login);secrets[`${id}_login`]='';}await this.help.saveSecret(`${id}_password`,password);secrets[`${id}_password`]='';
  // Adding an account does not change how a running mission behaves, so it is allowed while one is active.
  await this.store.saveConfig({...config,profiles:{...config.profiles,[id]:{description,secrets}}});return id;}
 async answer(input,owner){const via=owner==='interface'?'interface':input.via;if(!['interface','elicitation','chat'].includes(via))throw Error('Answers come from a person: interface, elicitation form or chat relay');if(input.account)input={...input,option:await this.createAccount(input.account,owner)};else if(input.option!==undefined){const request=(await this.help.requests()).find(r=>r.id===input.requestId);if(request?.kind==='account'&&!(await this.store.config()).profiles[input.option])throw Error(`Unknown account "${input.option}"`);}const graph=await this.store.graph();const result=await this.help.answer(graph,{...input,resolvedBy:via});if(result.graphChanged){await this.store.saveGraph(graph);await this.syncMap(graph);}return result;}
 async forgetHelp({id}){const graph=await this.store.graph();const entry=await this.help.forget(graph,id);await this.store.saveGraph(graph);await this.syncMap(graph);return entry;}
 async helpRequests(){const graph=await this.store.graph();return {pending:await this.help.pending(),harness:(graph.harness??[]).map(publicEntry)};}
 /** Screens and endpoints linked to the code that renders or serves them. */
 async link(input){const graph=await this.store.graph(),config=await this.store.config();const link=sourceLinkSchema.parse({repository:input.repository,path:input.path,line:input.line,role:input.role,status:input.status,note:input.note});const {root}=await repositoryRoot(this.store,config,link.repository);await safePath(root,link.path);if(link.role==='shared'&&input.role===undefined)link.role=guessRole(link.path);
  const same=l=>l.repository===link.repository&&l.path===link.path&&(l.line??null)===(link.line??null);
  if(input.kind==='screen'){const screen=graph.screens.find(s=>s.id===input.id);if(!screen)throw Error('Screen not found');screen.sources=(screen.sources??[]).filter(l=>!same(l));if(!input.remove)screen.sources.push({...link,linkedAt:now()});}
  else if(input.kind==='endpoint'){const key=input.id;if(!endpointIndex(graph).some(e=>`${e.method} ${e.path}`===key))throw Error('Endpoint was not observed');graph.endpointLinks??={};graph.endpointLinks[key]=(graph.endpointLinks[key]??[]).filter(l=>!same(l));if(!input.remove)graph.endpointLinks[key].push({...link,linkedAt:now()});if(!graph.endpointLinks[key].length)delete graph.endpointLinks[key];}
  else throw Error('kind must be screen or endpoint');
  await this.store.saveGraph(graph);await this.syncMap(graph);return {kind:input.kind,id:input.id,links:input.kind==='screen'?graph.screens.find(s=>s.id===input.id).sources:graph.endpointLinks[input.id]??[]};}
 async suggestLinks({screenId}){const graph=await this.store.graph(),config=await this.store.config();return suggestLinks(this.store,config,graph,{screenId});}
 async searchSource({repository,query,regex,glob,maxResults}){const config=await this.store.config();const {root}=await repositoryRoot(this.store,config,repository);return {repository,...await searchSource(root,{query,regex,glob,maxResults})};}
 async sourceTree({repository,path,depth}){const config=await this.store.config();const {root}=await repositoryRoot(this.store,config,repository);return {repository,entries:await tree(root,{path,depth})};}
 async sources({repository,path}){const config=await this.store.config(),repo=config.repositories.find(r=>r.id===repository);if(!repo)throw Error('Repository is not configured');const root=await realpath(resolve(this.store.root,repo.path)),file=await safePath(root,path);if(/(^|[/\\])\.(env|git)([/\\.]|$)/.test(path)||/\.(pem|key)$/.test(path))throw Error('Secret or internal file is not readable');const info=await stat(file);if(info.size>500000)throw Error('Source file too large');const text=await readFile(file,'utf8');if(text.includes('\0'))throw Error('Binary source is unsupported');return {path,text,hash:hash(text),status:'source_only_not_runtime_verified'};}
 async memory({detail='compact',digests=false}={}){const config=await this.store.config();const skills=await Promise.all(config.skills.map(async path=>({path,text:await readFile(await safePath(this.store.root,path),'utf8')})));const graph=await this.store.graph();if(detail!=='full'){const endpoints=endpointIndex(graph);return {project:{id:config.id,name:config.name,description:config.description,targets:Object.fromEntries(Object.entries(config.targets).map(([k,t])=>[k,t.platform])),profiles:Object.keys(config.profiles),permissions:config.permissions,repositories:(config.repositories??[]).map(r=>({id:r.id,description:r.description})),limits:config.limits,exploration:config.exploration},skills,knowledge:leanGraph(graph,{digests}),endpoints:endpoints.map(e=>({endpoint:`${e.method} ${e.path}`,statuses:e.statuses,count:e.count,screens:e.screens.map(id=>graph.screens.find(s=>s.id===id)?.name??id),links:(graph.endpointLinks?.[`${e.method} ${e.path}`]??[]).map(l=>`${l.repository}:${l.path}${l.line?':'+l.line:''} (${l.status})`)})),harness:(graph.harness??[]).map(publicEntry),pendingRequests:(await this.help.pending()).map(r=>({id:r.id,kind:r.kind,question:r.question})),summary:{screens:graph.screens.length,states:graph.states.length,transitions:graph.transitions.length,endpoints:endpoints.length,harness:(graph.harness??[]).length,describedScreens:graph.screens.filter(s=>s.description).length,describedTransitions:graph.transitions.filter(t=>t.description).length,map:config.map.enabled?config.map.dir:null},runs:(await this.store.runs()).slice(0,20).map(r=>({id:r.id,objective:r.objective,status:r.status,result:r.result??null,steps:r.steps.length,coverage:r.coverage??null})),guidance:'Use the digests to reason about screens; fetch images with navloom_evidence only when text is not enough. Ask navloom_screen for one screen in depth.'};}return {config,skills,graph:{...graph,harness:(graph.harness??[]).map(publicEntry)},harness:(graph.harness??[]).map(publicEntry),scripts:this.harness.list(),pendingRequests:await this.help.pending(),endpoints:endpointIndex(graph).map(e=>({...e,links:graph.endpointLinks?.[`${e.method} ${e.path}`]??[]})),deeplinks:graph.deeplinks??[],summary:{harness:(graph.harness??[]).length,screens:graph.screens.length,states:graph.states.length,transitions:graph.transitions.length,endpoints:endpointIndex(graph).length,describedScreens:graph.screens.filter(s=>s.description).length,describedTransitions:graph.transitions.filter(t=>t.description).length,map:config.map.enabled?config.map.dir:null},runs:(await this.store.runs()).map(r=>({id:r.id,objective:r.objective,status:r.status,result:r.result,version:r.version,coverage:r.coverage}))};}
 async compare(a,b){return compareRuns(await this.store.run(a),await this.store.run(b));}
 async reviewComparison(baseline,current,note){const comparison=await this.compare(baseline,current);const review={...comparison,id:uid(),reviewedAt:now(),note,reviewRequired:false};await this.store.immutable(`revisions/review-${review.id}.json`,review);return review;}
 async groupFlow({id,name,description,screenIds,runIds=[]}){const graph=await this.store.graph();screenIds=[...new Set(screenIds.map(ref=>resolveScreen(graph,ref).id))];const runs=await Promise.all(runIds.map(runId=>this.store.run(runId)));runs.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));const group={id,name,description,screenIds:orderScreenIds(screenIds,runs.flatMap(run=>run.observations)),runIds:[...new Set(runIds)],updatedAt:now()};graph.flows??=[];graph.flows=graph.flows.filter(f=>f.id!==id);graph.flows.push(group);await this.store.saveGraph(graph);await this.syncMap(graph);return group;}
 async importLegacy(flow){if(flow.version!==1||!Array.isArray(flow.screens))throw Error('Expected a version 1 flow');const graph=await this.store.graph(),entry={id:uid(),importedAt:now(),provenance:'legacy_documentation',flow,confirmed:false};graph.legacy.push(entry);await this.store.saveGraph(graph);return {id:entry.id,provenance:entry.provenance};}
 /**
  * Maps recorded before screens kept a profile get one from their own evidence (the captures of each state), or from the
  * controls saved on the states when the evidence is gone, so recognition can tell a known screen from a new one.
  */
 async bootstrapProfiles(){const graph=await this.store.graph();let changed=false;
  for(const screen of graph.screens){if(screen.profile?.n)continue;let profile=null;
   for(const state of graph.states.filter(s=>s.screenId===screen.id&&!s.scrollOf&&!s.keyboard).slice(0,6)){const id=state.representative?.observationId??state.firstSeen;let observation=null;try{observation=JSON.parse((await this.store.resource(`evidence/${id}.json`)).toString());}catch{}
    if(observation?.elements)profile=learn(profile,tokensOf(observation));else if(state.hotspots?.length)profile=learn(profile,new Set([...controlsOfHotspots(state.hotspots),...(screen.header?['h:'+String(screen.header).toLowerCase().slice(0,40)]:[])]));}
   if(profile){screen.profile=profile;changed=true;}}
  if(changed)await this.store.saveGraph(graph);return changed;}
 /** Screens that look like one another: candidates for `merge`, with what they share. */
 async similar({target,min=.55}={}){await this.bootstrapProfiles();const graph=await this.store.graph();return {pairs:similarScreens(graph,{target,min}).map(p=>({screens:[{id:p.a,name:p.names[0]},{id:p.b,name:p.names[1]}],score:p.score,shared:p.shared}))};}
 /**
  * Fold screens (or states) recorded twice into one. Within a mission that records for review, the merge waits for the
  * person's approval with the rest of what the mission found.
  */
 async merge({into,from,kind='screen',as}){const graph=await this.store.graph();
  if(kind==='state'){const find=ref=>resolveState(graph,ref);const keep=find(into),folded=mergeStates(graph,keep.id,from.map(ref=>find(ref).id));await this.store.saveGraph(graph);await this.syncMap(graph);return {kind,into:keep.id,merged:folded.length,pending:!!this.store.draftId()};}
  // as=state: the screens in `from` become states of `into`, kept apart from the states it already had.
  const keep=resolveScreen(graph,into),ids=from.map(ref=>resolveScreen(graph,ref).id),moved=as==='state'?graph.states.filter(s=>s.screenId!==keep.id&&ids.includes(s.screenId)).map(s=>s.id):[],folded=mergeScreens(graph,keep.id,ids,{asState:as==='state'});
  await this.store.saveGraph(graph);await this.syncMap(graph);
  return {kind,into:{id:keep.id,name:keep.name},merged:folded.map(f=>f.name),states:graph.states.filter(s=>s.screenId===keep.id).length,...(moved.length?{becameStates:graph.states.filter(s=>moved.includes(s.id)).map(s=>({id:s.id,name:s.name}))}:{}),pending:!!this.store.draftId()};}
 /**
  * A `screen` script written from what the map already knows: for each screen, the ids and texts it always shows and no
  * other screen does, checked against real captures. The agent proposes it with `harness_propose`; a person approves it.
  */
 async suggestScreenScript({target}={}){await this.bootstrapProfiles();const graph=await this.store.graph(),config=await this.store.config();target??=(this.active?(await this.store.run(this.active)).target:null)??Object.keys(config.targets)[0];const samples=[];
  for(const screen of graph.screens.filter(s=>s.target===target)){let taken=0;for(const state of graph.states.filter(s=>s.screenId===screen.id&&!s.scrollOf&&!s.keyboard)){if(taken>=4)break;for(const id of [...new Set([state.representative?.observationId,state.firstSeen,state.lastSeen].filter(Boolean))]){if(taken>=4)break;try{const o=JSON.parse((await this.store.resource(`evidence/${id}.json`)).toString());/* A frame with nothing to act on (loading, blank) says nothing about the screen. */if(!o.elements?.some(e=>e.actions?.length))continue;samples.push({screenId:screen.id,name:screen.name,input:screenInput(o)});taken++;}catch{}}}}
  return screenScript(graph,samples,{target});}
 /**
  * Say who an endpoint belongs to when the recording put it in the wrong place: `load` of a screen (it comes with
  * arriving there) or `action` of a screen (`via` names the action). Every recorded call is then placed again from the
  * runs' own evidence, so the map is corrected backwards too. `remove` drops the rule and places calls by time again.
  */
 async apiOwner({endpoint,screen,role='load',via,remove=false}){
  const graph=await this.store.graph(),key=String(endpoint).trim().replace(/\s+/g,' ');
  if(!endpointIndex(graph).some(e=>`${e.method} ${e.path}`===key))throw Error(`Endpoint "${key}" was not observed; use "METHOD /path" as navloom_memory lists it`);
  graph.apiRules=(graph.apiRules??[]).filter(r=>r.endpoint!==key);
  let target=null;if(!remove){if(!screen)throw Error('Say which screen the endpoint belongs to');target=resolveScreen(graph,screen);graph.apiRules.push({endpoint:key,screenId:target.id,role,...(via?{via}:{}),setAt:now()});}
  const runs=await this.store.runs(),result=reattribute(graph,runs);for(const run of runs)await this.store.saveRun(run);
  await this.store.saveGraph(graph);await this.syncMap(graph);
  return {endpoint:key,...(target?{belongsTo:`${role==='load'?'ao chegar em':'ação de'} ${target.name}${via?` ("${via}")`:''}`}:{rule:'removed'}),moved:result.moved,transitions:result.transitions};}
 /** The documentation shipped with Navloom, shown in the interface. */
 async docs(){return {markdown:await readFile(fileURLToPath(new URL('../docs/como-funciona.md',import.meta.url)),'utf8')};}
 async close(){if(this.active)await this.pause(this.active,'service_stopped');await this.previews;}
 async flushPreviews(){await this.previews;}
}
/**
 * Why a walk stopped, in terms the agent can act on: where it is (a screen Navloom has never seen, a known screen in a
 * state it has not seen, or a known state with no way forward), what the graph expected and got instead, and whether the
 * same action is known to lead to different places (a scenario: the same purchase approved or declined).
 */
function diagnose(graph,observation,wanted,surprises,run,status,reason){
 const name=id=>graph.screens.find(s=>s.id===id)?.name??'?',stateName=id=>graph.states.find(s=>s.id===id)?.name??'?',r=observation?.recognition;
 const out={at:`${name(observation?.screenId)} / ${stateName(observation?.stateId)}`,destination:wanted.name};
 // The device or the app failed (not the knowledge): nothing to analyse in the map, the reason says what broke.
 out.cause=['blocked','paused'].includes(status)?status:observation?.semantic?.includes('error')?'app_error':r?.how==='new'?'unknown_screen':!graph.transitions.some(t=>t.from===observation?.stateId&&t.confirmed)?'unknown_state':'no_way_forward';
 if(out.cause==='app_error'){const said=(observation.elements??[]).filter(e=>!e.actions?.length&&/erro|error|falha|failed|não foi possível|indisponível|unavailable|tente/i.test(e.text??'')).map(e=>e.text).slice(0,2);if(said.length)out.appSays=said.join(' · ');}
 if(['blocked','paused'].includes(status))out.reason=String(reason??'').slice(0,200);
 if(r?.how==='new'&&r.candidates?.length)out.lookalike=r.candidates.map(c=>`${c.name} ${c.score}`);
 const last=surprises.at(-1);if(last)out.unexpected=`"${last.action}" em ${name(last.at)} devia levar a ${name(last.expected)}${last.expected===last.got?` (${stateName(last.expectedState)})`:''} e levou a ${name(last.got)}${last.expected===last.got?` (${stateName(last.gotState)})`:''}`;
 // The same action from the same state recorded with different destinations: the app branches here, and which branch is wanted is a decision.
 // A frame still loading is a moment on the way, not a branch.
 const settled=id=>{const st=graph.states.find(x=>x.id===id);return st&&!st.semantic?.includes('loading');};
 const branches=new Map();for(const t of graph.transitions){if(!t.confirmed||t.target!==run.target||t.action.type==='back'||!settled(t.to))continue;const key=t.from+JSON.stringify(t.action);(branches.get(key)??branches.set(key,{edge:t,to:new Set()}).get(key)).to.add(t.to);}
 const forks=[...branches.values()].filter(b=>b.to.size>1&&[observation?.stateId,...surprises.map(s=>graph.states.find(x=>x.id===s.expectedState)?.id)].some(id=>id&&graph.states.find(x=>x.id===b.edge.from)?.screenId===graph.states.find(x=>x.id===id)?.screenId));
 // Each branch with the backend answer only it has seen, when there is one: that is the scenario to choose.
 const why=(b,to)=>{const keys=e=>new Set((e.responses??[]).map(r=>r.key)),edges=graph.transitions.filter(t=>t.from===b.edge.from&&JSON.stringify(t.action)===JSON.stringify(b.edge.action)),mine=edges.filter(e=>e.to===to),own=[...new Set(mine.flatMap(e=>[...keys(e)]))].filter(k=>edges.every(o=>o.to===to||!keys(o).has(k)));return own.length?` com ${own.slice(0,2).join(', ')}`:'';};
 if(forks.length)out.branches=forks.slice(0,4).map(b=>`"${b.edge.name}" em ${name(graph.states.find(x=>x.id===b.edge.from)?.screenId)} já levou a ${[...b.to].map(id=>`${name(graph.states.find(x=>x.id===id)?.screenId)} (${stateName(id)})${why(b,id)}`).join(' ou ')}`);
 return out;
}
/** What a `screen` script reads: the title, texts and ids on view, and the selected tab (the section of the app). */
function screenInput(o){return {platform:o.platform,route:o.route,heading:o.header||o.heading,texts:String(o.text??'').split('\n').filter(Boolean).slice(0,60),ids:(o.elements??[]).map(e=>e.resourceId).filter(Boolean).slice(0,80),section:selectedTab(o)};}
function redact(text,secrets){for(const secret of secrets)if(secret)text=text.split(secret).join('[REDACTED]');return text;}
