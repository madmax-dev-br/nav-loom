'use client';
import {useState} from 'react';
import {Play,Save,X} from 'lucide-react';

type Obj=Record<string,any>;
/** Starting points for each kind: a working script and one sample, so a person edits instead of starting blank. */
export const TEMPLATES:Record<string,{code:string;samples:Obj[]}>={
 capture:{code:`// Runs on every capture. Return the fields to show on this screen, or null.
function run(input) {
  const total = input.texts.find(t => /total/i.test(t));
  const calls = input.apis.map(a => a.method + ' ' + a.path + ' ' + a.status);
  if (!total && !calls.length) return null;
  return { fields: { ...(total ? { Total: total } : {}), 'Chamadas': calls.length }, tags: calls.some(c => / [45]\\d\\d$/.test(c)) ? ['erro de API'] : [] };
}`,samples:[{input:{texts:['Total R$ 10,00'],apis:[{method:'GET',path:'/api/cart',status:200}],logs:[]},expect:{fields:{Total:'Total R$ 10,00','Chamadas':1},tags:[]}}]},
 logcat:{code:`// One log line of the app → the API call it reports, or null.
function run(input) {
  const m = input.line.match(/HTTP (GET|POST|PUT|DELETE) (\\S+) -> (\\d{3})/);
  return m ? { method: m[1], url: m[2], status: Number(m[3]) } : null;
}`,samples:[{input:{line:'I/Api: HTTP GET /api/items -> 200'},expect:{method:'GET',url:'/api/items',status:200}}]},
 screen:{code:`// What is on view → which screen it is, or null.
function run(input) {
  if (input.heading === 'Carrinho') return { screen: 'cart', name: 'Carrinho' };
  return null;
}`,samples:[{input:{heading:'Carrinho',texts:[],ids:[]},expect:{screen:'cart',name:'Carrinho'}}]},
 path:{code:`// An API path → its template, or null.
function run(input) {
  return input.path.replace(/\\/orders\\/[^/]+/, '/orders/{id}') !== input.path ? input.path.replace(/\\/orders\\/[^/]+/, '/orders/{id}') : null;
}`,samples:[{input:{method:'GET',host:'api',path:'/orders/abc123'},expect:'/orders/{id}'}]},
};
const KINDS:Record<string,string>={capture:'Informação da tela',logcat:'Requests no log',screen:'Identidade de tela',path:'Caminho de API'};
/**
 * A person writes or edits a project script: code, samples, a trial run on one input, then save. Saving proposes a new
 * revision; "Salvar e ativar" also approves it, which runs the samples and activates only if they all match.
 */
export function ScriptEditor({initial,busy,onSave,onTry,onClose}:{initial?:Obj;busy:boolean;onSave:(script:Obj,activate:boolean)=>Promise<void>;onTry:(kind:string,code:string,input:Obj)=>Promise<Obj>;onClose:()=>void}){
 const start=initial??{id:'',kind:'capture',name:'',description:'',...TEMPLATES.capture};
 const [script,setScript]=useState<Obj>({...start,samples:JSON.stringify(start.samples,null,2)});
 const [input,setInput]=useState(JSON.stringify(start.samples?.[0]?.input??{},null,2)),[result,setResult]=useState<Obj|null>(null),[error,setError]=useState('');
 const set=(key:string,value:unknown)=>setScript(s=>({...s,[key]:value}));
 const parse=(text:string,what:string)=>{try{return JSON.parse(text);}catch{throw Error(`${what} não é um JSON válido`);}};
 const save=async(activate:boolean)=>{setError('');try{await onSave({id:script.id.trim(),kind:script.kind,name:script.name.trim(),description:script.description??'',code:script.code,samples:parse(script.samples,'Os exemplos')},activate);}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <section className="harness-card script-editor" aria-label="Editor de script">
  <div className="harness-card-title"><h3>{initial?`Editar ${initial.name}`:'Novo script'}</h3><button className="agent-subtle" onClick={onClose}><X size={13}/> Fechar</button></div>
  <p className="harness-note">Scripts são uma função <code>run(input)</code> pura que devolve JSON, sem imports nem acesso a rede ou arquivos. Rodam isolados, 25 ms por chamada. Os exemplos provam o que ela faz: o script só ativa se todos conferirem.</p>
  <div className="script-editor-meta">
   <label>Identificador<input value={script.id} disabled={!!initial} placeholder="ex.: total-do-carrinho" onChange={e=>set('id',e.target.value)}/></label>
   <label>Tipo<select value={script.kind} disabled={!!initial} onChange={e=>{const kind=e.target.value;setScript(s=>({...s,kind,code:TEMPLATES[kind].code,samples:JSON.stringify(TEMPLATES[kind].samples,null,2)}));setInput(JSON.stringify(TEMPLATES[kind].samples[0].input,null,2));}}>{Object.entries(KINDS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   <label>Nome<input value={script.name} placeholder="O que ele mostra ou reconhece" onChange={e=>set('name',e.target.value)}/></label>
  </div>
  <label>Descrição<input value={script.description} onChange={e=>set('description',e.target.value)}/></label>
  <label>Código<textarea className="script-code" spellCheck={false} value={script.code} onChange={e=>set('code',e.target.value)}/></label>
  <div className="script-editor-try">
   <label>Entrada de teste<textarea spellCheck={false} value={input} onChange={e=>setInput(e.target.value)}/></label>
   <div><button disabled={busy} onClick={async()=>{setError('');try{setResult(await onTry(script.kind,script.code,parse(input,'A entrada')));}catch(e){setError(e instanceof Error?e.message:String(e));}}}><Play size={13}/> Testar</button>
    {result&&<pre className={result.ok?'is-ok':'is-bad'}>{result.ok?JSON.stringify(result.value,null,2):result.error}</pre>}</div>
  </div>
  <label>Exemplos <small>[{'{input, expect}'}]</small><textarea spellCheck={false} value={script.samples} onChange={e=>set('samples',e.target.value)}/></label>
  {error&&<p role="alert" className="agent-error">{error}</p>}
  <footer><button className="agent-primary" disabled={busy||!script.id||!script.name} onClick={()=>void save(true)}><Save size={13}/> Salvar e ativar</button><button disabled={busy||!script.id||!script.name} onClick={()=>void save(false)}>Salvar como proposta</button></footer>
 </section>;
}
