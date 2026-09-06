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

export async function processJob(job:repository.InboundJob,client:ResendReceivingClient) {
 let dir:string|undefined;
 try {
  const previous=await repository.savedReport(job);
  if(previous){await repository.finish(job,'completed',previous,null);return;}
  const store=createAuditStore(job.tenant_id);
  try{await store.assertActive();}catch{await repository.finish(job,'blocked',null,'ACCOUNT_UNAVAILABLE');return;}
  if(await client.isAutomatic(job.email_id)){await repository.finish(job,'ignored',null,'AUTOMATIC_EMAIL');return;}
  const attachments=await client.attachments(job.email_id);
  const pdfs=attachments.filter(a=>a.content_type==='application/pdf' || a.filename?.toLowerCase().endsWith('.pdf'));
  if(!pdfs.length){await repository.finish(job,'ignored',null,'NO_PDF_ATTACHMENTS');return;}
  if(pdfs.reduce((sum,a)=>sum+a.size,0)>50*1024*1024)throw new Error('MESSAGE_TOO_LARGE');
  dir=await mkdtemp(join(tmpdir(),'audit-email-'));
  const paths:string[]=[];const labels:Record<string,string>={};let bytesTotal=0;
  // Download and persist every PDF before any paid extraction.
  for(const attachment of pdfs){
   const bytes=await client.download(attachment);bytesTotal+=bytes.length;
   if(bytesTotal>50*1024*1024)throw new Error('MESSAGE_TOO_LARGE');
   await repository.saveAttachment(job,attachment.id,attachment.filename??'invoice.pdf',bytes);
   const path=join(dir,`${attachment.id}.pdf`);await writeFile(path,bytes,{mode:0o600});paths.push(path);
   labels[path]=`resend/${job.email_id}/${attachment.id}.pdf`;
  }
  const cached=await repository.storedExtractions(job);
  const report=await runAuditPipeline({tenantId:job.tenant_id,filePaths:paths,sourceLabels:labels,
   ctx:{run_id:job.id,carrierCache:new Map(),cacheTtlHours:Number(process.env.CARRIER_CACHE_TTL_HOURS??4)},
   getCarrier,store,extractor:{async extract(path){
    const id=basename(path,'.pdf');
    const stored=cached.get(id);
    if(stored)return ExtractionResultSchema.parse(stored);
    const result=await extractor.extract(path);
    await repository.cacheExtraction(job,id,result);
    return result;
   }},
  });
  // Duplicate-only runs are kept in the job result even when no new audit_run is needed.
  if(attachments.length!==pdfs.length)report.warnings?.push(`${attachments.length-pdfs.length} non-PDF attachments were not processed.`);
  await repository.finish(job,'completed',report,null);
 }catch(error){
  // A failed/uncertain paid call is never automatically repeated. Review before requeueing.
  const detail=error instanceof Error?error.message:'unknown_error';
  const status=typeof error==='object' && error!==null && '$metadata' in error
   ? (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode
   : undefined;
  console.error('[worker] Job failed',JSON.stringify({jobId:job.id,stage:detail,status}));
  await repository.finish(job,'needs_review',null,'PROCESSING_FAILED');
 }finally{if(dir)await rm(dir,{recursive:true,force:true});}
}
export function startWorker(client:ResendReceivingClient) {
 let stopping=false;let running:Promise<void>|null=null;
 const tick=()=>{if(stopping||running)return;running=(async()=>{
  try{const job=await repository.claim();if(job)await processJob(job,client);}
  catch{console.error('[worker] Queue or processing update failed; inspect audit_inbound_jobs.');}
 })().finally(()=>{running=null;});};
 const timer=setInterval(tick,3000);tick();
 return async()=>{stopping=true;clearInterval(timer);await running;};
}
