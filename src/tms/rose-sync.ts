import {createHmac} from 'node:crypto';
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
  for(let offset=0;offset<10000;offset+=500){
   const {data,error}=await getSupabaseClient().from('audit_rose_document_orders').select('order_id').eq('org_id',this.client.orgId).order('order_id').range(offset,offset+499);
   if(error)throw new Error('ROSE_EVENT_LOOKUP_FAILED');
   for(const row of data??[]){if(seen.has(row.order_id))continue;seen.add(row.order_id);yield await this.record(row.order_id);}
   if((data?.length??0)<500)return;
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
  return {id,documents};
 }
}
