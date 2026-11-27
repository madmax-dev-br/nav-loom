/**
 * A link a person copies from a screen in the interface and pastes to the agent: `navloom://screen/<screenId>` with an
 * optional `?state=<stateId>`. It only names the screen (or one of its states); what to do with it is said in the chat.
 */
export function screenLink({screen,state}){return `navloom://screen/${encodeURIComponent(screen)}${state?`?state=${encodeURIComponent(state)}`:''}`;}
/**
 * Find the first screen link inside any text. Returns `{screen,state?}` or null. A link pasted in a chat arrives wrapped
 * (quotes, brackets, markdown) or at the end of a sentence: what surrounds it and the punctuation after it are not part of it.
 */
export function parseScreenLink(text){
 const match=/navloom:\/\/screen\/([^\s?#&"'`<>()[\]{}*|\\]+)(?:\?([^\s#"'`<>()[\]{}*|\\]*))?/i.exec(String(text??''));if(!match)return null;
 const tail=/[.,;:!]+$/,query=match[2]?.replace(tail,''),id=match[2]===undefined?match[1].replace(tail,''):match[1],state=query?.split('&').find(p=>p.startsWith('state='))?.slice(6);
 try{const screen=decodeURIComponent(id);if(!screen)return null;return {screen,...(state?{state:decodeURIComponent(state)}:{})};}catch{return null;}
}
