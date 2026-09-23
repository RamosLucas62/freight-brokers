import {createHmac,createHash} from 'node:crypto';
import {getSupabaseClient} from '../config/supabase.js';
import {RoseRocketClient,type RoseObject} from './rose-rocket.js';
import type {DocumentConnector,TmsRecord} from './documents.js';
import {safeFilename} from './documents.js';
export function roseSyncToken(orgId:string):string{
 const key=process.env.ROSE_ROCKET_CREDENTIAL_KEY;if(!key)throw new Error('ROSE_CREDENTIAL_KEY_REQUIRED');
 return createHmac('sha256',key).update(`rose-document-sync:${orgId}`).digest('base64url');
}
export class RoseDocumentConnector implements DocumentConnector{
 constructor(private readonly client:RoseRocketClient){}
 async *records():AsyncIterable<TmsRecord>{
  const seen=new Set<string>();
  if(this.client.historyBoardId)for(const id of await this.client.historicalOrderIds()){seen.add(id);yield await this.record(id);}
  for(let offset=0;offset<10000;offset+=500){
   const {data,error}=await getSupabaseClient().from('audit_rose_document_orders').select('order_id').eq('org_id',this.client.orgId).order('order_id').range(offset,offset+499);
   if(error)throw new Error('ROSE_EVENT_LOOKUP_FAILED');
   for(const row of data??[]){if(seen.has(row.order_id))continue;seen.add(row.order_id);yield await this.record(row.order_id);}
   if((data?.length??0)<500){if(!this.client.historyBoardId)throw new Error('ROSE_HISTORY_BOARD_REQUIRED');return;}
  }
  throw new Error('ROSE_EVENT_HISTORY_LIMIT');
 }
 async record(id:string):Promise<TmsRecord>{
  const order=await this.client.getObject('order',id);
  // Traverse only documented references, refetching each with tenant-scoped
  // credentials. A missing/forbidden related object fails this batch visibly.
  const objects:RoseObject[]=[order];const manifests=new Set<string>(),bills=new Set<string>();
  for(const ref of order.manifests??[]){
   if(manifests.has(ref.id))continue;manifests.add(ref.id);
   const manifest=await this.client.getObject('manifest',ref.id);objects.push(manifest);
   if(manifest.bill&&!bills.has(manifest.bill.id)){
    bills.add(manifest.bill.id);objects.push(await this.client.getObject('bill',manifest.bill.id));
   }
  }
  const files=new Set<string>();const documents:TmsRecord['documents']=[];
  for(const object of objects)for(const doc of object.documents??[]){
   // A generated accounting bill is not the original carrier invoice. Collect
   // uploaded evidence only; exclude generated receivables and compliance files.
   if(!doc.file?.id||doc.isSystemGenerated===true||(doc.mimeType&&doc.mimeType!=='application/pdf')||/^compliance/.test(doc.documentType??''))continue;
   if(files.has(doc.file.id))continue;files.add(doc.file.id);
   documents.push({id:doc.file.id,revision:doc.file.id,filename:safeFilename(doc.fileName??`${doc.id}.pdf`),download:()=>this.client.downloadPdf(doc)});
   if(documents.length>100)throw new Error('ROSE_DOCUMENT_LIMIT');
  }
  // Only the manifest rate confirmation is valid generated audit evidence.
  // Generated BOLs are unsigned templates; generated bills are accounting records.
  for(const object of objects){
   if(object.objectKey!=='manifest')continue;
   const generated=(object.documents??[]).find(doc=>doc.externalUrl===`/api/v2/platformModel/documents/manifest/${object.id}/rate_con/pdf`&&!doc.file?.id);
   const uploaded=(object.documents??[]).some(doc=>doc.file?.id&&doc.documentType==='rateConfirmation');
   if(!generated||uploaded)continue;
   if(documents.length>=100)throw new Error('ROSE_DOCUMENT_LIMIT');
   const bytes=await this.client.downloadPdf(generated);
   // Hash bytes, not the mutable URL or object timestamp. Changes produce a new
   // batch; queued jobs refetch and check this hash before using the document.
   documents.push({id:`rate-${object.id}`,revision:createHash('sha256').update(bytes).digest('hex'),filename:`rate_confirmation-${object.id}.pdf`,download:async()=>bytes});
  }
  return {id,documents};
 }
}
