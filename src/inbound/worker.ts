import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import * as repository from './repository.js';
import {ResendReceivingClient} from './resend.js';
import {createAuditStore} from '../db/audit.repo.js';
import {extractor} from '../extraction/index.js';
import {getCarrier} from '../carrier/index.js';
import {runAuditPipeline} from '../pipeline/audit.pipeline.js';
import {ExtractionResultSchema} from '../extraction/schema.js';
import {scanPdf} from '../security/pdf.js';
import {createHash} from 'node:crypto';
import {failure,info,warn} from '../observability/logger.js';
import {OpenRouterDocumentClassifier,type DocumentType} from '../documents/classifier.js';
import {OpenRouterPodExtractor} from '../pod/openrouter.extractor.js';
import {PodExtractionSchema} from '../pod/schema.js';
import {OpenRouterRateConfirmationExtractor} from '../rate-confirmation/openrouter.extractor.js';
import {RateConfirmationExtractionSchema} from '../rate-confirmation/schema.js';
import {TmsReceivingClient} from '../tms/sync.js';
import {inboundFailureDecision} from './failure-policy.js';

export async function processJob(job:repository.InboundJob,client:ResendReceivingClient|TmsReceivingClient) {
 let dir:string|undefined;
 let stage='saved_report_lookup';const started=Date.now();info('inbound.worker.started',{job_id:job.id,tenant_id:job.tenant_id,email_id:job.email_id});
 try {
  const previous=await repository.savedReport(job);
  if(previous){await repository.finish(job,'completed',previous,null);info('inbound.worker.completed',{job_id:job.id,tenant_id:job.tenant_id,reused_report:true,duration_ms:Date.now()-started});return;}
  stage='account_check';
  const store=createAuditStore(job.tenant_id);
  try{await store.assertActive();}catch(error){warn('inbound.worker.blocked',{job_id:job.id,tenant_id:job.tenant_id,stage,reason:'ACCOUNT_UNAVAILABLE'});await repository.finish(job,'blocked',null,'ACCOUNT_UNAVAILABLE');return;}
  if(job.source==='tms'){
   if(!(client instanceof TmsReceivingClient))throw new Error('TMS_SOURCE_MISMATCH');
   stage='tms_authorization';await client.authorize();
  }else{
  if(client instanceof TmsReceivingClient)throw new Error('TMS_SOURCE_MISMATCH');
  stage='resend_metadata';
  const metadata=typeof (client as {metadata?:unknown}).metadata==='function'?await client.metadata(job.email_id):{automatic:await client.isAutomatic(job.email_id),from:'unknown@invalid.local',authenticated:true};
  if(metadata.automatic){info('inbound.worker.ignored',{job_id:job.id,tenant_id:job.tenant_id,reason:'AUTOMATIC_EMAIL'});await repository.finish(job,'ignored',null,'AUTOMATIC_EMAIL');return;}
  if(!metadata.authenticated){warn('inbound.worker.blocked',{job_id:job.id,tenant_id:job.tenant_id,reason:'SENDER_AUTHENTICATION_FAILED'});await repository.finish(job,'blocked',null,'SENDER_AUTHENTICATION_FAILED');return;}
  if(metadata.from!=='unknown@invalid.local')try{stage='sender_authorization';await repository.authorizeInbound(job,metadata.from);}catch{warn('inbound.worker.blocked',{job_id:job.id,tenant_id:job.tenant_id,reason:'SENDER_NOT_AUTHORIZED_OR_QUOTA'});await repository.finish(job,'blocked',null,'SENDER_NOT_AUTHORIZED_OR_QUOTA');return;}
  }
  stage='list_attachments';
  const attachments=await client.attachments(job.email_id);
  const pdfs=attachments.filter(a=>a.content_type==='application/pdf' || a.filename?.toLowerCase().endsWith('.pdf'));
  if(!pdfs.length){info('inbound.worker.ignored',{job_id:job.id,tenant_id:job.tenant_id,reason:'NO_PDF_ATTACHMENTS'});await repository.finish(job,'ignored',null,'NO_PDF_ATTACHMENTS');return;}
  if(pdfs.reduce((sum,a)=>sum+a.size,0)>40*1024*1024)throw new Error('MESSAGE_TOO_LARGE');
  dir=await mkdtemp(join(tmpdir(),'audit-email-'));
  const paths:string[]=[];const labels:Record<string,string>={};const hashes=new Map<string,string>();let bytesTotal=0;
  // Download and persist every PDF before any paid extraction.
  for(const attachment of pdfs){
   stage='download_attachment';const bytes=await client.download(attachment);bytesTotal+=bytes.length;
   if(bytesTotal>40*1024*1024)throw new Error('MESSAGE_TOO_LARGE');
   stage='scan_pdf';await scanPdf(bytes);
   stage='store_attachment';await repository.saveAttachment(job,attachment.id,attachment.filename??'invoice.pdf',bytes);
   hashes.set(attachment.id,createHash('sha256').update(bytes).digest('hex'));
   const path=join(dir,`${attachment.id}.pdf`);await writeFile(path,bytes,{mode:0o600});paths.push(path);
   labels[path]=job.source==='tms'?`tms/${job.tms_provider}/${job.tms_record_id}/${attachment.id}.pdf`:`resend/${job.email_id}/${attachment.id}.pdf`;
  }
  stage='load_extraction_cache';const cached=await repository.storedDocuments(job);const classifier=new OpenRouterDocumentClassifier();
  const costContext={tenantId:job.tenant_id,subjectType:'audit_run' as const,subjectId:job.id};
  const invoicePaths:string[]=[];const pods=[];const rateConfirmations=[];
  for(const path of paths){const id=basename(path,'.pdf');const attachment=pdfs.find(item=>item.id===id)!;const stored=cached.get(id);let documentType:DocumentType;
   if(stored)documentType=stored.documentType;else{stage='classify_document';documentType=await classifier.classify(path,attachment.filename??'',costContext);await repository.setDocumentType(job,id,documentType);}
   if(documentType==='invoice'){invoicePaths.push(path);continue;}
   if(documentType==='pod'){stage='extract_pod';const result=stored?.extraction?PodExtractionSchema.parse(stored.extraction):await new OpenRouterPodExtractor().extract(path,costContext);if(!stored?.extraction)await repository.cacheSupportingExtraction(job,id,'pod',result);pods.push(result);continue;}
   stage='extract_rate_confirmation';const result=stored?.extraction?RateConfirmationExtractionSchema.parse(stored.extraction):await new OpenRouterRateConfirmationExtractor().extract(path,costContext);if(!stored?.extraction)await repository.cacheSupportingExtraction(job,id,'rate_confirmation',result);rateConfirmations.push(result);
  }
  if(client instanceof TmsReceivingClient)await client.authorize();
  stage='audit_pipeline';
  const report=await runAuditPipeline({tenantId:job.tenant_id,filePaths:invoicePaths,sourceLabels:labels,pods,rateConfirmations,reconcileSupportingDocuments:true,
   costContext,
   ctx:{run_id:job.id,carrierCache:new Map(),cacheTtlHours:Number(process.env.CARRIER_CACHE_TTL_HOURS??4)},
   getCarrier,store,extractor:{async extract(path,context){
    const id=basename(path,'.pdf');
    const stored=cached.get(id)?.extraction;
    if(stored){const parsed=ExtractionResultSchema.parse(stored);await repository.recordBillableInvoice(job,id,hashes.get(id)!);return parsed;}
    const result=await extractor.extract(path,context);
    await repository.cacheExtraction(job,id,result);
    await repository.recordBillableInvoice(job,id,hashes.get(id)!);
    return result;
   }},
  });
  // Duplicate-only runs are kept in the job result even when no new audit_run is needed.
  if(attachments.length!==pdfs.length)report.warnings?.push(`${attachments.length-pdfs.length} non-PDF attachments were not processed by automatic email intake; use the POD CLI for images or spreadsheets.`);
  stage='finish_job';await repository.finish(job,'completed',report,null);info('inbound.worker.completed',{job_id:job.id,tenant_id:job.tenant_id,duration_ms:Date.now()-started,pdf_count:pdfs.length,pod_count:pods.length,rate_confirmation_count:rateConfirmations.length,invoice_count:report.total_invoices_processed,exception_count:report.total_exceptions});
 }catch(error){
  const detail=error instanceof Error?error.message:'unknown_error';
  const status=typeof error==='object' && error!==null && '$metadata' in error
   ? (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode
   : undefined;
  if(job.source==='tms'&&detail==='TMS_CONNECTION_INACTIVE'){await repository.finish(job,'blocked',null,'TMS_CONNECTION_INACTIVE');return;}
  const decision=inboundFailureDecision(error,stage,job.attempts??1);
  failure('inbound.worker.failed',error,{job_id:job.id,tenant_id:job.tenant_id,stage,attempt:decision.attempt,retry_scheduled:decision.retry,provider_detail:/^[A-Z0-9_]{3,100}$/.test(detail)?detail:'PROVIDER_ERROR',upstream_status:status,duration_ms:Date.now()-started});
  if(decision.retry){
   await repository.scheduleRetry(job,decision.errorCode,decision.delaySeconds);
   info('inbound.worker.retry_scheduled',{job_id:job.id,tenant_id:job.tenant_id,attempt:decision.attempt,next_attempt_seconds:decision.delaySeconds,error_code:decision.errorCode});
  }else await repository.finish(job,'needs_review',null,decision.errorCode==='UNKNOWN_ERROR'?'PROCESSING_FAILED':decision.errorCode);
 }finally{if(dir)await rm(dir,{recursive:true,force:true});}
}
export function startWorker(client:ResendReceivingClient) {
 let stopping=false;let running:Promise<void>|null=null;
 const tick=()=>{if(stopping||running)return;running=(async()=>{
  try{const job=await repository.claim();if(job)await processJob(job,job.source==='tms'?new TmsReceivingClient(job):client);}
  catch(error){failure('inbound.worker.tick_failed',error,{action:'claim_or_update_queue'});}
 })().finally(()=>{running=null;});};
 const timer=setInterval(tick,3000);tick();
 return async()=>{stopping=true;clearInterval(timer);await running;};
}
