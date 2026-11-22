'use client';
import {Fragment,useEffect,useMemo,useState,type ReactNode} from 'react';

type Obj=Record<string,any>;
type Block={kind:'h';level:number;text:string;id:string}|{kind:'p';text:string}|{kind:'list';items:{depth:number;text:string;ordered:boolean}[]}|{kind:'table';rows:string[][]}|{kind:'code';lang:string;text:string}|{kind:'quote';text:string};
const slug=(text:string)=>text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-');
/** The subset of Markdown the documentation uses: headings, paragraphs, nested lists, tables, fenced code, quotes. */
export function parseMarkdown(source:string):Block[]{
 const lines=source.replace(/\r/g,'').split('\n'),out:Block[]=[];let i=0;
 while(i<lines.length){const line=lines[i];
  if(!line.trim()){i++;continue;}
  const fence=line.match(/^```(\w*)/);if(fence){const body:string[]=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))body.push(lines[i++]);i++;out.push({kind:'code',lang:fence[1],text:body.join('\n')});continue;}
  const head=line.match(/^(#{1,4})\s+(.*)$/);if(head){out.push({kind:'h',level:head[1].length,text:head[2],id:slug(head[2])});i++;continue;}
  if(line.startsWith('|')){const rows:string[][]=[];while(i<lines.length&&lines[i].startsWith('|')){const cells=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());if(!cells.every(c=>/^:?-{3,}:?$/.test(c)))rows.push(cells);i++;}out.push({kind:'table',rows});continue;}
  if(line.startsWith('>')){const body:string[]=[];while(i<lines.length&&lines[i].startsWith('>'))body.push(lines[i++].replace(/^>\s?/,''));out.push({kind:'quote',text:body.join(' ')});continue;}
  if(/^\s*([-*]|\d+\.)\s+/.test(line)){const items:{depth:number;text:string;ordered:boolean}[]=[];while(i<lines.length&&(/^\s*([-*]|\d+\.)\s+/.test(lines[i])||(/^\s{2,}\S/.test(lines[i])&&items.length))){const m=lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);if(m)items.push({depth:Math.floor(m[1].length/2),text:m[3],ordered:/\d/.test(m[2])});else items[items.length-1].text+=' '+lines[i].trim();i++;}out.push({kind:'list',items});continue;}
  const body:string[]=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,4}\s|```|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i]))body.push(lines[i++].trim());out.push({kind:'p',text:body.join(' ')});
 }
 return out;
}
/** Inline marks: `code`, **bold**, *italic* and [links](url). Links to files of the repository are shown as code. */
function inline(text:string):ReactNode[]{
 const parts:ReactNode[]=[],pattern=/(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*)/g;let last=0,m:RegExpExecArray|null,k=0;
 while((m=pattern.exec(text))){if(m.index>last)parts.push(text.slice(last,m.index));const t=m[0];
  if(m[1])parts.push(<code key={k++}>{t.slice(1,-1)}</code>);else if(m[2])parts.push(<strong key={k++}>{inline(t.slice(2,-2))}</strong>);
  else if(m[3]){const [,label,href]=t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;parts.push(/^https?:/.test(href)?<a key={k++} href={href} target="_blank" rel="noreferrer">{label}</a>:<code key={k++}>{label}</code>);}
  else parts.push(<em key={k++}>{t.slice(1,-1)}</em>);last=m.index+t.length;}
 if(last<text.length)parts.push(text.slice(last));return parts;
}
function List({items}:{items:{depth:number;text:string;ordered:boolean}[]}){
 const tree=(from:number,depth:number):[ReactNode,number]=>{const nodes:ReactNode[]=[];let i=from;const ordered=items[from]?.ordered;
  while(i<items.length&&items[i].depth>=depth){if(items[i].depth>depth){const [child,next]=tree(i,items[i].depth);nodes.push(<Fragment key={'c'+i}>{child}</Fragment>);i=next;continue;}const item=items[i];let child:ReactNode=null;i++;if(i<items.length&&items[i].depth>depth){const [sub,next]=tree(i,items[i].depth);child=sub;i=next;}nodes.push(<li key={i}>{inline(item.text)}{child}</li>);}
  return [ordered?<ol>{nodes}</ol>:<ul>{nodes}</ul>,i];};
 return <>{tree(0,items[0]?.depth??0)[0]}</>;
}
/** The documentation inside the app: how Navloom works, its tools and good practices, with a table of contents. */
export function DocsPanel({load}:{load:()=>Promise<Obj>}){
 const [markdown,setMarkdown]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;load().then(r=>{if(live)setMarkdown(r.markdown??'');}).catch(e=>{if(live)setError(e instanceof Error?e.message:String(e));});return()=>{live=false;};},[load]);
 const blocks=useMemo(()=>parseMarkdown(markdown),[markdown]),toc=blocks.filter((b):b is Extract<Block,{kind:'h'}>=>b.kind==='h'&&b.level===2);
 if(error)return <div className="docs"><p role="alert" className="agent-error">Não foi possível carregar a documentação: {error}</p></div>;
 if(!markdown)return <div className="docs"><p className="agent-quiet">Carregando a documentação…</p></div>;
 return <div className="docs">
  <nav className="docs-toc" aria-label="Sumário"><p className="agent-eyebrow">Nesta página</p><ol>{toc.map(h=><li key={h.id}><a href={'#'+h.id}>{h.text.replace(/^\d+\.\s*/,'')}</a></li>)}</ol></nav>
  <article className="docs-body">{blocks.map((b,i)=>b.kind==='h'?(b.level===1?<h1 key={i} id={b.id}>{inline(b.text)}</h1>:b.level===2?<h2 key={i} id={b.id}>{inline(b.text)}</h2>:b.level===3?<h3 key={i} id={b.id}>{inline(b.text)}</h3>:<h4 key={i} id={b.id}>{inline(b.text)}</h4>)
   :b.kind==='p'?<p key={i}>{inline(b.text)}</p>:b.kind==='quote'?<blockquote key={i}>{inline(b.text)}</blockquote>:b.kind==='list'?<List key={i} items={b.items}/>
   :b.kind==='table'?<div key={i} className="docs-table"><table><thead><tr>{b.rows[0].map((c,j)=><th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{b.rows.slice(1).map((r,j)=><tr key={j}>{r.map((c,k)=><td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>
   :<pre key={i} className={'docs-code'+(b.lang==='mermaid'?' is-diagram':'')}><code>{b.text}</code></pre>)}</article>
 </div>;
}
