import type {AuditReport} from '../types/report.types.js';

export interface FreeAuditRequest {
 id:string;
 email:string;
 contact_name:string;
 company_name:string;
 phone:string|null;
 loads_per_month:string|null;
 status:string;
 attempts:number;
 delivery_attempts?:number;
 result:AuditReport|null;
 result_token_hash?:string|null;
 result_expires_at?:string|null;
 recommended_plan?:'core'|'growth'|'scale'|null;
 utm_source?:string|null;
 utm_medium?:string|null;
 utm_campaign?:string|null;
 utm_term?:string|null;
 utm_content?:string|null;
}

export interface FreeAuditPublicResult extends FreeAuditRequest {recommended_plan:'core'|'growth'|'scale';}
export interface FreeAuditFollowup {request_id:string;day_offset:1|3|5|10|30;delivery_sequence:number;email:string;contact_name:string;company_name:string;loads_per_month:string|null;recommended_plan:'core'|'growth'|'scale';result:AuditReport;}

export interface FreeAuditAttachment {
 request_id:string;
 attachment_id:string;
 filename:string;
 storage_path:string;
 document_hash:string;
 size_bytes:number;
}

export interface FreeAuditRegistration {
 request_id:string;
 action:'created'|'replace'|'in_progress'|'repeat';
 offer_allowed:boolean;
 offer_number:number;
}
