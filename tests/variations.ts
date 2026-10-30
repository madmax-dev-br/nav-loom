import assert from 'node:assert/strict';
import {demo,flowSchema,readFlow,writeFlow,problems} from '../lib/flow';
import {conditionsMatch,variationFor,effectiveVariant,actionArea,actionAvailable,isWholeScreen} from '../lib/variations';
import {tapOrigin} from '../lib/connector-geometry';
const f=structuredClone(demo),base=f.screens[0].variants.web;
base.variations=[{id:'empty',name:'Empty',when:{empty:true,count:0},screenshot:'/empty.png',apis:[],sources:[{path:'web/empty.ts',status:'changed'}]},{id:'fallback',name:'Fallback',when:{empty:true},screenshot:'/fallback.png'}];
assert.equal(conditionsMatch({empty:true},{empty:'true'}),false);
assert.equal(conditionsMatch({count:0},{}),false);
assert.equal(conditionsMatch({value:null},{value:null}),true);
assert.equal(variationFor(base,{empty:true,count:0}),'empty');
assert.equal(variationFor(base,{empty:true}),'fallback');
assert.equal(variationFor(base,{}),'default');
assert.equal(variationFor(base,{empty:true,count:0},'default'),'default');
assert.equal(variationFor(base,{},'empty'),'empty');
assert.equal(effectiveVariant(base,'empty').apis.length,0);
assert.equal(effectiveVariant(base,'empty').tests,base.tests);
const a=f.actions[0];a.variants.web.fromVariation='empty';a.variants.web.when={enabled:true};a.variants.web.areas={empty:{x:.2,y:.3,width:.1,height:.1}};
assert.equal(actionAvailable(a,'web','empty',{enabled:true}),true);
assert.equal(actionAvailable(a,'web','default',{enabled:true}),false);
assert.equal(actionAvailable(a,'web','empty',{}),false);
assert.equal(actionArea(a,'web','empty')?.x,.2);
assert.deepEqual(actionArea(a,'web','default'),a.variants.web.area);
assert.deepEqual(tapOrigin({x:10,y:20,width:200,height:400},a.variants.web.areas.empty),{x:60,y:160});
assert.equal(flowSchema.safeParse(f).success,true);
assert.equal(problems(f).some(p=>p.message.includes('web/empty.ts')),true);
assert.deepEqual(readFlow(writeFlow(f)),f);
a.variants.web.toVariation='missing';assert.equal(flowSchema.safeParse(f).success,false);
assert.equal(flowSchema.safeParse(demo).success,true);
console.log('Conditional variations, branching, evidence, YAML compatibility, and tap geometry passed.');
import {detectBorders} from '../lib/image-borders';
import {writeGroupFile,readGroupFile} from '../lib/group-files';
const pixels=new Uint8ClampedArray(120*200*4).fill(255);
for(let y=90;y<120;y++)for(let x=20;x<100;x++){const i=(y*120+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=30;}
const borders=detectBorders(pixels,120,200);
assert.ok(borders.some(b=>Math.abs(b.x-20/120)<.03&&Math.abs(b.y-90/200)<.02&&Math.abs(b.width-80/120)<.04));
assert.equal(detectBorders(new Uint8ClampedArray(120*200*4).fill(255),120,200).length,0);
const grouped={...demo,group:'Commerce/Checkout'};
assert.deepEqual(readGroupFile(writeGroupFile(grouped.project,grouped.group,[grouped])).flows[0],grouped);
assert.throws(()=>writeGroupFile(demo.project,'../outside',[grouped]));
assert.throws(()=>writeGroupFile(demo.project,'Different',[grouped]));
console.log('Detected borders, nested groups, and separate group-file round trips passed.');

assert.equal(isWholeScreen({x:0,y:0,width:1,height:1}),true);
assert.equal(isWholeScreen({x:.1,y:0,width:.9,height:1}),false);
assert.equal(isWholeScreen(undefined),false);
for(const type of ['tap','internal','deeplink','custom'] as const){
 const flow=structuredClone(demo);flow.actions[0].type=type;flow.actions[0].variants.web.area={x:0,y:0,width:1,height:1};
 assert.equal(flowSchema.safeParse(flow).success,true);
 assert.equal(isWholeScreen(actionArea(readFlow(writeFlow(flow)).actions[0],'web','default')),true);
}
console.log('All action types preserve whole-screen targets through YAML.');

const subtle=new Uint8ClampedArray(120*200*4).fill(255);
for(let y=50;y<90;y++)for(let x=20;x<100;x++){const i=(y*120+x)*4;subtle[i]=subtle[i+1]=subtle[i+2]=244;}
assert.ok(detectBorders(subtle,120,200).some(b=>Math.abs(b.y-.25)<.03&&Math.abs(b.height-.2)<.04));
console.log('Low-contrast internal screenshot regions are detected.');
