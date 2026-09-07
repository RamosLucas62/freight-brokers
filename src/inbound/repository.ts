import { getSupabaseClient } from '../config/supabase.js';
import type { InvoiceExtractionResult } from '../types/invoice.types.js';
import type { AuditReport } from '../types/report.types.js';
import { recipientAliases, type ReceivedEvent } from './events.js';
import {invoiceObjectKey,putInvoiceObject} from '../storage/r2.js';
export interface InboundJob { id:string; tenant_id:string; email_id:string; }
export async function authorizeInbound(job:InboundJob,sender:string):Promise<void>{
 const {data,error}=await getSupabaseClient().rpc('authorize_inbound_processing',{p_tenant:job.tenant_id,p_sender:sender});
 if(error||!data)throw new Error('UNAUTHORIZED_OR_QUOTA_EXCEEDED');
}
export async function enqueue(eventId:string,event:ReceivedEvent) {
 const {error}=await getSupabaseClient().rpc('enqueue_audit_email',{
  p_event_id:eventId,p_email_id:event.data.email_id,p_aliases:recipientAliases(event),
 });
 if(error)throw new Error('QUEUE_UNAVAILABLE');
}
export async function claim():Promise<InboundJob|null> {
 const {data,error}=await getSupabaseClient().rpc('claim_audit_email');
 if(error)throw new Error('QUEUE_UNAVAILABLE');
 return data?.[0]??null;
}
export async function finish(job:InboundJob,status:string,result:AuditReport|null,errorCode:string|null) {
 const {error}=await getSupabaseClient().from('audit_inbound_jobs').update({status,result,error_code:errorCode,finished_at:new Date().toISOString()})
 .eq('id',job.id).eq('tenant_id',job.tenant_id).eq('status','processing');
 if(error)throw new Error('QUEUE_UPDATE_FAILED');
}
export async function saveAttachment(job:InboundJob,id:string,filename:string,bytes:Buffer) {
 const db=getSupabaseClient();const path=invoiceObjectKey(job.tenant_id,job.id,id);
 try{await putInvoiceObject(path,bytes);}catch(error){
  const detail=error instanceof Error?error.message:'unknown_error';
  const status=typeof error==='object' && error!==null && '$metadata' in error
   ? (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode
   : undefined;
  console.error('[r2] PutObject failed',JSON.stringify({status,detail}));
  throw new Error('ATTACHMENT_STORAGE_FAILED');
 }
 const saved=await db.from('audit_inbound_attachments').upsert({tenant_id:job.tenant_id,job_id:job.id,attachment_id:id,filename,storage_path:path}, {onConflict:'tenant_id,job_id,attachment_id'});
 if(saved.error)throw new Error('ATTACHMENT_METADATA_FAILED');
}
export async function cacheExtraction(job:InboundJob,id:string,result:InvoiceExtractionResult) {
 const {error}=await getSupabaseClient().from('audit_inbound_attachments').update({extraction:result})
 .eq('tenant_id',job.tenant_id).eq('job_id',job.id).eq('attachment_id',id);
 if(error)throw new Error('EXTRACTION_CACHE_FAILED');
}
export async function recordBillableInvoice(job:InboundJob,id:string,documentHash:string):Promise<boolean>{
 const {data,error}=await getSupabaseClient().rpc('record_billable_invoice',{p_tenant:job.tenant_id,p_job:job.id,p_attachment:id,p_document_hash:documentHash});
 if(error)throw new Error('USAGE_RECORD_FAILED');return Boolean(data);
}
export async function storedExtractions(job:InboundJob):Promise<Map<string,InvoiceExtractionResult>> {
 const {data,error}=await getSupabaseClient().from('audit_inbound_attachments').select('attachment_id,extraction').eq('tenant_id',job.tenant_id).eq('job_id',job.id);
 if(error)throw new Error('EXTRACTION_CACHE_FAILED');
 return new Map((data??[]).filter(r=>r.extraction).map(r=>[r.attachment_id,r.extraction as InvoiceExtractionResult]));
}
export async function savedReport(job:InboundJob):Promise<AuditReport|null> {
 const {data,error}=await getSupabaseClient().from('audit_runs').select('report').eq('tenant_id',job.tenant_id).eq('run_id',job.id).maybeSingle();
 if(error)throw new Error('REPORT_LOOKUP_FAILED');
 return data?.report??null;
}
