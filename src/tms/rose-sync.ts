import {createHmac} from 'node:crypto';
import {getSupabaseClient} from '../config/supabase.js';
import {RoseRocketClient} from './rose-rocket.js';
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
  // Uploaded order evidence is classified in the normal audit pipeline. Generated
  // receivable invoices are never imported as carrier invoices.
  return {id,documents:(order.documents??[]).filter(doc=>Boolean(doc.file?.id)&&(!doc.mimeType||doc.mimeType==='application/pdf')).map(doc=>({
   id:doc.id,revision:doc.file!.id,filename:safeFilename(doc.fileName??`${doc.id}.pdf`),download:()=>this.client.downloadPdf(doc),
  }))};
 }
}
