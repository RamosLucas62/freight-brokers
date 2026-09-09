import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getPrivateObject} from '../storage/r2.js';
import {scanPdf} from '../security/pdf.js';
import {runAuditPipeline} from '../pipeline/audit.pipeline.js';
import {extractor} from '../extraction/index.js';
import {getCarrier} from '../carrier/index.js';
import type {AuditStore} from '../db/audit.repo.js';
import {ResendSender} from '../notifications/resend.sender.js';
import {failureEmail,followupEmail,resultEmail,type FreeAuditFailureKind} from './artifacts.js';
import * as repository from './repository.js';
import {failure,info} from '../observability/logger.js';

const transientStore:AuditStore={async assertActive(){},async history(){return [];},async commit(){}};
function minimumDate(now=new Date()){const date=new Date(now);date.setUTCDate(date.getUTCDate()-30);return date.toISOString().slice(0,10);}
function failureKind(error:unknown):FreeAuditFailureKind{
 const code=error instanceof Error?error.message.toUpperCase():'';
 if(/(TOO_LARGE|PAGE_LIMIT)/.test(code))return 'too_large';
 if(/(INVALID_OR_ENCRYPTED|INVALID_PDF|FORMAT|NO_FREE_AUDIT_ATTACHMENTS)/.test(code))return 'invalid_document';
 if(/(MALWARE|ACTIVE_CONTENT)/.test(code))return 'unsafe_document';
 return 'temporary_error';
}
export function recommendedPlan(loads:string|null|undefined):'core'|'growth'|'scale'{
 const values=String(loads??'').match(/\d[\d,]*/g)?.map(value=>Number(value.replaceAll(',',''))).filter(Number.isFinite)??[];
 const volume=values.length?Math.max(...values):0;return volume>1500?'scale':volume>500?'growth':'core';
}
export function resultAccessToken(requestId:string,secret:string){return createHmac('sha256',secret).update(`free-audit-result:${requestId}`).digest('base64url');}

export async function processFreeAudit(sender:ResendSender,signupUrl:string,publicUrl=signupUrl,linkSecret=process.env.CSRF_SECRET??(process.env.NODE_ENV==='test'?'test-free-audit-link-secret-32bytes':'')):Promise<boolean>{
 const request=await repository.claimRequest();if(!request)return false;
 let dir:string|undefined;
 let reportReady=Boolean(request.result);
 let stage=reportReady?'send_result':'load_attachments';const started=Date.now();
 info('free_audit.worker.started',{audit_request_id:request.id,resuming_result:reportReady});
 try{
  let report=request.result;
  if(!report){
   const attachments=await repository.loadAttachments(request.id);if(!attachments.length)throw new Error('NO_FREE_AUDIT_ATTACHMENTS');
   dir=await mkdtemp(join(tmpdir(),'free-audit-'));const paths:string[]=[];const labels:Record<string,string>={};
   for(const attachment of attachments){stage='download_r2';const bytes=await getPrivateObject(attachment.storage_path);stage='scan_pdf';await scanPdf(bytes);stage='prepare_pdf';const path=join(dir,`${attachment.attachment_id}.pdf`);await writeFile(path,bytes,{mode:0o600});paths.push(path);labels[path]=attachment.filename;}
   stage='audit_pipeline';
   report=await runAuditPipeline({tenantId:request.id,filePaths:paths,sourceLabels:labels,ctx:{run_id:request.id,carrierCache:new Map(),cacheTtlHours:Number(process.env.CARRIER_CACHE_TTL_HOURS??4)},extractor,getCarrier,store:transientStore,minimumInvoiceDate:minimumDate(),maximumInvoiceDate:new Date().toISOString().slice(0,10)});
   report.tenant_id=undefined;
   report.warnings=[...(report.warnings??[]),'Only invoices dated within the 30 days before processing are included. Documents without a readable invoice or load date remain included for manual review.'];
   stage='save_result';await repository.saveResult(request.id,report);
   reportReady=true;
  }
  if(!linkSecret)throw new Error('FREE_AUDIT_LINK_SECRET_MISSING');const resultToken=resultAccessToken(request.id,linkSecret);const plan=recommendedPlan(request.loads_per_month);
  const resultUrl=new URL('/free-audit/result',publicUrl);resultUrl.searchParams.set('token',resultToken);
  stage='activate_result';await repository.activateResult(request.id,createHash('sha256').update(resultToken).digest('hex'),plan);
  const email=resultEmail(request.contact_name,request.company_name,report,resultUrl.href);
  stage='send_result';await sender.send({idempotencyKey:`free-audit-result-${request.id}`,to:[request.email],...email,attachments:[]});
  stage='finish_request';await repository.finishRequest(request);info('free_audit.worker.completed',{audit_request_id:request.id,duration_ms:Date.now()-started,invoice_count:report.total_invoices_processed,exception_count:report.total_exceptions});return true;
	 }catch(error){
	  failure('free_audit.worker.failed',error,{audit_request_id:request.id,stage,duration_ms:Date.now()-started,report_ready:reportReady});
	  if(!reportReady){
	   const kind=failureKind(error);const retryAutomatically=kind==='temporary_error'&&request.attempts<5;
	   if(retryAutomatically){await repository.finishRequest(request,error,false,true);info('free_audit.worker.retry_scheduled',{audit_request_id:request.id,attempt:request.attempts});throw error;}
	   const retryToken=randomBytes(32).toString('base64url');const retryUrl=new URL('/free-audit/retry',publicUrl);retryUrl.searchParams.set('token',retryToken);const notice=failureEmail(request.contact_name,kind,retryUrl.href);
	   try{await repository.issueRetry(request.id,createHash('sha256').update(retryToken).digest('hex'));await sender.send({idempotencyKey:`free-audit-failure-${request.id}-${request.attempts}`,to:[request.email],...notice,attachments:[]});info('free_audit.failure_email.sent',{audit_request_id:request.id,failure_kind:kind});}
	   catch(notificationError){failure('free_audit.failure_email.failed',notificationError,{audit_request_id:request.id,failure_kind:kind});}
	  }
  await repository.finishRequest(request,error,reportReady);throw error;
 }
 finally{if(dir)await rm(dir,{recursive:true,force:true});}
}

export async function processFreeAuditFollowup(sender:ResendSender,publicUrl:string,linkSecret:string):Promise<boolean>{
 const followup=await repository.claimFollowup();if(!followup)return false;
 try{const token=resultAccessToken(followup.request_id,linkSecret);const resultUrl=new URL('/free-audit/result',publicUrl);resultUrl.searchParams.set('token',token);const unsubscribeUrl=new URL('/free-audit/unsubscribe',publicUrl);unsubscribeUrl.searchParams.set('token',token);const email=followupEmail(followup.day_offset,followup.contact_name,followup.result,followup.recommended_plan,resultUrl.href,unsubscribeUrl.href);await sender.send({idempotencyKey:`free-audit-followup-${followup.request_id}-${followup.day_offset}`,to:[followup.email],...email,attachments:[]});await repository.finishFollowup(followup.request_id,followup.day_offset);info('free_audit.followup.sent',{audit_request_id:followup.request_id,day_offset:followup.day_offset});return true;}catch(error){await repository.failFollowup(followup.request_id,followup.day_offset).catch(()=>{});failure('free_audit.followup.failed',error,{audit_request_id:followup.request_id,day_offset:followup.day_offset});throw error;}
}

export function startFreeAuditWorker(sender:ResendSender,signupUrl:string,publicUrl=signupUrl,linkSecret=process.env.CSRF_SECRET??''){
 let stopped=false,running:Promise<void>|null=null;
 const tick=()=>{if(stopped||running)return;running=(async()=>{try{for(let i=0;i<3&&await processFreeAudit(sender,signupUrl,publicUrl,linkSecret);i++);for(let i=0;i<5&&await processFreeAuditFollowup(sender,publicUrl,linkSecret);i++);}catch(error){failure('free_audit.worker.tick_failed',error);}})().finally(()=>{running=null;});};
 tick();const timer=setInterval(tick,10_000);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);await running;};
}
