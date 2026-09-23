import {z} from 'zod';
import {readJson,readPdf,safeFilename,type TmsRecord,type DocumentConnector} from './documents.js';

// Customer input cannot select arbitrary hosts, ports, paths, or redirects.
export const TaiCredentials=z.object({
 site:z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
 api_key:z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/),
}).strict();
export type TaiCredentials=z.infer<typeof TaiCredentials>;
export class TaiClient implements DocumentConnector{
 private readonly credentials:TaiCredentials;
 constructor(credentials:TaiCredentials,private readonly fetcher:typeof fetch=fetch){this.credentials=TaiCredentials.parse(credentials);}
 async verifyAccess():Promise<void>{
  const response=await this.fetcher(`https://${this.credentials.site}.taicloud.net/PublicApi/Broker/v2/ShipmentReferenceTypes`,{
   method:'GET',redirect:'error',headers:{Accept:'application/json','x-api-key':this.credentials.api_key},signal:AbortSignal.timeout(15_000),
  });
  try{
   if(!response.ok)throw new Error(`TAI_ACCESS_HTTP_${response.status}`);
   if(!/^(application|text)\/json\b/i.test(response.headers.get('content-type')??''))throw new Error('TAI_INVALID_RESPONSE');
   // Reject login pages, empty responses and malformed payloads; cap provider output.
   if(!response.body)throw new Error('TAI_INVALID_RESPONSE');
   const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>1024*1024)throw new Error('TAI_RESPONSE_TOO_LARGE');parts.push(part.value);
   }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   if(!Array.isArray(JSON.parse(Buffer.concat(parts).toString('utf8'))))throw new Error('TAI_INVALID_RESPONSE');
  }finally{await response.body?.cancel().catch(()=>{});}
 }
 private get(path:string):Promise<Response>{return this.fetcher(`https://${this.credentials.site}.taicloud.net${path}`,{headers:{Accept:'application/json','x-api-key':this.credentials.api_key},redirect:'error',signal:AbortSignal.timeout(30_000)});}
 async *records():AsyncIterable<TmsRecord>{
  const seen=new Set<number>();
  // Read every sync state: another accounting integration may already mark bills synced.
  // No external accounting flags are changed by the audit connector.
  for(const status of ['None','Complete','Failed','AlreadySynced','Updated']){
   const rows=z.array(z.object({shipmentId:z.number().int().positive()})).max(10000).parse(await readJson(await this.get(`/PublicApi/Accounting/v2/Bills?syncStatus=${status}`)));
   for(const row of rows){if(seen.has(row.shipmentId))continue;seen.add(row.shipmentId);yield await this.record(String(row.shipmentId));}
  }
 }
 async record(id:string):Promise<TmsRecord>{
  if(!/^[1-9][0-9]{0,9}$/.test(id))throw new Error('TAI_INVALID_SHIPMENT');
  const documents=z.array(z.object({documentId:z.number().int().positive(),attachmentName:z.string(),attachmentUrl:z.string().url(),attachmentType:z.string()})).max(100).parse(await readJson(await this.get(`/PublicApi/Broker/v2/Documents?shipmentId=${id}`)));
  // Invoice is a customer receivable in Tai; only explicit carrier bills and their evidence.
  const allowed=new Set(['Carrier Bill','POD','Carrier Confirmation','Accessorial Auth','Lumper Receipt','Return Receipt']);
  return {id,documents:documents.filter(doc=>allowed.has(doc.attachmentType)).map(doc=>({id:String(doc.documentId),filename:safeFilename(doc.attachmentName),revision:String(doc.documentId),download:async()=>{
   const url=new URL(doc.attachmentUrl);
   if(url.protocol!=='https:'||url.hostname!==`${this.credentials.site}.taicloud.net`||url.port||url.username||url.password||url.hash)throw new Error('TMS_UNTRUSTED_DOCUMENT_URL');
   // Document links are signed by Tai. Never attach the API key to a download URL.
   return readPdf(await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30_000)}));
  }}))};
 }

}
