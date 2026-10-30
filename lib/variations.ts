import {type Screen,type Action,contextValueSchema} from './flow';
import {z} from 'zod';
export const previewContextSchema=z.record(contextValueSchema);
export type PreviewContext=z.infer<typeof previewContextSchema>;
export type PlatformVariant=Screen['variants'][string];
export function conditionsMatch(when:PreviewContext|undefined,context:PreviewContext){return !when||Object.entries(when).every(([key,value])=>Object.prototype.hasOwnProperty.call(context,key)&&context[key]===value);}
export function variationFor(variant:PlatformVariant,context:PreviewContext,override?:string){if(override&&override!=='auto')return override==='default'?'default':variant.variations?.find(v=>v.id===override)?.id??'default';return variant.variations?.find(v=>conditionsMatch(v.when,context))?.id??'default';}
export function effectiveVariant(variant:PlatformVariant,id='default'){const variation=variant.variations?.find(v=>v.id===id);return variation?{...variant,...variation}:variant;}
export function actionArea(action:Action,platform:string,variation='default'){return action.variants[platform]?.areas?.[variation]??action.variants[platform]?.area;}
export function actionAvailable(action:Action,platform:string,variation:string,context:PreviewContext){const v=action.variants[platform];return !!v&&(!v.fromVariation||v.fromVariation===variation)&&conditionsMatch(v.when,context);}
export function conditionLabel(when:PreviewContext){return Object.entries(when).map(([key,value])=>`${key} = ${JSON.stringify(value)}`).join(' and ');}

export function isWholeScreen(area:{x:number;y:number;width:number;height:number}|undefined){return !!area&&area.x===0&&area.y===0&&area.width===1&&area.height===1;}

export function destinationStates(screen:Screen,platform:string){const variant=screen.variants[platform];return variant?[{id:'default',name:'Otherwise',when:undefined as PreviewContext|undefined},...(variant.variations??[]).map(v=>({id:v.id,name:v.name,when:v.when}))]:[];}
export function actionEffect(action:Action){return action.from===action.to?'State change':'Navigation';}
export function contextForState(screen:Screen,platform:string,state:string,context:PreviewContext){const next={...context};for(const variation of screen.variants[platform]?.variations??[])for(const key of Object.keys(variation.when))delete next[key];return {...next,...screen.variants[platform]?.variations?.find(v=>v.id===state)?.when};}
