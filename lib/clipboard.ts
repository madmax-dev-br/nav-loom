/** Copy text. Where the Clipboard API is missing (a page outside a secure context), a hidden textarea and `execCommand` do it. */
export async function copyText(text:string){
 try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true;}}catch{}
 const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(area);area.select();
 try{return document.execCommand('copy');}catch{return false;}finally{area.remove();}
}
