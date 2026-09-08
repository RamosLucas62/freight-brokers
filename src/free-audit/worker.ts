import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getPrivateObject} from '../storage/r2.js';
import {scanPdf} from '../security/pdf.js';
import {runAuditPipeline} from '../pipeline/audit.pipeline.js';
import {extractor} from '../extraction/index.js';
import {getCarrier} from '../carrier/index.js';
import type {AuditStore} from '../db/audit.repo.js';
import {ResendSender} from '../notifications/resend.sender.js';
import {freeAuditCsv,freeAuditPdf,resultEmail} from './artifacts.js';
import * as repository from './repository.js';

const transientStore:AuditStore={async assertActive(){},async history(){return [];},async commit(){}};
function minimumDate(now=new Date()){const date=new Date(now);date.setUTCDate(date.getUTCDate()-30);return date.toISOString().slice(0,10);}

export async function processFreeAudit(sender:ResendSender,offerUrl:string):Promise<boolean>{
 const request=await repository.claimRequest();if(!request)return false;
 let dir:string|undefined;
 let reportReady=Boolean(request.result);
 try{
  let report=request.result;
  if(!report){
   const attachments=await repository.loadAttachments(request.id);if(!attachments.length)throw new Error('NO_FREE_AUDIT_ATTACHMENTS');
   dir=await mkdtemp(join(tmpdir(),'free-audit-'));const paths:string[]=[];const labels:Record<string,string>={};
   for(const attachment of attachments){const bytes=await getPrivateObject(attachment.storage_path);await scanPdf(bytes);const path=join(dir,`${attachment.attachment_id}.pdf`);await writeFile(path,bytes,{mode:0o600});paths.push(path);labels[path]=attachment.filename;}
   report=await runAuditPipeline({tenantId:request.id,filePaths:paths,sourceLabels:labels,ctx:{run_id:request.id,carrierCache:new Map(),cacheTtlHours:Number(process.env.CARRIER_CACHE_TTL_HOURS??4)},extractor,getCarrier,store:transientStore,minimumInvoiceDate:minimumDate(),maximumInvoiceDate:new Date().toISOString().slice(0,10)});
   report.tenant_id=undefined;
   report.warnings=[...(report.warnings??[]),'Only invoices dated within the 30 days before processing are included. Documents without a readable invoice or load date remain included for manual review.'];
   await repository.saveResult(request.id,report);
   reportReady=true;
  }
  const email=resultEmail(request.contact_name,request.company_name,report,offerUrl);
  await sender.send({idempotencyKey:`free-audit-result-${request.id}`,to:[request.email],...email,attachments:[{filename:'olympian-free-audit.pdf',content:freeAuditPdf(request.company_name,report)},{filename:'olympian-free-audit.csv',content:freeAuditCsv(report)}]});
  await repository.finishRequest(request);return true;
 }catch(error){await repository.finishRequest(request,error,reportReady);throw error;}
 finally{if(dir)await rm(dir,{recursive:true,force:true});}
}

export function startFreeAuditWorker(sender:ResendSender,offerUrl:string){
 let stopped=false,running:Promise<void>|null=null;
 const tick=()=>{if(stopped||running)return;running=(async()=>{try{for(let i=0;i<3&&await processFreeAudit(sender,offerUrl);i++);}catch(error){console.error('[free-audit] Worker failed',error instanceof Error?error.message:'unknown');}})().finally(()=>{running=null;});};
 tick();const timer=setInterval(tick,10_000);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);await running;};
}
