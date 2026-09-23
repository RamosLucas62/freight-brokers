import {z} from 'zod';
import {readJson,readPdf,remoteId,type DocumentConnector,type TmsRecord} from './documents.js';
// McLeod-hosted addresses only. Custom/on-prem hosts need an audited network connector.
export const McLeodCredentials=z.object({
 host:z.string().trim().toLowerCase().regex(/^[a-z0-9-]+\.(?:loadtracking\.com|mcleodhosted\.com)$/),
 company_id:z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
 document_type_ids:z.array(z.string().trim().min(1).max(100)).min(1).max(30),
 token:z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/),
}).strict();
export class McLeodClient implements DocumentConnector{
 private readonly credentials:z.infer<typeof McLeodCredentials>;
 constructor(credentials:unknown,private readonly fetcher:typeof fetch=fetch){this.credentials=McLeodCredentials.parse(credentials);}
 private get(path:string,pdf=false):Promise<Response>{return this.fetcher(`https://${this.credentials.host}/ws${path}`,{
  headers:{Authorization:`Bearer ${this.credentials.token}`,'X-com.mcleodsoftware.CompanyID':this.credentials.company_id,Accept:pdf?'application/pdf':'application/json'},
  redirect:'error',signal:AbortSignal.timeout(30_000),
 });}
 async verifyAccess():Promise<void>{
  z.array(z.object({id:remoteId})).parse(await readJson(await this.get('/orders/search?recordLength=1&recordOffset=0')));
 }
 async *records():AsyncIterable<TmsRecord>{
  // Revisit the complete delivered-order search, including late-added documents.
  // Stop with a visible error rather than silently truncating oversized accounts.
  for(let offset=0;offset<10000;offset+=100){
   const rows=z.array(z.object({id:remoteId})).max(100).parse(await readJson(await this.get(`/orders/search?orders.status=D&recordLength=100&recordOffset=${offset}&orderBy=orders.id%20ASC`)));
   for(const row of rows)yield await this.record(row.id);
   if(rows.length<100)return;
  }
  throw new Error('MCLEOD_SEARCH_LIMIT');
 }
 async record(id:string):Promise<TmsRecord>{
  remoteId.parse(id);
  const images=z.array(z.object({id:remoteId,descr:z.string().optional(),companyId:z.string(),documentTypeId:z.string(),scanDate:z.union([z.string(),z.number()]).optional()})).max(100).parse(await readJson(await this.get(`/images/O/${encodeURIComponent(id)}`)));
  if(images.some(image=>image.companyId!==this.credentials.company_id))throw new Error('MCLEOD_COMPANY_MISMATCH');
  return {id,documents:images.filter(image=>this.credentials.document_type_ids.includes(image.documentTypeId)).map(image=>({id:image.id,filename:`${image.id.replace(/[^a-z0-9_-]/gi,'_')}.pdf`,revision:String(image.scanDate??image.id),download:async()=>readPdf(await this.get(`/images/${encodeURIComponent(image.id)}`,true))}))};
 }
}
