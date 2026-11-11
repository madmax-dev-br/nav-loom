import {decodePng} from './png.mjs';
/** Pixel comparison of two screenshots. Returns the normalized bounding box of what changed. */
export function imageDiff(beforePng,afterPng,{threshold=40,step=2}={}){
 let a,b;try{a=Buffer.isBuffer(beforePng)?decodePng(beforePng):beforePng;b=Buffer.isBuffer(afterPng)?decodePng(afterPng):afterPng;if(!a?.pixels||!b?.pixels)throw Error('Image unavailable');}catch(e){return {comparable:false,reason:e.message};}
 if(a.width!==b.width||a.height!==b.height)return {comparable:false,reason:'Different image sizes',changedRatio:1,region:{x:0,y:0,width:1,height:1}};
 let sampled=0,changed=0,minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;
 for(let y=0;y<a.height;y+=step)for(let x=0;x<a.width;x+=step){const o=(y*a.width+x)*4;sampled++;
  if(Math.abs(a.pixels[o]-b.pixels[o])>threshold||Math.abs(a.pixels[o+1]-b.pixels[o+1])>threshold||Math.abs(a.pixels[o+2]-b.pixels[o+2])>threshold){changed++;if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y;}}
 const ratio=sampled?changed/sampled:0;if(!changed)return {comparable:true,changedRatio:0,region:null};
 const pad=step;const region={x:Math.max(0,minX-pad)/a.width,y:Math.max(0,minY-pad)/a.height,width:Math.min(a.width,maxX-minX+2*pad+1)/a.width,height:Math.min(a.height,maxY-minY+2*pad+1)/a.height};
 return {comparable:true,changedRatio:Number(ratio.toFixed(4)),region:Object.fromEntries(Object.entries(region).map(([k,v])=>[k,Number(Math.min(1,v).toFixed(4))]))};
}
const lines=text=>new Set(String(text??'').split('\n').map(l=>l.trim()).filter(l=>l.length>1));
const names=elements=>new Map((elements??[]).map(e=>[e.identity,e.name||e.identity]));
/** Structural comparison of two observations: text, interactive elements, route and markers. */
export function observationDiff(before,after,limit=12){
 const beforeText=lines(before.text),afterText=lines(after.text),beforeElements=names(before.elements),afterElements=names(after.elements);
 const added=[...afterText].filter(l=>!beforeText.has(l)),removed=[...beforeText].filter(l=>!afterText.has(l));
 const elementsAdded=[...afterElements].filter(([id])=>!beforeElements.has(id)).map(([,name])=>name),elementsRemoved=[...beforeElements].filter(([id])=>!afterElements.has(id)).map(([,name])=>name);
 const markers=o=>(o.stateMarkers??[]).map(m=>Array.isArray(m)?m[0]:m).filter(Boolean);
 const markersAfter=markers(after),markersBefore=markers(before);
 return {routeChanged:before.route!==after.route,route:{before:before.route,after:after.route},headingChanged:(before.heading||'')!==(after.heading||''),heading:{before:before.heading||'',after:after.heading||''},
  textAdded:added.slice(0,limit),textRemoved:removed.slice(0,limit),textAddedCount:added.length,textRemovedCount:removed.length,
  elementsAdded:elementsAdded.slice(0,limit),elementsRemoved:elementsRemoved.slice(0,limit),elementsAddedCount:elementsAdded.length,elementsRemovedCount:elementsRemoved.length,
  markersAdded:markersAfter.filter(m=>!markersBefore.includes(m)),markersRemoved:markersBefore.filter(m=>!markersAfter.includes(m))};
}
/** Classify an interaction by its effect on identity: none, scroll, state or navigation. */
export function classifyOutcome(before,after,action){
 if(action?.type==='scroll')return 'scroll';if(before.screenId!==after.screenId)return 'navigation';if(before.stateId!==after.stateId)return 'state';return 'none';
}
const describeAction=(action,element)=>{const name=element?.name||action.elementIdentity?.split('|').pop()||'';
 switch(action?.type){case 'click':return name?`Toque em "${name}"`:'Toque na tela';case 'fill':return name?`Preenchimento de "${name}"`:'Preenchimento de campo';case 'scroll':return `Scroll para ${({up:'cima',down:'baixo',left:'a esquerda',right:'a direita'})[action.direction??'down']}`;case 'back':return 'Voltar';case 'deeplink':return `Deeplink ${action.url??''}`.trim();case 'wait':return `Espera de ${action.durationMs??300} ms`;case 'open':return 'Abertura do app';default:return 'Interação';}};
/** Deterministic, evidence-grounded summary in Portuguese. Agent descriptions are stored separately. */
export function summarizeTransition({action,element,outcome,fromScreen,toScreen,toState,diff,imageChange,network=[]}){
 const parts=[describeAction(action,element)];
 const screen=toScreen?.name||'tela';
 if(outcome==='navigation')parts.push(`abre a tela "${screen}"${toScreen?.route&&toScreen.route!==fromScreen?.route?` (${toScreen.route})`:''}.`);
 else if(outcome==='state')parts.push(`muda o estado da tela "${fromScreen?.name||screen}"${toState?.name?` para "${toState.name}"`:''}.`);
 else if(outcome==='scroll')parts.push(`rola a tela "${fromScreen?.name||screen}" mantendo o mesmo estado.`);
 else parts.push('não altera a tela observada.');
 const details=[];
 if(diff?.markersAdded?.length)details.push(`Surgiu ${diff.markersAdded.map(m=>m==='dialog'?'um diálogo':m==='alert'?'um alerta':`um elemento "${m}"`).join(' e ')}.`);
 if(diff?.textAdded?.length)details.push(`Texto novo: ${diff.textAdded.slice(0,3).map(t=>`"${t.slice(0,60)}"`).join(', ')}${diff.textAddedCount>3?` e mais ${diff.textAddedCount-3}`:''}.`);
 if(diff?.elementsAdded?.length)details.push(`Novas ações disponíveis: ${diff.elementsAdded.slice(0,4).map(n=>`"${String(n).slice(0,40)}"`).join(', ')}.`);
 if(network.length){const calls=network.slice(0,4).map(c=>{const status=c.statuses?.length?c.statuses.join('/'):c.status;return `${c.method} ${c.path}${status?` (${status})`:''}`;});details.push(`${network.length} chamada${network.length>1?'s':''} de API: ${calls.join(', ')}${network.length>4?' …':''}.`);}
 if(imageChange?.comparable&&imageChange.changedRatio>0)details.push(`Cerca de ${Math.max(1,Math.round(imageChange.changedRatio*100))}% da imagem mudou.`);
 return [parts.join(' '),...details].join(' ');
}
