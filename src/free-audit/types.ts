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
 result:AuditReport|null;
}

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
