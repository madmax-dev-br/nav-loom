import http from 'node:http';
import {pathToFileURL} from 'node:url';
const products=[
 {id:'tote',name:'Bolsa Everyday',category:'Acessórios',price:12990,description:'Bolsa resistente com espaço para acompanhar seu dia. Algodão reciclado, alças confortáveis e bolso interno.',stock:8,emoji:'👜'},
 {id:'headphones',name:'Fone sem fio',category:'Tecnologia',price:24990,description:'Som confortável para ouvir música no trabalho ou no caminho. Bateria de até 20 horas e estojo compacto.',stock:5,emoji:'🎧'},
 {id:'bottle',name:'Garrafa térmica',category:'Casa',price:8990,description:'Sua bebida na temperatura ideal. Aço inoxidável, capacidade de 600 ml e tampa vedada.',stock:12,emoji:'🥤'},
 {id:'lamp',name:'Luminária de mesa',category:'Casa',price:15990,description:'Luz suave para ler e trabalhar. Três intensidades e base de madeira.',stock:0,emoji:'💡'},
 {id:'backpack',name:'Mochila leve',category:'Acessórios',price:19990,description:'Mochila para a rotina com compartimento de notebook e tecido resistente à água.',stock:4,emoji:'🎒'},
 {id:'notebook',name:'Caderno pontilhado',category:'Papelaria',price:3990,description:'Ideias ganham espaço em 160 páginas de papel sustentável.',stock:20,emoji:'📓'},
];
const seedUser=()=>({id:'user-demo',name:'Ana Teste',email:'ana@navloom.test',password:'Teste123!',balance:150000,favorites:['bottle'],cart:[],orders:[],transfers:[],limitRequests:[],card:{id:'card-demo',name:'Navloom Platinum',last4:'4242',limit:300000,used:42000,status:'active'}});
const fault=(status,message)=>Object.assign(new Error(message),{status});
const cents=(v,min=1)=>{if(!Number.isInteger(v)||v<min||v>100000000)throw fault(400,'Informe um valor válido em centavos.');return v;};
export function createMockServer(){
 let users,sessions,sequence,controls,requestLog;
 const reset=()=>{users=[seedUser()];sessions=new Map();sequence=0;controls={delayMs:350,failNext:[],paymentDeclined:false,pixUnavailable:false,limitRejected:false,catalogUnavailable:false};requestLog=[];};reset();
 const newId=prefix=>`${prefix}-${String(++sequence).padStart(4,'0')}`;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  let body={};const path=new URL(req.url,'http://localhost').pathname,method=req.method,key=`${method} ${path}`;
  try{
   let text='';for await(const chunk of req){text+=chunk;if(text.length>100000)throw fault(413,'Payload too large');}if(text)try{body=JSON.parse(text);}catch{throw fault(400,'Invalid JSON');}
   const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
   if(path==='/health')return send(200,{ok:true,service:'navloom-local-mock',build:'1.0.0'});
   if(path==='/__admin/reset'&&method==='POST'){reset();return send(200,{ok:true,account:{email:'ana@navloom.test',password:'Teste123!'}});}
   if(path==='/__admin/scenario'&&method==='POST'){for(const field of ['paymentDeclined','pixUnavailable','limitRejected','catalogUnavailable'])if(typeof body[field]==='boolean')controls[field]=body[field];if(Number.isInteger(body.delayMs)&&body.delayMs>=0&&body.delayMs<=10000)controls.delayMs=body.delayMs;if(body.failNext){if(!Array.isArray(body.failNext)||body.failNext.some(x=>!x.match(/^(GET|POST|PUT|DELETE) \/api\//)))throw fault(400,'failNext must contain METHOD /api/path');controls.failNext=body.failNext;}return send(200,{...controls});}
   if(path==='/__admin/state')return send(200,{controls,requestLog,users:users.map(({password,...u})=>u)});
   requestLog.push({sequence:requestLog.length+1,method,path});if(requestLog.length>500)requestLog.shift();
   await new Promise(r=>setTimeout(r,controls.delayMs));
   const failIndex=controls.failNext.indexOf(key);if(failIndex>=0){controls.failNext.splice(failIndex,1);throw fault(503,'Falha de teste. Tente novamente.');}
   if(path==='/api/auth/register'&&method==='POST'){const name=String(body.name??'').trim(),email=String(body.email??'').trim().toLowerCase(),password=String(body.password??'');if(name.length<2||!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)||password.length<8)throw fault(400,'Preencha nome, e-mail e senha com pelo menos 8 caracteres.');if(users.some(u=>u.email===email))throw fault(409,'Este e-mail já tem uma conta.');const u={...seedUser(),id:newId('user'),name,email,password,favorites:[]};users.push(u);const token=newId('session');sessions.set(token,u.id);return send(201,{token,name:u.name});}
   if(path==='/api/auth/login'&&method==='POST'){const u=users.find(u=>u.email===String(body.email??'').trim().toLowerCase()&&u.password===body.password);if(!u)throw fault(401,'E-mail ou senha incorretos.');const token=newId('session');sessions.set(token,u.id);return send(200,{token,name:u.name});}
   const uid=sessions.get(req.headers.authorization?.replace(/^Bearer /,''));const u=users.find(u=>u.id===uid);if(!u)throw fault(401,'Entre na sua conta para continuar.');
   const items=()=>u.cart.map(item=>({...products.find(p=>p.id===item.productId),quantity:item.quantity}));
   const cart=()=>({items:items(),total:items().reduce((sum,p)=>sum+p.price*p.quantity,0)});
   if(path==='/api/auth/logout'&&method==='POST'){sessions.delete(req.headers.authorization?.slice(7));return send(200,{ok:true});}
   if(path==='/api/home')return send(200,{name:u.name,balance:u.balance,cartCount:u.cart.reduce((n,p)=>n+p.quantity,0),favoriteCount:u.favorites.length,card:u.card,recentTransfers:u.transfers.slice(-3).reverse()});
   if(path==='/api/products'){if(controls.catalogUnavailable)throw fault(503,'O catálogo está temporariamente indisponível.');return send(200,{items:products.map(p=>({...p,favorite:u.favorites.includes(p.id)}))});}
   if(path.startsWith('/api/products/')){const p=products.find(p=>p.id===path.split('/').at(-1));if(!p)throw fault(404,'Produto não encontrado.');return send(200,{...p,favorite:u.favorites.includes(p.id)});}
   if(path==='/api/favorites')return send(200,{items:products.filter(p=>u.favorites.includes(p.id)).map(p=>({...p,favorite:true}))});
   if(path.startsWith('/api/favorites/')&&['POST','DELETE'].includes(method)){const pid=path.split('/').at(-1);if(!products.some(p=>p.id===pid))throw fault(404,'Produto não encontrado.');u.favorites=method==='POST'?[...new Set([...u.favorites,pid])]:u.favorites.filter(x=>x!==pid);return send(200,{ok:true,favorite:method==='POST'});}
   if(path==='/api/cart'&&method==='GET')return send(200,cart());
   if(path==='/api/cart/items'&&method==='POST'){const p=products.find(p=>p.id===body.productId);if(!p)throw fault(404,'Produto não encontrado.');const quantity=cents(body.quantity??1);const item=u.cart.find(x=>x.productId===p.id),next=(item?.quantity??0)+quantity;if(next>p.stock)throw fault(409,'Produto sem estoque suficiente.');if(item)item.quantity=next;else u.cart.push({productId:p.id,quantity});return send(200,cart());}
   if(path.startsWith('/api/cart/items/')&&method==='DELETE'){u.cart=u.cart.filter(p=>p.productId!==path.split('/').at(-1));return send(200,cart());}
   if(path==='/api/checkout'&&method==='POST'){const snapshot=cart();if(!snapshot.items.length)throw fault(400,'Seu carrinho está vazio.');if(controls.paymentDeclined)throw fault(402,'Pagamento recusado. Seu carrinho foi mantido.');if(snapshot.total>u.card.limit-u.card.used)throw fault(402,'Limite insuficiente.');u.card.used+=snapshot.total;const receipt={id:newId('order'),kind:'purchase',title:'Compra confirmada',amount:snapshot.total,items:snapshot.items,recipient:'Navloom Loja',createdAt:new Date().toISOString(),status:'completed',payment:'Cartão final 4242'};u.orders.push(receipt);u.cart=[];return send(201,receipt);}
   if(path==='/api/pix')return send(200,{balance:u.balance,recent:u.transfers.slice().reverse(),demoKey:'bruno@pix.test'});
   if(path==='/api/pix/recipient'&&method==='POST'){if(!String(body.key??'').match(/^[^\s]{3,100}$/))throw fault(400,'Informe uma chave Pix válida.');return send(200,{key:body.key,name:body.key==='bruno@pix.test'?'Bruno Demo':'Destinatário de teste',bank:'Banco Local',document:'***.456.789-**'});}
   if(path==='/api/pix/transfers'&&method==='POST'){const amount=cents(body.amount);if(!String(body.key??'').match(/^[^\s]{3,100}$/))throw fault(400,'Chave Pix inválida.');if(controls.pixUnavailable)throw fault(503,'Pix indisponível. Nenhum valor foi transferido.');if(amount>u.balance)throw fault(409,'Saldo insuficiente.');u.balance-=amount;const receipt={id:newId('pix'),kind:'pix',title:'Pix enviado',amount,recipient:body.key==='bruno@pix.test'?'Bruno Demo':'Destinatário de teste',key:body.key,createdAt:new Date().toISOString(),status:'completed',description:String(body.description??'')};u.transfers.push(receipt);return send(201,receipt);}
   if(path==='/api/cards')return send(200,{items:[u.card],requests:u.limitRequests.slice().reverse()});
   if(path==='/api/cards/card-demo/limit'&&method==='POST'){const requested=cents(body.limit);if(requested<=u.card.limit)throw fault(400,'O novo limite deve ser maior que o atual.');const accepted=!controls.limitRejected&&requested<=1000000;const receipt={id:newId('limit'),kind:'limit',title:accepted?'Limite aprovado':'Solicitação não aprovada',amount:requested,recipient:u.card.name,createdAt:new Date().toISOString(),status:accepted?'approved':'rejected',previousLimit:u.card.limit};u.limitRequests.push(receipt);if(accepted)u.card.limit=requested;return send(200,receipt);}
   if(path.startsWith('/api/receipts/')){const receipt=[...u.orders,...u.transfers,...u.limitRequests].find(r=>r.id===path.split('/').at(-1));if(!receipt)throw fault(404,'Comprovante não encontrado.');return send(200,receipt);}
   throw fault(404,'Endpoint não encontrado.');
  }catch(e){res.statusCode=e.status??500;res.end(JSON.stringify({error:e.message}));}
 });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PORT??4791);createMockServer().listen(port,'127.0.0.1',()=>console.log(`Navloom mock: http://127.0.0.1:${port} (local only)`));}
