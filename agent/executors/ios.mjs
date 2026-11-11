import {command} from '../process.mjs';
import {now} from '../store.mjs';
/**
 * iOS simulator executor. Capture, launch and deeplinks use `xcrun simctl`; element interaction needs an
 * XCUITest/WebDriverAgent driver that is not bundled, so `interact` and `hierarchy` are reported as missing
 * rather than simulated. Exploration on iOS is therefore limited to deeplinks and captures.
 */
export class IosExecutor{
 constructor(target,{runCommand=command}={}){this.target=target;this.runCommand=runCommand;this.startedAt=now();}
 simctl(args,options={}){return this.runCommand(this.target.xcrun,['simctl',...args],options);}
 async capabilities(){try{const devices=await this.simctl(['list','devices','booted']);if(!devices.includes(this.target.udid))throw Error('Simulator is not booted');return {platform:'ios',device:this.target.udid,available:['capture','deeplink','back'],conditional:[],missing:['interact','hierarchy','logs','network'],instructions:'Element interaction on iOS requires an XCUITest/WebDriverAgent driver. Only captures and deeplinks are available; use them to document screens reachable by deeplink.'};}catch(e){return {platform:'ios',device:this.target.udid,available:[],missing:['simulator'],error:e.message};}}
 async start(){this.startedAt=now();await this.simctl(['launch',this.target.udid,this.target.bundleId]);this.viewport={width:0,height:0};}
 async observe(){let route=this.target.bundleId;try{const apps=await this.simctl(['listapps',this.target.udid]);if(!apps.includes(this.target.bundleId))throw Error('Application is not installed');}catch(e){if(/not installed/.test(e.message))throw e;}return {platform:'ios',route,url:route,title:this.target.bundleId,heading:'',stateMarkers:[],text:'',elements:[],viewport:this.viewport,scroll:{position:'unknown'},hierarchy:'unavailable',capturedAt:now()};}
 async capture(){return this.simctl(['io',this.target.udid,'screenshot','--type=png','-'],{encoding:'buffer',maxBuffer:64*1024*1024});}
 async drainNetwork(){return [];}
 async deeplinks(){return {source:'unavailable',declared:[],note:'Declared URL schemes must be read from the app Info.plist; configure permissions.deeplinkPrefixes and verify them with deeplink steps.'};}
 async act(action){
  if(action.type==='open')return this.start();
  if(action.type==='deeplink'){if(!action.url)throw Error('Deeplink required');return this.simctl(['openurl',this.target.udid,action.url]);}
  if(action.type==='wait')return new Promise(r=>setTimeout(r,action.durationMs??300));
  throw Error(`Action ${action.type} is not available on iOS without an interaction driver`);
 }
 async diagnostics(){return {availability:'unavailable',logs:[],reason:'Process logs require an iOS log driver'};}
 async build(){return {bundleId:this.target.bundleId,reportedBuild:this.target.buildId??null,verified:false};}
 async close(){}
}
