import {z} from 'zod';
import {readResponseBody} from '../security/http.js';
import {OpenRouterUsageSchema,recordOpenRouterUsage,type CostContext} from '../costs/telemetry.js';

const Answer=z.object({
 noul:z.number().min(0).max(1).optional(),choice:z.string().optional(),score:z.number().optional(),
 probabilities:z.record(z.number().min(0).max(1)).optional(),confidence:z.number().min(0).max(1).optional(),legend:z.unknown().optional(),
}).passthrough();
const ResponseSchema=z.object({id:z.string().optional(),model:z.string().optional(),answers:z.record(Answer),usage:OpenRouterUsageSchema.optional()}).passthrough();
export type JevAnswer=z.infer<typeof Answer>;
export type JevQuestion={type:'noul';instructions:string;criteria?:Record<string,string>}|{type:'choice';instructions:string;criteria:Record<string,string>}|{type:'score';instructions:string;criteria:string[]};

export class JevClient{
 constructor(private readonly request:typeof fetch=fetch){}
 async decide(state:unknown,questions:Record<string,JevQuestion>,context?:CostContext,operation='jev_decision'):Promise<{answers:Record<string,JevAnswer>;model:string;requestId?:string}>{
  const key=process.env.OPENROUTER_API_KEY?.trim();if(!key)throw new Error('Set OPENROUTER_API_KEY before using Jev.');
  const model=process.env.JEV_MODEL?.trim()||'typesafe/jev-1.13';
  const allowed=(process.env.JEV_ALLOWED_MODELS??'typesafe/jev-1.13').split(',').map(value=>value.trim());if(!allowed.includes(model))throw new Error('JEV_MODEL is not in JEV_ALLOWED_MODELS.');
  let response:Response;
  try{response=await this.request('https://openrouter.ai/api/alpha/decisions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://aiolympian.com','X-OpenRouter-Title':'Olympian Audit Decisions'},body:JSON.stringify({model,state,questions,provider:{data_collection:'deny'}})});}catch{throw new Error('Jev decision request failed or timed out.');}
  if(!response.ok)throw new Error(`Jev decision request failed (HTTP ${response.status}).`);
  let parsed:z.infer<typeof ResponseSchema>;
  try{parsed=ResponseSchema.parse(JSON.parse((await readResponseBody(response,512*1024)).toString('utf8')));}catch{throw new Error('Jev returned an incomplete or invalid decision.');}
  if(Object.keys(questions).some(id=>!parsed.answers[id]))throw new Error('Jev returned an incomplete or invalid decision.');
  const resolvedModel=parsed.model??model;
  await recordOpenRouterUsage({context,operation,model:resolvedModel,requestId:parsed.id,usage:parsed.usage,metadata:{decision_count:Object.keys(parsed.answers).length}});
  return {answers:parsed.answers,model:resolvedModel,requestId:parsed.id};
 }
}
