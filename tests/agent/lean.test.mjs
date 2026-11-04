import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,leanObservation,leanRun,compactElement} from '../../agent/lean.mjs';
import {encodeJpeg} from '../../agent/jpeg.mjs';
const observation={id:'o1',route:'dev.app/.MainActivity',screenKey:'home',stateKey:'ready',heading:'Olá, Ana',viewport:{width:1080,height:2280},hierarchy:'available',stateMarkers:['ProgressBar'],elements:[
 {id:'e1',identity:'dev.app:id/title|android.widget.TextView|Olá, Ana',name:'Olá, Ana',text:'Olá, Ana',role:'android.widget.TextView',resourceId:'dev.app:id/title',actions:[],bounds:{x:.074,y:.0526,width:.852,height:.0614},visible:true},
 {id:'e2',identity:'dev.app:id/btn_products|android.widget.Button|Produtos',name:'Produtos',text:'Produtos',role:'android.widget.Button',resourceId:'dev.app:id/btn_products',actions:['click'],bounds:{x:.074,y:.2193,width:.852,height:.0614},visible:true},
 {id:'e3',identity:'dev.app:id/pwd|android.widget.EditText|Senha',name:'Senha',text:'',role:'android.widget.EditText',resourceId:'dev.app:id/pwd',actions:['fill'],sensitive:true,bounds:{x:.074,y:.3,width:.852,height:.06},visible:true},
 {id:'e4',identity:'android.widget.FrameLayout:7|android.widget.FrameLayout|android.widget.FrameLayout',name:'android.widget.FrameLayout',role:'android.widget.FrameLayout',actions:[],bounds:{x:0,y:0,width:1,height:1},visible:true},
 {id:'e5',identity:'x',name:'Oculto',role:'android.widget.Button',actions:['click'],bounds:{x:0,y:1.2,width:.5,height:.05},visible:false}],
 xml:'<hierarchy>'.padEnd(5000,'x'),text:'Olá, Ana\nProdutos',help:{needs:[],hints:[]}};
test('the digest is a deterministic text graph with pixel positions, ids for actionable nodes and no layout noise',()=>{
 const lines=digest(observation).split('\n');
 assert.equal(lines[0],'screen=home state=ready route=dev.app/.MainActivity viewport=1080x2280 nodes=3');
 assert.equal(lines[1],'markers: ProgressBar');
 assert.equal(lines[2],'text "Olá, Ana" @80,120 920x140 #title');
 assert.equal(lines[3],'btn "Produtos" @80,500 920x140 #btn_products [click] id=e2');
 assert.equal(lines[4],'input "Senha" @80,684 920x137 #pwd [fill] secret id=e3');
 assert.equal(lines.length,5,'layout containers and offscreen nodes are omitted');
 assert.equal(digest(observation),digest(observation),'stable');
});
test('lean views drop XML, locators and identities but keep what is needed to act',()=>{
 const lean=leanObservation(observation);assert.equal(lean.xml,undefined);assert.ok(!JSON.stringify(lean).includes('identity'));assert.deepEqual(lean.candidates.map(c=>c.id),['e2','e3']);assert.deepEqual(compactElement(observation.elements[1]),{id:'e2',name:'Produtos',role:'Button',actions:['click'],box:[.074,.219,.852,.061],rid:'btn_products'});
 assert.ok(JSON.stringify(lean).length<JSON.stringify(observation).length/3);
 const graph={screens:[{id:'S',name:'Início'}],states:[{id:'st',screenId:'S',name:'ready'}]};
 const run={id:'r',objective:'x',mode:'exploratory',target:'android',status:'completed',startedAt:'t',metrics:{},frontier:[{status:'pending'},{status:'visited'}],observations:[{id:'a',screenId:'S',stateId:'st',elements:[{id:'e2',name:'Produtos'}],capturedAt:'t'},{id:'b',screenId:'S',stateId:'st',elements:[],capturedAt:'t'}],steps:[{action:{type:'click',elementId:'e2'},before:'a',after:'b',status:'completed',outcome:'none',network:[{method:'GET',path:'/api/x',status:200}]}]};
 const narrative=leanRun(run,graph);assert.deepEqual(narrative.steps,['01. [Início/ready] click "Produtos" → completed none [Início/ready] · api: GET /api/x 200']);assert.deepEqual(narrative.frontier,{pending:1,visited:1,skipped:0});assert.equal(narrative.current.digest.split('\n')[0].startsWith('screen='),true);
});
test('jpeg encoder writes a baseline JFIF stream with the right dimensions and shrinks flat images',()=>{
 const w=64,h=48,pixels=new Uint8Array(w*h*4);for(let i=0;i<w*h;i++){pixels[i*4]=200;pixels[i*4+1]=30;pixels[i*4+2]=30;pixels[i*4+3]=255;}
 const jpg=encodeJpeg({width:w,height:h,pixels},70);assert.equal(jpg.subarray(0,4).toString('hex'),'ffd8ffe0');assert.equal(jpg.subarray(-2).toString('hex'),'ffd9');
 const sof=jpg.indexOf(Buffer.from([0xff,0xc0]));assert.equal(jpg.readUInt16BE(sof+5),h);assert.equal(jpg.readUInt16BE(sof+7),w);assert.ok(jpg.length<w*h*4/8,'well under the raw size');
 assert.ok(encodeJpeg({width:w,height:h,pixels},30).length<=jpg.length,'lower quality is not larger');
});
