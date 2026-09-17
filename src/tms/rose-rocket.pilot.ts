import type {AuditReport} from '../types/report.types.js';
import {RoseRocketClient,type RoseObjectKey} from './rose-rocket.js';

export interface PilotDocument {objectKey:RoseObjectKey;objectId:string;documentId:string;documentType:string;filename:string;bytes:Buffer;}

function inferredType(key:RoseObjectKey,path:string|undefined):string|undefined{
 if(!path)return undefined;
 if(key==='bill'&&/^\/api\/v2\/platformModel\/documents\/bill\/[0-9a-f-]+\/pdf$/i.test(path))return 'bill';
 if(key==='manifest'&&/^\/api\/v2\/platformModel\/documents\/manifest\/[0-9a-f-]+\/rate_con\/pdf$/i.test(path))return 'rateConfirmation';
 return undefined;
}

/** Pull a known set of Rose Rocket records for a future authorized tenant pilot. */
export async function readRosePilotDocuments(client:RoseRocketClient,refs:ReadonlyArray<{key:RoseObjectKey;id:string}>):Promise<PilotDocument[]>{
 const result:PilotDocument[]=[];const seen=new Set<string>();
 for(const ref of refs){
  const object=await client.getObject(ref.key,ref.id);
  for(const document of object.documents??[]){
   if(seen.has(document.id))continue;
   // A missing/unknown type needs human mapping before it can affect an audit.
   const kind=document.documentType??inferredType(ref.key,document.externalUrl);
   if(!kind||!['invoice','bill','rateConfirmation','proofOfDelivery'].includes(kind))continue;
   // Rose Rocket `invoice` objects are receivables; a carrier bill must not be
   // inferred from an untyped customer invoice document.
   if(ref.key==='invoice'&&kind==='invoice')continue;
   if(!document.externalUrl?.startsWith('/api/v2/platformModel/documents/'))continue;
   const bytes=await client.downloadPdf(document);
   result.push({objectKey:ref.key,objectId:ref.id,documentId:document.id,documentType:kind,
    filename:(document.fileName??`${document.id}.pdf`).split(/[/\\]/).pop()||`${document.id}.pdf`,bytes});seen.add(document.id);
  }
 }
 return result;
}

/** Local status for review; this does not write to Rose Rocket. */
export function roseAuditStatus(report:AuditReport){
 const status=report.total_invoices_processed===0||report.total_exceptions>0||report.confidence?.review||report.confidence?.unverifiable?'needs_review':'audited';
 return {status,runId:report.run_id,invoiceCount:report.total_invoices_processed,
  exceptionCount:report.total_exceptions,generatedAt:report.generated_at} as const;
}
