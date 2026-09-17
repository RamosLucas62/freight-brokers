import {z} from 'zod';
import {getSupabaseClient} from '../config/supabase.js';
import type {RoseWebhookEvent} from './rose-rocket.js';

export type RoseEnqueueResult='queued'|'duplicate'|'not_connected'|'rate_limited';
const EnqueueResult=z.enum(['queued','duplicate','not_connected','rate_limited']);
export interface RoseEventJob {
 id:string;org_id:string;tenant_id:string;event_id:string;order_id:string;attempts:number;
}
export interface RoseDiscovery {
 orderId:string;
 documentCount:number;
 documentIds:string[];
 discoveredAt:string;
}

export async function enqueueRoseEvent(event:RoseWebhookEvent):Promise<RoseEnqueueResult>{
 const {data,error}=await getSupabaseClient().rpc('enqueue_rose_order_event',{
  p_org_id:event.orgId,p_event_id:event.id,p_order_id:event.refId,p_occurred_at:event.createdAt,
 });
 if(error)throw new Error('ROSE_QUEUE_UNAVAILABLE');
 return EnqueueResult.parse(data);
}
export async function claimRoseEvent():Promise<RoseEventJob|null>{
 const {data,error}=await getSupabaseClient().rpc('claim_rose_order_event');
 if(error)throw new Error('ROSE_QUEUE_UNAVAILABLE');
 return data?.[0]??null;
}
export async function completeRoseDiscovery(job:RoseEventJob,result:RoseDiscovery):Promise<void>{
 const {data,error}=await getSupabaseClient().from('audit_rose_events').update({
  status:'discovered',result,error_code:null,completed_at:new Date().toISOString(),claimed_at:null,
 }).eq('id',job.id).eq('org_id',job.org_id).eq('tenant_id',job.tenant_id).eq('status','processing').select('id');
 if(error||data?.length!==1)throw new Error('ROSE_QUEUE_UPDATE_FAILED');
}
export async function failRoseEvent(job:RoseEventJob,code:string):Promise<void>{
 const retry=job.attempts<5;
 const delaySeconds=Math.min(3600,60*2**Math.max(0,job.attempts-1));
 const {data,error}=await getSupabaseClient().from('audit_rose_events').update({
  status:retry?'queued':'failed',error_code:code,claimed_at:null,
  next_attempt_at:new Date(Date.now()+delaySeconds*1000).toISOString(),
  completed_at:retry?null:new Date().toISOString(),
 }).eq('id',job.id).eq('org_id',job.org_id).eq('tenant_id',job.tenant_id).eq('status','processing').select('id');
 if(error||data?.length!==1)throw new Error('ROSE_QUEUE_UPDATE_FAILED');
}
