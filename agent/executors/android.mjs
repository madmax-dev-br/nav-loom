import {command} from '../process.mjs';
import {hash,now} from '../store.mjs';
import {CallLog,recordingProxy,parseHttpLog,parseAndroidNetwork} from '../network.mjs';
import {parseDumpsysDeeplinks} from '../deeplinks.mjs';
const MARK='__NAVLOOM_SPLIT__';
const decode=s=>s.replace(/&#(x?)([0-9a-fA-F]+);/g,(_,hex,code)=>String.fromCodePoint(parseInt(code,hex?16:10))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function parseHierarchy(xml,viewport){return [...xml.matchAll(/<node\b([^>]+)>?/g)].map((match,index)=>{const a=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));const b=a.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number);if(!b)return null;const name=a['content-desc']||a.text||a['resource-id']||a.class,field=a.class?.includes('EditText');
 // A field is known by its id, hint or description, never by what is typed into it: the value changes, the field does not.
 const identity=[a['resource-id']||`${a.class}:${index}`,a.class,field?(a['resource-id']||a.hint||a['content-desc']||'field'):name].join('|');return {id:hash(identity),identity,name,role:a.class,resourceId:a['resource-id'],contentDescription:a['content-desc'],text:a.text,...(a.hint?{hint:a.hint}:{}),...(a.selected==='true'||a.checked==='true'?{selected:true}:{}),disabled:a.enabled==='false',sensitive:a.password==='true',actions:[...(a.clickable==='true'?['click']:[]),...(a.class?.includes('EditText')?['fill']:[]),...(a.scrollable==='true'?['scroll']:[])],bounds:{x:b[0]/viewport.width,y:b[1]/viewport.height,width:(b[2]-b[0])/viewport.width,height:(b[3]-b[1])/viewport.height},visible:b[2]>b[0]&&b[3]>b[1],box:b};}).filter(Boolean).map((node,index,all)=>{const {box,...element}=node;const own=element.contentDescription||element.text;/* Compose rows are clickable containers; their readable label lives in the children. */const inner=own?[]:all.slice(index+1).filter(o=>o.text&&o.box[0]>=box[0]&&o.box[1]>=box[1]&&o.box[2]<=box[2]&&o.box[3]<=box[3]).slice(0,3).map(o=>o.text);const tag=element.resourceId?.split(/[:/]/).at(-1);/* A field shows its value; the tag says which field it is. */if(element.actions.includes('fill')&&tag)return {...element,label:element.sensitive?tag:`${tag}: ${element.text??''}`};return {...element,label:own||inner.join(' · ')||tag||element.role?.split('.').at(-1)};});}
/**
 * The screen's own title, read from the hierarchy. It is looked for in the app-bar band at the top of the window:
 * an element whose id says it is a title wins; otherwise the tallest text there (titles use the largest type), and
 * between equals the lower one, since an eyebrow or brand line sits above the title, not below it.
 */
export function findHeader(elements){
 const words=elements.filter(e=>e.text&&/\p{L}/u.test(e.text)&&e.visible&&e.bounds.height>0&&!e.actions.includes('fill'));
 const within=limit=>words.filter(e=>e.bounds.y+e.bounds.height<=limit);
 const band=within(.14).length?within(.14):within(.24);
 const named=band.find(e=>/title|toolbar|header|heading/i.test(e.resourceId??''));if(named)return named.text.trim();
 return band.slice().sort((a,b)=>b.bounds.height-a.bounds.height||b.bounds.y-a.bounds.y)[0]?.text.trim()??'';
}
/**
 * What Android itself says about where the app is, from `dumpsys activity activities` and `dumpsys window`: the resumed
 * activity (null while none is resumed, e.g. during a cold start), the app's activity stack, newest first, and the window
 * in focus. A focused window that is not an activity (a dialog, a popup menu, a bottom sheet) is drawn over the screen.
 */
export function parseNavigation(activities,windows,pkg){
 const lines=String(activities??'').split('\n');const resumed=lines.find(l=>/mResumedActivity|topResumedActivity/.test(l)&&l.includes(pkg+'/'));
 const activity=resumed?.match(/[\w.]+\/[\w.$]+/)?.[0]??null;
 const stack=[];for(const line of lines){if(!/Hist\s*#\d+/.test(line)||!line.includes(pkg+'/'))continue;const name=line.match(/[\w.]+\/([\w.$]+)/)?.[1];if(name&&stack.at(-1)!==name)stack.push(name.replace(/^.*\./,''));}
 const focus=String(windows??'').match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)?.[1]?.trim()??null;
 const overlay=!!focus&&!focus.includes('/')&&!/InputMethod|StatusBar|NavigationBar|NotificationShade|Toast/i.test(focus)&&(focus===pkg||/PopupWindow|Dialog|Sheet|Menu/i.test(focus));
 return {activity,stack,window:focus,overlay};
}
/** Packages that draw over any app: the system UI, permission and autofill sheets, the keyboard. */
const SYSTEM=/^(android|com\.android\.systemui|com\.android\.permissioncontroller|com\.google\.android\.permissioncontroller|com\.google\.android\.gms|com\.google\.android\.inputmethod\.latin|com\.android\.inputmethod\.latin|com\.android\.intentresolver|com\.android\.credentialmanager)$/;
/**
 * Whose window the hierarchy dump shows. The resumed activity can still be the app while another window has the
 * front: a system sheet (autofill, a permission) is drawn over the app, another application has taken the screen.
 */
export function windowOwner(xml,pkg){const packages=[...new Set([...String(xml??'').matchAll(/package="([^"]+)"/g)].map(m=>m[1]))];if(!packages.length||packages.includes(pkg))return {own:true};const other=packages.find(p=>!SYSTEM.test(p));return other?{own:false,other}:{own:false,system:packages[0]};}
/** The fragment on display, from `dumpsys activity <package>`: the deepest added fragment that is not navigation plumbing. */
export function parseFragment(dump){
 const names=[];let inside=false;
 for(const line of dump.split('\n')){if(/Added Fragments:/.test(line)){inside=true;continue;}if(!inside)continue;const match=line.match(/^\s*#\d+:\s+([A-Za-z_][\w$.]*)\{/);if(match)names.push(match[1].split('.').at(-1));else if(line.trim())inside=false;}
 return names.filter(name=>!/^(NavHostFragment|SupportRequestManagerFragment|ReportFragment|RequestManagerFragment|LifecycleDispatcher|ViewModelStoreOwner)/.test(name)).at(-1)??null;
}
/** Deeplink patterns the application declares, read from the package resolver table. */
export function parseDeeplinks(dump,pkg){
 const found=new Map();let block=null;
 const flush=()=>{if(block)for(const scheme of block.schemes){if(/^https?$/.test(scheme)&&!block.hosts.length)continue;for(const host of block.hosts.length?block.hosts:[''])for(const path of block.paths.length?block.paths:[{type:'PREFIX',value:''}]){const pattern=`${scheme}://${host}${path.value}`;found.set(pattern+path.type,{pattern,match:path.type.toLowerCase(),activity:block.activity});}}block=null;};
 for(const line of dump.split('\n')){
  const head=line.match(/^\s+[0-9a-f]+ (\S+\/\S+) filter [0-9a-f]+/);if(head){flush();block=head[1].startsWith(pkg+'/')?{activity:head[1],schemes:[],hosts:[],paths:[]}:null;continue;}
  if(!block)continue;let m;
  if((m=line.match(/^\s+Scheme: "([^"]+)"/)))block.schemes.push(m[1]);
  else if((m=line.match(/^\s+Authority: "([^"]*)"/)))block.hosts.push(m[1]);
  else if((m=line.match(/^\s+Path: "PatternMatcher\{(\w+): ([^}]*)\}"/)))block.paths.push({type:m[1],value:m[2]});
 }
 flush();return [...found.values()];
}
export class AndroidExecutor{
 constructor(target,{runCommand=command}={}){this.target=target;this.runCommand=runCommand;this.startedAt=now();this.log=new CallLog();this.proxies=[];this.networkCursor=0;}
 adb(args,options={}){return this.runCommand(this.target.adb,['-s',this.target.serial,...args],options);}
 async capabilities(){try{const state=await this.adb(['get-state']);if(state.trim()!=='device')throw Error('Device unavailable');await this.adb(['shell','pm','path',this.target.package]).then(s=>{if(!s.trim())throw Error('Application is not installed');});return {platform:'android',device:this.target.serial,available:['capture','interact','deeplink','logs','scroll','back','declared_deeplinks'],conditional:['hierarchy','network'],missing:[],notes:['network: API calls are read from logcat lines of the application process (OkHttp logging, lines such as "HTTP 200 /path", or a format taught by a learned script) and, for backends reached through adb reverse, from a recording proxy; apps that log nothing and use no reverse port report no calls.']};}catch(e){return {platform:'android',device:this.target.serial,available:[],missing:['device_or_application'],error:e.message};}}
 async start(){const size=await this.adb(['shell','wm','size']);const pairs=[...size.matchAll(/(\d+)x(\d+)/g)];if(!pairs.length)throw Error('Cannot determine device viewport');const p=pairs.at(-1);this.viewport={width:Number(p[1]),height:Number(p[2])};this.startedAt=now();await this.watchNetwork();await this.launch();}
 /** Start again from the entry screen: the running task is stopped first, since launching it would only bring it forward as it is. */
 async restart(){await this.adb(['shell','am','force-stop',this.target.package]);await this.launch();await new Promise(r=>setTimeout(r,800));}
 async launch(){if(this.target.activity)await this.adb(['shell','am','start','-n',this.target.activity.includes('/')?this.target.activity:`${this.target.package}/${this.target.activity}`]);else await this.adb(['shell','monkey','-p',this.target.package,'-c','android.intent.category.LAUNCHER','1']);}
 /**
  * One adb round trip per observation: the focused activity, the hierarchy dump, whether the keyboard is up and,
  * for apps that use fragments, the fragment on display. Sections are separated by a marker.
  */
 async observe(){const script=[`dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity|Hist #"`,`echo ${MARK}`,'rm -f /sdcard/navloom-window.xml','uiautomator dump /sdcard/navloom-window.xml >/dev/null 2>&1','cat /sdcard/navloom-window.xml',`echo ${MARK}`,'dumpsys input_method | grep mInputShown || true',`echo ${MARK}`,/* nothing in focus mid-transition: an empty answer, never a failed capture *//* `displays` is the small section that names the focused window; the full dump costs seconds */'dumpsys window displays | grep -E "mCurrentFocus=" || true',...(this.noFragments?[]:[`echo ${MARK}`,`dumpsys activity ${this.target.package}`])].join('; ');
 const [head='',xml='',input='',windows='',fragments]=(await this.adb(['shell',script],{maxBuffer:32*1024*1024})).split(MARK);
 const focused=head.split('\n').find(l=>/mResumedActivity|topResumedActivity/.test(l))?.trim()||this.target.package;if(!focused.includes(this.target.package))throw Error('Application lost foreground; navigation stopped');
 // Another application in front is never recorded as a screen of this one.
 const owner=windowOwner(xml,this.target.package);if(owner.other)throw Error(`Another application is in front (${owner.other}); navigation stopped`);
 const hierarchy=xml.includes('<hierarchy')?'available':'unavailable',elements=parseHierarchy(xml,this.viewport),header=findHeader(elements);
 // Fragment-based apps name their screens for us. Apps without fragments are asked once per mission, not on every observation.
 let fragment=null;if(!this.noFragments){fragment=parseFragment(fragments??'');if(!fragment)this.noFragments=true;}
 // An open keyboard covers half the screen; the state is recorded apart so the clean capture is kept.
 const keyboard=/mInputShown=true/.test(input);const route=focused.match(/[\w.]+\/[\w.$]+/)?.[0]||this.target.package;
 // A window narrower and shorter than the screen is a dialog even when the window list does not say so.
 const navigation=parseNavigation(head,windows,this.target.package),root=elements[0]?.bounds,small=!!root&&root.width<.97&&root.width*root.height<.85;
 return {platform:'android',route,url:route,activity:navigation.activity,stack:navigation.stack,window:navigation.window,overlay:navigation.overlay||small||!!owner.system,...(owner.system?{drawnBy:owner.system}:{}),title:this.target.package,header,fragment,keyboard,heading:header||elements.find(e=>e.text)?.text||'',screenKey:elements.map(e=>e.contentDescription?.match(/navloom:screen:([^:]+):state:([^\s]+)/)).find(Boolean)?.[1],stateKey:elements.map(e=>e.contentDescription?.match(/navloom:screen:([^:]+):state:([^\s]+)/)).find(Boolean)?.[2],stateMarkers:elements.filter(e=>/ProgressBar|Dialog/.test(e.role)).map(e=>e.role),text:elements.map(e=>e.text).filter(Boolean).join('\n'),elements,viewport:this.viewport,scroll:{position:'unknown',direction:this.lastScroll??null},hierarchy,xml,capturedAt:now()};}
 async focused(){const activity=await this.adb(['shell','dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"']);return activity.split('\n').find(l=>/mResumedActivity|topResumedActivity/.test(l))?.trim()||'';}
 async capture(){return this.adb(['exec-out','screencap','-p'],{encoding:'buffer'});}
 /** Whether the keyboard is up right now (null when the device does not say). Asked again after the screenshot, see `Runtime.sight`. */
 async keyboardShown(){const input=await this.adb(['shell','dumpsys input_method | grep mInputShown || true']);return /mInputShown=/.test(input)?/mInputShown=true/.test(input):null;}
 async act(action,element){
 if(action.type==='open')return this.start();
 if(action.type==='deeplink'){if(!action.url)throw Error('Deeplink required');const output=await this.adb(['shell','am','start','-a','android.intent.action.VIEW','-d',shellQuote(action.url),'-p',this.target.package]);if(/Error:|unable to resolve|Exception/i.test(output))throw Error('Android could not resolve the configured deeplink');return output;}
 if(action.type==='back'){await this.adb(['shell','input','keyevent','4']);
  // Back from a root screen leaves the app. Relaunch it and report a recoverable failure instead of ending the mission.
  for(let attempt=0;attempt<4;attempt++){await new Promise(r=>setTimeout(r,attempt?250:150));if((await this.focused()).includes(this.target.package))return;}
  await this.launch();await new Promise(r=>setTimeout(r,400));const error=Error('Back left the application; it was relaunched at its entry screen');error.recoverable=true;throw error;}
 if(action.type==='wait')return new Promise(r=>setTimeout(r,action.durationMs??300));
 const b=element?.bounds,point=action.point??(b?{x:b.x+b.width/2,y:b.y+b.height/2}:null);
 if(action.type==='scroll'){const horizontal=['left','right'].includes(action.direction),reverse=['up','left'].includes(action.direction);const box=b??{x:0,y:0,width:1,height:1};const center={x:box.x+box.width/2,y:box.y+box.height/2};const start={...center},end={...center};const axis=horizontal?'x':'y',dimension=horizontal?'width':'height';start[axis]=box[axis]+box[dimension]*(reverse?.25:.75);end[axis]=box[axis]+box[dimension]*(reverse?.75:.25);this.lastScroll=action.direction??'down';return this.adb(['shell','input','swipe',String(Math.round(start.x*this.viewport.width)),String(Math.round(start.y*this.viewport.height)),String(Math.round(end.x*this.viewport.width)),String(Math.round(end.y*this.viewport.height)),'400']);}
 if(!point)throw Error('Verified element or explicit point required');const coords=[String(Math.round(point.x*this.viewport.width)),String(Math.round(point.y*this.viewport.height))];await this.adb(['shell','input','tap',...coords]);if(action.type==='fill'){if(!/^[\x20-\x7E]*$/.test(action.value??''))throw Error('ADB text input only supports ASCII; configure an input plugin for Unicode');await this.adb(['shell','input','keyevent','KEYCODE_MOVE_END']);await this.adb(['shell','input','keycombination','113','29']);await this.adb(['shell','input','text',shellQuote((action.value??'').replace(/ /g,'%s'))]);}}
 async diagnostics(){try{const pid=(await this.adb(['shell','pidof',this.target.package])).trim().split(' ')[0];if(!/^\d+$/.test(pid))return {availability:'partial',logs:[],reason:'Application process is no longer running; process logs cannot be attributed'};const output=await this.adb(['logcat','-d','-v','epoch',`--pid=${pid}`,'-t','1000']);const start=Date.parse(this.startedAt)/1000;return {availability:'available',logs:output.split('\n').filter(l=>Number(l.trim().split(/\s+/)[0])>=start).map(message=>({time:now(),level:/\s[EF]\s/.test(message)?'error':'info',message}))};}catch(e){return {availability:'unavailable',logs:[],reason:e.message};}}
 async build(){const data=await this.adb(['shell','dumpsys','package',this.target.package]);let apkHash=null;try{const path=(await this.adb(['shell','pm','path',this.target.package])).split('\n').find(p=>p.startsWith('package:'))?.slice(8);if(path)apkHash=(await this.adb(['shell','sha256sum',shellQuote(path)])).trim().split(/\s+/)[0];}catch{}return {apkHash,package:this.target.package,versionName:data.match(/versionName=(\S+)/)?.[1],versionCode:data.match(/versionCode=(\d+)/)?.[1],reportedBuild:this.target.buildId??null,verified:false};}
 /** Record backend calls: a loopback proxy for `adb reverse` backends, plus HTTP client log lines. */
 async watchNetwork(){
  if(this.watching)return;this.watching=true;
  for(const entry of this.target.network?.reverse??[]){const proxy=await recordingProxy(entry.upstream,this.log,{bodies:this.target.network?.bodies!==false});this.proxies.push({...proxy,devicePort:entry.devicePort});await this.adb(['reverse',`tcp:${entry.devicePort}`,`tcp:${proxy.port}`]);}
  await this.primeNetworkCursor();await this.syncClock();
 }
 /**
  * How far the device clock is from this machine's (ms), so a log line's own time says when its call happened in
  * the same clock the steps use. The sample with the shortest round trip wins; without one the clocks are taken as equal.
  */
 async syncClock(){let best=null;for(let i=0;i<3;i++){try{const before=Date.now(),out=await this.adb(['shell','date +%s%3N']),after=Date.now(),device=Number(String(out).trim());if(!Number.isFinite(device)||device<1e12)continue;const sample={rtt:after-before,offset:(before+after)/2-device};if(!best||sample.rtt<best.rtt)best=sample;}catch{}}this.clockOffset=best?Math.round(best.offset):0;return this.clockOffset;}
 /** Start reading logcat after whatever the device already holds, using the device's own clock. */
 async primeNetworkCursor(){try{const output=await this.adb(['logcat','-d','-v','epoch','-t','1']);const times=output.split('\n').map(l=>Number(l.trim().split(/\s+/)[0])).filter(t=>Number.isFinite(t)&&t>0);if(times.length)this.networkCursor=Math.max(this.networkCursor,...times);}catch{}}
 /**
  * Request lines the application process logged since the previous poll, in one round trip. The cursor is the device's
  * own logcat clock, so host/device clock drift never drops or duplicates calls. OkHttp pairs come first, then the
  * formats this project's agent taught through learned scripts, then common generic request lines.
  */
 async pollLogcat(){
  if(this.target.network?.logcat===false)return;
  try{const output=await this.adb(['shell',`pid=$(pidof ${this.target.package} | cut -d" " -f1); [ -n "$pid" ] && logcat -d -v epoch --pid=$pid -t 2000`]);
   const stamped=output.split('\n').map(line=>({line,time:Number(line.trim().split(/\s+/)[0])})).filter(e=>Number.isFinite(e.time)&&e.time>0),fresh=stamped.filter(e=>e.time>this.networkCursor);if(stamped.length)this.networkCursor=Math.max(this.networkCursor,...stamped.map(e=>e.time));
   // Each call keeps the time its line was written (device clock moved to this machine's), not the time it was read.
   for(const {line,time} of fresh){const at=Math.round(time*1000+(this.clockOffset??0)),entry=parseHttpLog(line);
    // Every line of the app is kept a while with its time, so each step can keep the lines written while it happened.
    (this.recent??=[]).push({at,line:line.trim().replace(/^\d+\.\d+\s+\d+\s+\d+\s+/,'')});if(this.recent.length>4000)this.recent.splice(0,this.recent.length-4000);if(entry){if(entry.phase==='request')this.log.begin({method:entry.method,url:entry.url,source:'logcat',at});else this.log.complete({url:entry.url,status:entry.status,ms:entry.ms,source:'logcat',at});continue;}
    const learned=this.harness?.apply('logcat',{line:line.trim()})?.value??parseAndroidNetwork([line]).map(c=>({method:c.method,url:c.url??c.path,status:c.status??undefined,ms:c.durationMs??undefined}))[0];if(!learned)continue;
    if(learned.status===undefined)this.log.begin({method:learned.method,url:learned.url,source:'logcat',at});else this.log.complete({method:learned.method,url:learned.url,status:learned.status,ms:learned.ms,source:'logcat',at});}
  }catch{}
 }
 /** App log lines written between two moments of this machine's clock (ms). */
 linesBetween(from,to){return (this.recent??[]).filter(l=>l.at>=from&&l.at<to);}
 async network({quick=false}={}){if(!quick)await this.pollLogcat();return this.log.drain();}
 /** Recent log lines of the application process, for the agent to learn the app's logging patterns from. */
 async logLines({contains,limit=40}={}){const pid=(await this.adb(['shell','pidof',this.target.package])).trim().split(' ')[0];if(!/^\d+$/.test(pid))return [];const output=await this.adb(['logcat','-d','-v','brief',`--pid=${pid}`,'-t','600']);return output.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('-----')&&(!contains||l.toLowerCase().includes(contains.toLowerCase()))).slice(-limit).map(l=>l.length>300?l.slice(0,299)+'…':l);}
 /** Deeplinks declared in the installed package's intent filters: full filters (`declared`) and the URL patterns they accept (`patterns`). */
 async deeplinks(){try{const text=await this.adb(['shell','dumpsys','package',this.target.package],{maxBuffer:32*1024*1024});return {source:'dumpsys package',declared:parseDumpsysDeeplinks(text,this.target.package),patterns:parseDeeplinks(text,this.target.package)};}catch(e){return {source:'dumpsys package',declared:[],patterns:[],error:e.message};}}
 async close(){
  for(const proxy of this.proxies.splice(0)){const local=['127.0.0.1','localhost'].includes(proxy.upstream.hostname)&&proxy.upstream.port;
   // Hand the device port back to the backend it pointed at before recording started.
   await this.adb(local?['reverse',`tcp:${proxy.devicePort}`,`tcp:${proxy.upstream.port}`]:['reverse','--remove',`tcp:${proxy.devicePort}`]).catch(()=>{});await proxy.close();}
  this.watching=false;
 }
}
function shellQuote(value){return "'"+value.replace(/'/g,"'\\''")+"'";}
