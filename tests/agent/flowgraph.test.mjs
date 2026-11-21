import test from 'node:test';
import assert from 'node:assert/strict';
import {dominators,entryPoints,flowTree} from '../../agent/flowgraph.mjs';
import {planRoute} from '../../agent/graph.mjs';

test('dominators: the screens every way to a screen goes through',()=>{
 // login → home; home → list | fav; list → detail; fav → detail; detail → cart → pay → receipt; home → pix → confirm
 const g=new Map(Object.entries({login:['home'],home:['list','fav','pix'],list:['detail'],fav:['detail'],detail:['cart'],cart:['pay'],pay:['receipt'],pix:['confirm']}).map(([k,v])=>[k,new Set(v)]));
 const idom=dominators('login',g);
 assert.equal(idom.get('detail'),'home','reached from the list and from favourites: only home is on every way');
 assert.equal(idom.get('receipt'),'pay');assert.equal(idom.get('pay'),'cart');assert.equal(idom.get('confirm'),'pix');assert.equal(idom.get('home'),'login');});

const edge=(id,from,to,name,extra={})=>({id,from,to,name,confirmed:true,target:'app',profile:'default',preconditions:{},action:{type:'click',elementIdentity:name},evidence:[{}],apis:[],cost:1,...extra});
const graph=()=>({screens:['Login','Home','List','Detail','Cart','Receipt'].map(n=>({id:n,name:n,target:'app'})),states:['Login','Home','List','Detail','Cart','Receipt'].map(n=>({id:n+'-s',screenId:n})),entries:{app:'Login-s'},flows:[],deeplinks:[],
 transitions:[edge('a','Login-s','Home-s','Entrar'),edge('b','Home-s','List-s','Produtos'),edge('c','List-s','Detail-s','Ver'),edge('d','Detail-s','Cart-s','Adicionar',{apis:[{method:'POST',path:'/api/cart',statuses:[201]}]}),edge('e','Cart-s','Receipt-s','Pagar')]});

test('entry points carry the must-pass screens and the flow tree, leaving out what every walk passes',()=>{
 const points=entryPoints(graph(),{target:'app'}),receipt=Object.values(points.screens).find(s=>s.name==='Receipt');
 assert.deepEqual(receipt.start.default.path,['Login','Home','List','Detail','Cart','Receipt']);assert.deepEqual(receipt.mustPass,['List','Detail','Cart'],'Login and Home are on every walk');
 assert.deepEqual(receipt.start.default.writes,['POST /api/cart']);
 assert.deepEqual(flowTree(points),['- Login','  - Home','    - List','      - Detail','        - Cart','          - Receipt']);});

test('nearest frontier: one search to every state with pending candidates picks the cheapest',()=>{
 const g=graph(),plan=planRoute(g,{from:'Home-s',to:new Set(['Receipt-s','List-s']),target:'app',profile:'default',allowUnverifiedVersion:true});
 assert.equal(plan.found,true);assert.equal(plan.to,'List-s','one tap away beats four');assert.deepEqual(plan.steps,['b']);});
