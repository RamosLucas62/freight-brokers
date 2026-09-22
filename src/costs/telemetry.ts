import {z} from 'zod';
import {getSupabaseClient} from '../config/supabase.js';
import {warn} from '../observability/logger.js';

export const OpenRouterUsageSchema=z.object({
 prompt_tokens:z.number().int().nonnegative().optional(),input_tokens:z.number().int().nonnegative().optional(),
 completion_tokens:z.number().int().nonnegative().optional(),output_tokens:z.number().int().nonnegative().optional(),
 total_tokens:z.number().int().nonnegative().optional(),cost:z.number().nonnegative().optional(),
}).passthrough();
export type OpenRouterUsage=z.infer<typeof OpenRouterUsageSchema>;

export interface CostContext{
 tenantId?:string;
 subjectType:'audit_run'|'free_audit'|'support_conversation'|'public_support'|'manual';
 subjectId?:string;
}

export interface CostEvent{
 context:CostContext;
 provider:string;
 service:string;
 operation:string;
 model?:string;
 requestId?:string;
 inputTokens?:number;
 outputTokens?:number;
 totalTokens?:number;
 costUsd?:number;
 quantity?:number;
 unit?:string;
 metadata?:Record<string,unknown>;
}

// Cost persistence must never turn a successful audit into a provider failure.
// Missing provider cost is stored explicitly so it can be reconciled later.
export async function recordCostEvent(event:CostEvent):Promise<void>{
 try{
  const result=await getSupabaseClient().from('audit_cost_events').upsert({
   tenant_id:event.context.tenantId??null,subject_type:event.context.subjectType,subject_id:event.context.subjectId??null,
   provider:event.provider,service:event.service,operation:event.operation,model:event.model??null,request_id:event.requestId??null,
   input_tokens:event.inputTokens??null,output_tokens:event.outputTokens??null,total_tokens:event.totalTokens??null,
   cost_usd:event.costUsd??null,quantity:event.quantity??1,unit:event.unit??'request',
   cost_status:event.costUsd==null?'pending':'actual',metadata:event.metadata??{},
  },{onConflict:'provider,request_id',ignoreDuplicates:true});
  if(result.error)throw result.error;
 }catch(error){warn('cost.telemetry.persist_failed',{provider:event.provider,service:event.service,operation:event.operation,error_name:error instanceof Error?error.name:'unknown'});}
}

export async function recordOpenRouterUsage(input:{context?:CostContext;operation:string;model:string;requestId?:string;usage?:OpenRouterUsage;metadata?:Record<string,unknown>}):Promise<void>{
 if(!input.context)return;
 const usage=input.usage;
 await recordCostEvent({context:input.context,provider:'openrouter',service:'ai',operation:input.operation,model:input.model,requestId:input.requestId,
  inputTokens:usage?.prompt_tokens??usage?.input_tokens,outputTokens:usage?.completion_tokens??usage?.output_tokens,totalTokens:usage?.total_tokens,
  costUsd:usage?.cost,metadata:{usage_reported:Boolean(usage),...input.metadata}});
}
