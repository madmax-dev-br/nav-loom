import {z} from 'zod';
import {parse,stringify} from 'yaml';
import {flowSchema,type Flow,groupPathSchema} from './flow';
export const groupFileSchema=z.object({version:z.literal(1),kind:z.literal('navloom-group'),project:z.string().min(1),group:groupPathSchema,flows:z.array(flowSchema)}).superRefine((file,ctx)=>{if(file.flows.some(f=>f.project!==file.project||f.group!==file.group))ctx.addIssue({code:'custom',message:'Every flow must belong to this project and group'});if(new Set(file.flows.map(f=>f.id)).size!==file.flows.length)ctx.addIssue({code:'custom',message:'Duplicate flow IDs in group'});});
export function writeGroupFile(project:string,group:string,flows:Flow[]){return stringify(groupFileSchema.parse({version:1,kind:'navloom-group',project,group,flows}),{lineWidth:100});}
export function readGroupFile(text:string){if(text.length>1500000)throw new Error('Group file is too large');return groupFileSchema.parse(parse(text,{maxAliasCount:30}));}
