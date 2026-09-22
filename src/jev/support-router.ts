import type {CostContext} from '../costs/telemetry.js';
import {JevClient} from './client.js';

export async function routeSupportWithJev(message:string,view:string|undefined,context?:CostContext,client=new JevClient()):Promise<{offerHuman:boolean;category:string;confidence:number}>{
 const result=await client.decide({description:'One English-language customer support request for a freight invoice audit product.',message,portal_view:view??null},{
  category:{type:'choice',instructions:'Classify the support request by the action it needs.',criteria:{product_guidance:'General product explanation or portal navigation.',account_specific:'Requires private account, job, report, subscription, or billing state.',manual_change:'Requires a person to change account, billing, permissions, or configuration.',security:'Security, privacy, suspicious activity, or sensitive-data concern.',human_request:'The customer explicitly requests a person.',other:'None of the other categories clearly applies.'}},
  needs_human:{type:'noul',instructions:'Must a human support specialist handle this request because it asks for a person, requires private account inspection or a manual change, reports a security concern, or remains blocked beyond general guidance?',criteria:{true:'Human access or judgment is required.',false:'Verified general guidance can fully answer it.'}},
 },context,'jev_support_routing');
 const category=result.answers.category?.choice??'other';const categoryConfidence=result.answers.category?.probabilities?.[category]??result.answers.category?.confidence??0;
 const humanProbability=result.answers.needs_human?.noul??0;const threshold=Number(process.env.JEV_SUPPORT_THRESHOLD??0.85);
 if(!Number.isFinite(threshold)||threshold<0.5||threshold>1)throw new Error('JEV_SUPPORT_THRESHOLD must be between 0.5 and 1.');
 return {offerHuman:humanProbability>=threshold||(['human_request','security','manual_change'].includes(category)&&categoryConfidence>=threshold),category,confidence:Math.max(humanProbability,categoryConfidence)};
}
