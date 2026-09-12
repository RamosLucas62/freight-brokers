import {getSupabaseClient} from '../config/supabase.js';
import type {AuditReport} from '../types/report.types.js';
import type {FreeAuditAttachment,FreeAuditFollowup,FreeAuditPublicResult,FreeAuditRegistration,FreeAuditRequest} from './types.js';
import {createHash} from 'node:crypto';
import {recommendedPlan} from './recommendation.js';
import type {BillingPeriod,PlanCode} from '../billing/plans.js';

export async function recordCheckoutAcceptance(input:{email:string;plan:PlanCode;period:BillingPeriod;termsVersion:string;privacyVersion:string;disclosureVersion:string;disclosureText:string;ipAddress:string;userAgent:string;source:'public_pricing'|'free_audit_result'}):Promise<string>{
 const {data,error}=await getSupabaseClient().rpc('record_checkout_acceptance',{
  p_email:input.email,p_plan:input.plan,p_period:input.period,p_terms_version:input.termsVersion,p_privacy_version:input.privacyVersion,p_disclosure_version:input.disclosureVersion,p_disclosure_text:input.disclosureText,p_ip_address:input.ipAddress,p_user_agent:input.userAgent,p_source:input.source,
 });
 if(error||typeof data!=='string')throw new Error('CHECKOUT_ACCEPTANCE_FAILED');
 return data;
}

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

export async function issueRetry(requestId:string,retryTokenHash:string):Promise<void>{
 const {data,error}=await getSupabaseClient().rpc('issue_free_audit_retry',{p_request:requestId,p_token_hash:retryTokenHash});
 if(error||!data)throw new Error('FREE_AUDIT_RETRY_ISSUE_FAILED');
}

export async function inspectRetry(retryTokenHash:string):Promise<boolean>{
 const {data,error}=await getSupabaseClient().rpc('inspect_free_audit_retry',{p_token_hash:retryTokenHash});
 if(error)throw new Error('FREE_AUDIT_RETRY_INSPECT_FAILED');
 return data===true;
}

export async function beginRetry(retryTokenHash:string):Promise<string|null>{
 const {data,error}=await getSupabaseClient().rpc('begin_free_audit_retry',{p_token_hash:retryTokenHash});
 if(error)throw new Error('FREE_AUDIT_RETRY_BEGIN_FAILED');
 return typeof data==='string'&&data?data:null;
}

export async function finishRetry(requestId:string,retryTokenHash:string):Promise<void>{
 const {data,error}=await getSupabaseClient().rpc('finish_free_audit_retry',{p_request:requestId,p_token_hash:retryTokenHash});
 if(error||!data)throw new Error('FREE_AUDIT_RETRY_FINISH_FAILED');
}

export async function failRetry(requestId:string,retryTokenHash:string):Promise<void>{
 await getSupabaseClient().rpc('fail_free_audit_retry',{p_request:requestId,p_token_hash:retryTokenHash});
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

export async function activateResult(requestId:string,tokenHash:string,plan:'core'|'growth'|'scale'):Promise<void>{
 const {data,error}=await getSupabaseClient().rpc('activate_free_audit_result',{p_request:requestId,p_token_hash:tokenHash,p_plan:plan});
 if(error||!data)throw new Error('FREE_AUDIT_RESULT_ACTIVATION_FAILED');
}
export async function publicResult(tokenHash:string):Promise<FreeAuditPublicResult|null>{
 const {data,error}=await getSupabaseClient().from('free_audit_requests').select('*').eq('result_token_hash',tokenHash).gt('result_expires_at',new Date().toISOString()).not('result','is',null).maybeSingle();
 if(error)throw new Error('FREE_AUDIT_RESULT_LOAD_FAILED');
 if(!data)return null;
 const corrected=recommendedPlan(data.loads_per_month);
 if(data.recommended_plan!==corrected){await getSupabaseClient().from('free_audit_requests').update({recommended_plan:corrected,updated_at:new Date().toISOString()}).eq('id',data.id);data.recommended_plan=corrected;}
 return data as FreeAuditPublicResult;
}
export async function recordFunnelEvent(requestId:string,eventName:string,metadata:Record<string,unknown>={}):Promise<void>{
 const {error}=await getSupabaseClient().from('free_audit_funnel_events').insert({request_id:requestId,event_name:eventName,metadata});if(error)throw new Error('FREE_AUDIT_EVENT_FAILED');
 if(eventName==='result_opened')await getSupabaseClient().from('free_audit_requests').update({result_opened_at:new Date().toISOString()}).eq('id',requestId).is('result_opened_at',null);
}
export async function recordCheckoutStarted(email:string,metadata:Record<string,unknown>):Promise<void>{const {data}=await getSupabaseClient().from('free_audit_requests').select('id').eq('email',email).not('result','is',null).order('created_at',{ascending:false}).limit(1).maybeSingle();if(data?.id)await recordFunnelEvent(String(data.id),'checkout_started',metadata);}
export async function claimFollowup():Promise<FreeAuditFollowup|null>{const {data,error}=await getSupabaseClient().rpc('claim_free_audit_followup');if(error)throw new Error('FREE_AUDIT_FOLLOWUP_QUEUE_FAILED');return ((data as FreeAuditFollowup[]|null)?.[0])??null;}
export async function finishFollowup(requestId:string,day:number):Promise<void>{const {data,error}=await getSupabaseClient().rpc('finish_free_audit_followup',{p_request:requestId,p_day:day});if(error||!data)throw new Error('FREE_AUDIT_FOLLOWUP_FINISH_FAILED');}
export async function failFollowup(requestId:string,day:number):Promise<void>{await getSupabaseClient().rpc('fail_free_audit_followup',{p_request:requestId,p_day:day});}
export async function unsubscribe(tokenHash:string):Promise<boolean>{const {data,error}=await getSupabaseClient().rpc('unsubscribe_free_audit',{p_token_hash:tokenHash});if(error)throw new Error('FREE_AUDIT_UNSUBSCRIBE_FAILED');return data===true;}

export async function finishRequest(request:FreeAuditRequest,error?:unknown,retryDelivery=false,retryProcessing=false):Promise<void>{
 const failed=Boolean(error);const retryMinutes=Math.min(360,5*Math.pow(3,Math.max(0,request.attempts-1)));
 const update=failed?{status:retryDelivery?'delivery_failed':retryProcessing?'queued':'failed',last_error:error instanceof Error?error.message.slice(0,200):'FREE_AUDIT_FAILED',next_attempt_at:new Date(Date.now()+retryMinutes*60000).toISOString(),updated_at:new Date().toISOString()}
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
 const {error}=await getSupabaseClient().from('free_audit_requests').update({email:`expired+${requestId.replaceAll('-','')}@invalid.local`,contact_name:'Deleted lead',company_name:'Deleted lead',phone:null,loads_per_month:null,ip_fingerprint:'0'.repeat(64),status:'expired',retention_status:'expired',result:null,verification_token_hash:null,retry_token_hash:null,retry_expires_at:null,retry_claimed_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('id',requestId).eq('retention_status','deleting');
 if(error)throw new Error('FREE_AUDIT_RETENTION_FAILED');
}

export async function failExpiration(requestId:string):Promise<void>{
 await getSupabaseClient().from('free_audit_requests').update({retention_status:'pending',retention_claimed_at:null,updated_at:new Date().toISOString()}).eq('id',requestId).eq('retention_status','deleting');
}
