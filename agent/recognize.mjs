import {hash} from './store.mjs';
/**
 * Screen recognition for apps that declare no screen id (no `navloom:screen` tag, no fragment, no learned script).
 *
 * The same screen comes back with other content: another product, a balance that changed, the title scrolled away,
 * the keyboard covering half of it. An exact hash of what is on view calls each of those a new screen, and the map
 * falls apart into disconnected pieces. Instead every screen keeps a profile: the tokens its captures had (resource
 * ids, the header, control labels, field names, static texts) and how often each one appeared. A capture is compared
 * with every profile. Tokens count by kind (a control says more than a line of text), by how steady they are on that
 * screen (a product name that changes every visit counts for little) and by how rare they are among screens (the tab
 * bar and the app's brand line are everywhere, so they tell nothing apart). What the navigation itself says is
 * added on top: scrolling never changes the screen, typing rarely does, and an action taken before from the same
 * place most likely lands where it landed then.
 */
const GENERIC_ID=/^(content|statusBarBackground|navigationBarBackground|action_bar_root|decor_content_parent|parentPanel|contentPanel|custom|customPanel|topPanel|buttonPanel|list|text1|text2|icon|title_template|alertTitle)$/;
const CLASS_NAME=/^[a-z][\w]*(\.[\w$]+)+$/;
/** Text with its volatile parts replaced: amounts, e-mails, numbers. `Carrinho (3)` and `Carrinho (0)` read the same. */
export const norm=text=>String(text??'').normalize('NFKC').toLowerCase()
 .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g,'@')
 .replace(/(r\$|us\$|\$|€|£)\s*[\d.,]+/g,'$')
 .replace(/\d+([.,:/-]\d+)*/g,'#')
 .replace(/\s+/g,' ').trim();
const meaningful=text=>/[\p{L}\p{So}]/u.test(text);
/** The first word of a title of several words: `olá, ana` and `olá, bruno` are the same greeting with another name. */
const headLead=header=>{const words=header.split(/[\s,.:!?·|-]+/).filter(Boolean);return words.length>1&&words[0].length>=3?words[0]:null;};
const tail=id=>id?String(id).split('/').pop():'';
/** Weight of one token by its kind. */
export const kindWeight=token=>({h:4,H:2,n:3,i:3,p:3,f:2.5,c:2,s:1,d:1,t:1,T:.5,k:.6,b:.3})[token[0]]??1;
/** How steady a token is expected to be before it has been seen often: controls and ids stay, texts are often data. */
const PRIOR={h:.9,H:.9,n:.9,i:.9,p:.9,f:.9,c:.85,s:.8,k:.9,b:.6,d:.5,t:.35,T:.25};
const SEMANTIC=[
 ['error',/\b(erro|error|falha|failed|failure|inválid|invalid|incorret|não foi possível|nao foi possivel|tente novamente|try again|recusad|negad|denied|rejected|rejeitad|indisponível|unavailable)/i],
 ['empty',/\b(nenhum|nenhuma|vazio|vazia|empty|no results|sem resultados|sem itens|nothing here)/i],
 ['success',/\b(sucesso|success|concluíd|concluid|aprovad|approved|confirmad|confirmed|realizad[ao] com)/i],
 ['loading',/\b(carregando|loading|aguarde|please wait)\b/i],
];
/** What kind of moment the screen is in, read from what it shows: loading, an error, nothing to show, a confirmation, a dialog. */
export function semanticMarkers(observation){
 const out=new Set(),texts=(observation.elements??[]).filter(e=>e.visible!==false&&!e.actions?.length&&(e.text||e.contentDescription)&&!/^navloom:/.test(e.contentDescription??''));
 // "Nothing here" or "done" only describe the screen when they are its headline: the largest type or the title, not a section note.
 const heights=texts.map(e=>e.bounds?.height??0).filter(Boolean).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)]??0,header=norm(observation.header);
 const prominent=e=>(header&&norm(e.text)===header)||(String(e.text??e.contentDescription).length<=48&&(e.bounds?.height??0)>=median*1.3);
 for(const e of observation.elements??[]){if(e.visible===false)continue;if(/ProgressBar|ProgressIndicator/i.test(e.role??''))out.add('loading');if(/Dialog|AlertDialog/i.test(e.role??''))out.add('dialog');}
 for(const e of texts){const text=e.text||e.contentDescription;for(const [marker,pattern] of SEMANTIC)if(pattern.test(text)&&(['error','loading'].includes(marker)||prominent(e)))out.add(marker);}
 if(observation.overlay)out.add('dialog');
 return [...out].sort();
}
/** A label a control is known by, never its value: a field is named by its id, hint or description, not by what was typed into it. */
function controlTokens(e,fieldIndex){
 const rid=tail(e.resourceId),out=[];
 if(e.actions?.includes('fill')){out.push('f:'+(rid&&!GENERIC_ID.test(rid)?rid:norm(e.hint||e.contentDescription)||`#${fieldIndex}`));return out;}
 // A row without text of its own is labelled by its children (`label`); a bare class name says nothing.
 const raw=e.contentDescription||e.text||e.label||e.name||'',short=String(e.role??'').split('.').pop(),label=CLASS_NAME.test(raw)||raw===short?'':norm(raw);
 if(e.actions?.includes('click')){if(rid&&!GENERIC_ID.test(rid))out.push('i:'+rid);if(label&&meaningful(label))out.push('c:'+label.slice(0,40));}
 if(e.actions?.includes('scroll'))out.push('s:'+(rid&&!GENERIC_ID.test(rid)?rid:String(e.role??'').split('.').pop()));
 return out;
}
/** An element in the bands where apps put their frame: the top bar and the tab bar. Large containers are not. */
const isChrome=e=>{const b=e.bounds;if(!b||b.height>.16)return false;const middle=b.y+b.height/2;return middle<.12||middle>.9;};
/** Tokens of one capture. Returned as a set; the weight comes from the token kind. */
export function tokensOf(observation){
 const tokens=new Set();let fields=0;
 const header=norm(observation.header);if(header&&meaningful(header)){tokens.add('h:'+header.slice(0,40));const lead=headLead(header);if(lead)tokens.add('H:'+lead);}
 // On the web the path says a lot, once its ids are taken out (`/produto/42` and `/produto/7` are the same page).
 if(observation.platform!=='android'&&String(observation.route??'').startsWith('/'))tokens.add('p:'+norm(String(observation.route).split(/[?#]/)[0]).replace(/\/[0-9a-f-]{8,}/g,'/#'));
 for(const e of observation.elements??[]){
  if(e.visible===false)continue;
  // The app's frame (top bar, tab bar) is on every screen: it says little about which one this is.
  const chrome=isChrome(e);
  if(e.actions?.length){for(const t of controlTokens(e,e.actions.includes('fill')?fields++:0))tokens.add(chrome&&t[0]!=='f'?'k:'+t:t);continue;}
  const rid=tail(e.resourceId);if(rid&&!GENERIC_ID.test(rid)&&!/^navloom/.test(rid))tokens.add(chrome?'k:i:'+rid:'i:'+rid);
  if(e.text){const text=norm(e.text);if(text&&meaningful(text)&&!(chrome&&text===header))tokens.add(chrome?'b:'+text.slice(0,40):(text.length>40?'T:':'t:')+text.slice(0,40));}
  else if(e.contentDescription&&!/^navloom:/.test(e.contentDescription)){const text=norm(e.contentDescription);if(text&&meaningful(text))tokens.add((chrome?'b:':'d:')+text.slice(0,40));}
 }
 const section=selectedTab(observation);if(section)tokens.add('n:'+section);
 return tokens;
}
/**
 * The section of the app on view: the tab marked selected in the tab bar, or the one tab that is not clickable among
 * tabs that are (apps disable the tab you are on). Two lists that look the same are told apart by it.
 */
export function selectedTab(observation){
 const label=e=>{const raw=e.label||e.contentDescription||e.text||'';return CLASS_NAME.test(raw)||raw===String(e.role??'').split('.').pop()?'':norm(raw);};
 const bar=(observation.elements??[]).filter(e=>e.visible!==false&&e.bounds&&e.bounds.height<=.12&&e.bounds.width<=.5&&e.bounds.width>=.08&&(e.bounds.y+e.bounds.height/2)>.88&&meaningful(label(e)));
 const marked=bar.find(e=>e.selected);if(marked)return label(marked).slice(0,40);
 const tabs=bar.filter(e=>!e.text||e.actions?.length),clickable=tabs.filter(e=>e.actions?.includes('click')),still=[...new Map(tabs.filter(e=>!e.actions?.length).map(e=>[label(e),e])).values()];
 if(clickable.length<2||still.length!==1)return null;
 const [one]=still,size=e=>[e.bounds.width,e.bounds.height],[w,h]=size(one);
 return clickable.every(e=>Math.abs(e.bounds.width-w)<=w*.25&&Math.abs(e.bounds.height-h)<=h*.25)?label(one).slice(0,40):null;
}
/** The controls a state offers, which is what tells one state of a screen from another; texts and list contents are left out. */
export function controlsOf(observation){const out=new Set();let fields=0;for(const e of observation.elements??[]){if(e.visible===false||!e.actions?.length||e.disabled)continue;for(const t of controlTokens(e,e.actions.includes('fill')?fields++:0))out.add(t);}return out;}
/** Controls of a recorded state, for maps saved before states kept their own profile. */
export function controlsOfHotspots(hotspots=[]){return controlsOf({elements:hotspots.map(h=>({...h,label:h.label??h.name,text:h.text,visible:true}))});}
/** A key that changes only when the structure changes (controls, moment, keyboard), not when a text or list content does. */
export function structureKey(observation){if(observation.stateKey)return hash(['explicit',observation.screenKey??null,observation.stateKey,!!observation.keyboard]);return hash([[...controlsOf(observation)].sort(),semanticMarkers(observation),!!observation.keyboard,!!observation.overlay]);}

/** Add a capture to a profile: `{n, tokens:{token: times seen}}`. Rare tokens of a large profile are dropped so it stays small. */
export function learn(profile,tokens,{limit=400}={}){
 const out=profile?{n:profile.n,tokens:{...profile.tokens}}:{n:0,tokens:{}};out.n++;
 for(const t of tokens)out.tokens[t]=(out.tokens[t]??0)+1;
 const entries=Object.entries(out.tokens);if(entries.length>limit){entries.sort((a,b)=>b[1]-a[1]);out.tokens=Object.fromEntries(entries.slice(0,limit));}
 return out;
}
export function mergeProfiles(a,b){if(!a)return b?structuredClone(b):null;if(!b)return structuredClone(a);const out={n:a.n+b.n,tokens:{...a.tokens}};for(const [t,c] of Object.entries(b.tokens))out.tokens[t]=(out.tokens[t]??0)+c;return out;}
/** How steady a token is on a profile: seen in every capture → 1. A profile of one capture trusts everything it saw. */
const steady=(profile,token)=>{const prior=PRIOR[token[0]]??.5;return Math.min(1,((profile.tokens[token]??0)+prior)/(profile.n+1));};
/** Inverse document frequency over the screens: a token every screen shows weighs little. */
export function rarity(profiles){
 const df=new Map();let n=0;
 for(const p of profiles){if(!p?.n)continue;n++;for(const [t,c] of Object.entries(p.tokens))if(c/p.n>=.5)df.set(t,(df.get(t)??0)+1);}
 return token=>n<2?1:Math.log(1+n/(1+(df.get(token)??0)))/Math.log(1+n);
}
/**
 * How much a capture looks like a profile, 0..1. Recall says how much of what the screen always shows is on view;
 * precision says how much of what is on view belongs to the screen. Recall weighs more: content that changes
 * (another product) lowers precision, while the screen's own frame keeps recall high.
 */
export function similarity(tokens,profile,idf=()=>1){
 if(!profile?.n)return {score:0,recall:0,precision:0};
 let expected=0,found=0;for(const t of Object.keys(profile.tokens)){const w=kindWeight(t)*idf(t)*steady(profile,t);expected+=w;if(tokens.has(t))found+=w;}
 let seen=0,known=0;for(const t of tokens){const w=kindWeight(t)*idf(t);seen+=w;if(profile.tokens[t])known+=w*Math.max(.35,steady(profile,t));}
 const recall=expected?found/expected:0,precision=seen?known/seen:0;
 // What can be done on a screen defines it more than what it says. A capture that lacks most of the screen's steady
 // controls and brings controls of its own is another screen showing the same data (a card, then the form to raise its limit).
 const control=t=>'cfi'.includes(t[0]);let mine=0,kept=0,offered=0,novel=0;
 for(const t of Object.keys(profile.tokens)){if(!control(t))continue;const w=kindWeight(t)*idf(t)*steady(profile,t);if(steady(profile,t)<.5)continue;mine+=w;if(tokens.has(t))kept+=w;}
 for(const t of tokens){if(!control(t))continue;const w=kindWeight(t)*idf(t);offered+=w;if(!profile.tokens[t])novel+=w;}
 const controls=mine?kept/mine:1,fresh=offered?novel/offered:0,penalty=controls<.5&&fresh>.4?.15:0;
 return {score:.6*recall+.4*precision-penalty,recall,precision,controls,fresh};
}
/** The Android activity on display, a hard boundary between screens. Unknown while none is resumed; never a web path. */
export const activityOf=observation=>observation.activity!==undefined?observation.activity:observation.platform==='android'&&String(observation.route??'').includes('/')?observation.route:null;
/**
 * Which known screen a capture belongs to. `context` is what the navigation says:
 * - `scrolledFrom`: the capture right before a scroll; scrolling keeps the screen.
 * - `previous` and `action`: where the action started; typing and waiting rarely leave the screen, `back` returns.
 * - `expected`: screen ids an identical action from the same state has led to before.
 * - `trail`: screen ids visited in this mission, newest last.
 * Returns the chosen screen (or null for a new one), the score and the runners-up, so the agent can see how sure it is.
 */
export const SAME=.6,SIMILAR=.4;
export function recognizeScreen(graph,observation,{target,tokens=tokensOf(observation),previous,action,scrolledFrom,expected=[],trail=[]}={}){
 const pool=graph.screens.filter(s=>s.target===target&&s.profile?.n&&!s.mergedInto);
 if(scrolledFrom){const screen=graph.screens.find(s=>s.id===scrolledFrom.screenId);if(screen)return {screen,how:'scroll',score:1,candidates:[]};}
 // A dialog or menu drawn over the screen belongs to the screen beneath it.
 if(observation.overlay&&previous){const screen=graph.screens.find(s=>s.id===previous.screenId);if(screen)return {screen,how:'overlay',score:1,candidates:[]};}
 const idf=rarity(pool.map(s=>s.profile)),activity=activityOf(observation),scores=[];
 for(const screen of pool){
  const known=screen.activity??null;if(activity&&known&&known!==activity)continue;
  const s=similarity(tokens,screen.profile,idf);let score=s.score;const why=[];
  // A title that matches is strong evidence. A different one where the screen always had the same title counts against it,
  // but is not proof on its own (titles scroll away, a greeting carries the account's name).
  const header=norm(observation.header),own=steadyHeader(screen.profile);if(header&&screen.profile.tokens['h:'+header.slice(0,40)]){score+=.12;why.push('header');}else if(header&&own&&own!==header.slice(0,40)&&!(headLead(header)&&headLead(header)===headLead(own)))score-=.1;
  if(previous?.screenId===screen.id){const stay=['fill','wait','scroll'].includes(action?.type)?.25:action?.type==='click'?.04:0;if(stay){score+=stay;why.push('same place');}}
  if(action?.type==='back'&&trail.at(-2)===screen.id){score+=.1;why.push('back');}
  if(expected.includes(screen.id)){score+=.12;why.push('known action');}
  scores.push({screen,score:Math.min(1,score),recall:s.recall,precision:s.precision,why});
 }
 scores.sort((a,b)=>b.score-a.score);
 const best=scores[0],second=scores[1],candidates=scores.slice(0,3).filter(c=>c.score>=SIMILAR).map(c=>({screenId:c.screen.id,name:c.screen.name,score:round(c.score)}));
 if(best&&best.score>=SAME&&(!second||best.score-second.score>=.05||best.screen.id===previous?.screenId))return {screen:best.screen,how:'similar',score:round(best.score),why:best.why,candidates};
 return {screen:null,how:'new',score:best?round(best.score):0,candidates};
}
const round=v=>Math.round(v*100)/100;
/** The title a screen shows nearly every time, if it has one. */
function steadyHeader(profile){let best=null;for(const [t,c] of Object.entries(profile.tokens))if(t.startsWith('h:')&&c/profile.n>=.7&&(!best||c>best[1]))best=[t,c];return best?best[0].slice(2):null;}
/** Which known state of a screen a capture is in: same moment (markers), same keyboard, about the same controls. */
export function recognizeState(graph,screenId,observation,{controls=controlsOf(observation),markers=semanticMarkers(observation)}={}){
 const pool=graph.states.filter(s=>s.screenId===screenId&&!s.scrollOf&&!s.mergedInto&&!!s.keyboard===!!observation.keyboard&&!s.stateKey);
 let best=null;
 for(const state of pool){if(JSON.stringify(state.semantic??[])!==JSON.stringify(markers))continue;const known=state.controls?new Set(state.controls):controlsOfHotspots(state.hotspots);const score=jaccard(controls,known);if(score>=.6&&(!best||score>best.score))best={state,score};}
 return best;
}
export function jaccard(a,b){if(!a.size&&!b.size)return 1;let both=0;for(const x of a)if(b.has(x))both++;return both/(a.size+b.size-both);}
/** Name of a new state, from the moment it shows. */
export function stateName(markers,{keyboard,taken=[]}={}){const base=(markers.includes('error')?'erro':markers.includes('loading')?'carregando':markers.includes('empty')?'vazio':markers.includes('success')?'concluído':markers.includes('dialog')?'diálogo':'padrão')+(keyboard?' · teclado':'');let name=base;for(let k=2;taken.includes(name);k++)name=`${base} ${k}`;return name;}

/**
 * Where a screen leads and where it is reached from, as labels: `ver detalhes>screen` out, `screen>produtos` in.
 * A screen recorded twice has the same ways out and in; two lists that look alike are reached by different tabs.
 */
export function neighbourhood(graph){
 const of=new Map(graph.states.map(s=>[s.id,s.screenId])),out=new Map();const add=(id,key)=>{if(!out.has(id))out.set(id,new Set());out.get(id).add(key);};
 for(const t of graph.transitions??[]){if(!t.confirmed||['back','wait','scroll'].includes(t.action?.type))continue;const a=of.get(t.from),b=of.get(t.to);if(!a||!b||a===b)continue;const label=norm(t.name).slice(0,30);add(a,`>${label}>${b}`);add(b,`<${a}<${label}`);}
 return out;
}
/** Pairs of screens that look like one: what the agent (or a person) should look at and merge. Content counts most; shared ways in and out add to it. */
export function similarScreens(graph,{target,min=.55,limit=20}={}){
 const pool=graph.screens.filter(s=>(!target||s.target===target)&&s.profile?.n&&!s.mergedInto),idf=rarity(pool.map(s=>s.profile)),out=[],near=neighbourhood(graph);
 for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){const a=pool[i],b=pool[j];if(a.target!==b.target)continue;if(a.activity&&b.activity&&a.activity!==b.activity)continue;if(a.identity==='explicit'&&b.identity==='explicit')continue;if(a.fragment&&b.fragment&&a.fragment!==b.fragment)continue;
  const stable=p=>new Set(Object.entries(p.tokens).filter(([,c])=>c/p.n>=.5).map(([t])=>t));
  // Two titles that never change and differ (Produtos, Favoritos) say they are two lists, not one screen twice.
  const ha=steadyHeader(a.profile),hb=steadyHeader(b.profile),ab=similarity(stable(a.profile),b.profile,idf).score,ba=similarity(stable(b.profile),a.profile,idf).score,content=(ab+ba)/2-(ha&&hb&&ha!==hb?.08:0);
  // The other screen's id stands for this one in its neighbourhood, so a twin's ways out to itself still match.
  const swap=(set,from,to)=>new Set([...set??[]].map(k=>k.split(from).join(to))),na=swap(near.get(a.id),b.id,a.id),nb=swap(near.get(b.id),b.id,a.id),ways=na.size>=2&&nb.size>=2?jaccard(na,nb):null;
  const score=round(ways===null?content:.75*content+.25*ways);
  if(score>=min){const shared=[...stable(a.profile)].filter(t=>stable(b.profile).has(t)&&'hicf'.includes(t[0])).slice(0,6).map(t=>t.slice(2));out.push({a:a.id,b:b.id,names:[a.name,b.name],score,shared,...(ways!==null?{ways:round(ways)}:{})});}}
 return out.sort((x,y)=>y.score-x.score).slice(0,limit);
}
/**
 * The element a recorded action meant, in a capture where it may have moved or changed its text. The exact identity
 * first; then the same resource id and role; then the same role and label (`label` is the name the transition was
 * recorded under); for a field, the same position. Each fallback must point at exactly one element, or nothing is used.
 */
export function locate(elements,identity,label){
 if(!identity)return null;const exact=elements.find(e=>e.identity===identity);if(exact)return exact;
 const [key,role,...rest]=String(identity).split('|'),name=rest.join('|'),usable=elements.filter(e=>e.actions?.length&&e.visible!==false);
 const one=list=>list.length===1?list[0]:null,keyOf=e=>String(e.identity).split('|')[0],positional=/:\d+$/.test(key)||/nth-|>|:nth/.test(key);
 if(key&&!positional){const hit=one(usable.filter(e=>keyOf(e)===key&&e.role===role));if(hit)return hit;}
 for(const wanted of [label,name].map(norm).filter(w=>w&&!CLASS_NAME.test(w))){const hit=one(usable.filter(e=>e.role===role&&[e.label,e.name,e.text].some(x=>x&&norm(x)===wanted)));if(hit)return hit;}
 if(positional&&/EditText|TextField|input|textarea/i.test(role??'')){const hit=one(usable.filter(e=>keyOf(e)===key));if(hit)return hit;}
 return null;
}
