import {getSupabaseClient} from '../config/supabase.js';
import type {AuditReport} from '../types/report.types.js';
import type {FreeAuditAttachment,FreeAuditRegistration,FreeAuditRequest} from './types.js';
import {createHash} from 'node:crypto';

export async function registerRequest(input:{email:string;name:string;company:string;phone?:string;loads?:string;tokenHash:string;ipFingerprint:string}):Promise<FreeAuditRegistration>{
 const {data,error}=await getSupabaseClient().rpc('register_free_audit_request',{
  p_email:input.email,p_email_hash:createHash('sha256').update(input.email).digest('hex'),p_name:input.name,p_company:input.company,p_phone:input.phone??'',p_loads:input.loads??'',p_token_hash:input.tokenHash,p_ip_fingerprint:input.ipFingerprint,
 });
 const row=(data as FreeAuditRegistration[]|null)?.[0];
 if(error||!row)throw new Error('FREE_AUDIT_REGISTRATION_FAILED');
 return row;
}

export async function saveAttachment(attachment:FreeAuditAttachment):Promise<void>{
 const {error}=await getSupabaseClient().from('free_audit_attachments').insert(attachment);
 if(error){
  if(String(error.code)==='23505')return;
  throw new Error('FREE_AUDIT_ATTACHMENT_FAILED');
 }
}

export async function clearAttachments(requestId:string):Promise<void>{
 const {error}=await getSupabaseClient().from('free_audit_attachments').delete().eq('request_id',requestId);
 if(error)throw new Error('FREE_AUDIT_ATTACHMENT_CLEAR_FAILED');
}

export async function markUploaded(requestId:string):Promise<void>{
 const {data,error}=await getSupabaseClient().rpc('mark_free_audit_uploaded',{p_request:requestId});
 if(error||!data)throw new Error('FREE_AUDIT_UPLOAD_FINALIZE_FAILED');
}

export async function releaseOffer(requestId:string,offerNumber:number):Promise<void>{
 await getSupabaseClient().rpc('release_free_audit_offer',{p_request:requestId,p_offer_number:offerNumber});
}

export async function failUpload(requestId:string):Promise<void>{
 await getSupabaseClient().from('free_audit_attachments').delete().eq('request_id',requestId);
 await getSupabaseClient().from('free_audit_requests').update({status:'failed',last_error:'UPLOAD_FAILED',updated_at:new Date().toISOString()}).eq('id',requestId).eq('status','uploading');
}

export async function verifyRequest(tokenHash:string):Promise<string|null>{
 const {data,error}=await getSupabaseClient().rpc('verify_free_audit_request',{p_token_hash:tokenHash});
 if(error)throw new Error('FREE_AUDIT_VERIFICATION_FAILED');
 return typeof data==='string'&&data?data:null;
}

export async function claimRequest():Promise<FreeAuditRequest|null>{
 const {data,error}=await getSupabaseClient().rpc('claim_free_audit_request');
 if(error)throw new Error('FREE_AUDIT_QUEUE_FAILED');
 return ((data as FreeAuditRequest[]|null)?.[0])??null;
}

export async function loadAttachments(requestId:string):Promise<FreeAuditAttachment[]>{
 const {data,error}=await getSupabaseClient().from('free_audit_attachments').select('*').eq('request_id',requestId).order('filename');
 if(error)throw new Error('FREE_AUDIT_ATTACHMENTS_LOAD_FAILED');
 return (data??[]) as FreeAuditAttachment[];
}

export async function saveResult(requestId:string,report:AuditReport):Promise<void>{
 const {error}=await getSupabaseClient().from('free_audit_requests').update({result:report,updated_at:new Date().toISOString()}).eq('id',requestId).eq('status','processing');
 if(error)throw new Error('FREE_AUDIT_RESULT_SAVE_FAILED');
}

export async function finishRequest(request:FreeAuditRequest,error?:unknown,retryDelivery=false):Promise<void>{
 const failed=Boolean(error);const retryMinutes=Math.min(360,5*Math.pow(3,Math.max(0,request.attempts-1)));
 const update=failed?{status:retryDelivery?'delivery_failed':'failed',last_error:error instanceof Error?error.message.slice(0,200):'FREE_AUDIT_FAILED',next_attempt_at:new Date(Date.now()+retryMinutes*60000).toISOString(),updated_at:new Date().toISOString()}
  :{status:'completed',last_error:null,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
 const {error:dbError}=await getSupabaseClient().from('free_audit_requests').update(update).eq('id',request.id).eq('status','processing');
 if(dbError)throw new Error('FREE_AUDIT_FINISH_FAILED');
}

export async function claimExpired():Promise<string|null>{
 const {data,error}=await getSupabaseClient().rpc('claim_expired_free_audit');
 if(error)throw new Error('FREE_AUDIT_RETENTION_CLAIM_FAILED');
 return typeof data==='string'&&data?data:null;
}

export async function expireRequest(requestId:string):Promise<void>{
 const removed=await getSupabaseClient().from('free_audit_attachments').delete().eq('request_id',requestId);
 if(removed.error)throw new Error('FREE_AUDIT_RETENTION_FAILED');
 const {error}=await getSupabaseClient().from('free_audit_requests').update({email:`expired+${requestId.replaceAll('-','')}@invalid.local`,contact_name:'Deleted lead',company_name:'Deleted lead',phone:null,loads_per_month:null,ip_fingerprint:'0'.repeat(64),status:'expired',retention_status:'expired',result:null,verification_token_hash:null,last_error:null,updated_at:new Date().toISOString()}).eq('id',requestId).eq('retention_status','deleting');
 if(error)throw new Error('FREE_AUDIT_RETENTION_FAILED');
}

export async function failExpiration(requestId:string):Promise<void>{
 await getSupabaseClient().from('free_audit_requests').update({retention_status:'pending',retention_claimed_at:null,updated_at:new Date().toISOString()}).eq('id',requestId).eq('retention_status','deleting');
}
