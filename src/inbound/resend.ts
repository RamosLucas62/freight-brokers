import { z } from 'zod';
export const MAX_PDF_BYTES=20*1024*1024;
const Attachment=z.object({id:z.string().uuid(),filename:z.string().nullable(),content_type:z.string(),size:z.number().int().nonnegative(),download_url:z.string().url()});
export type Attachment=z.infer<typeof Attachment>;
export async function limitedBody(response:Response,limit:number):Promise<Buffer> {
 if(!response.ok || !response.body)throw new Error('RESEND_DOWNLOAD_FAILED');
 const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
 try {
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;
   if(size>limit)throw new Error('ATTACHMENT_TOO_LARGE');chunks.push(Buffer.from(part.value));}
 }catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
export class ResendReceivingClient {
 constructor(private readonly key:string,private readonly request:typeof fetch=fetch){}
 private async get(path:string):Promise<unknown> {
  const r=await this.request(`https://api.resend.com${path}`,{headers:{Authorization:`Bearer ${this.key}`},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`RESEND_HTTP_${r.status}`);
  return JSON.parse((await limitedBody(r,2*1024*1024)).toString('utf8'));
 }
 async attachments(emailId:string):Promise<Attachment[]> {
  z.string().uuid().parse(emailId);
  const payload=z.object({has_more:z.boolean(),data:z.array(Attachment).max(100)}).parse(await this.get(`/emails/receiving/${emailId}/attachments`));
  if(payload.has_more || payload.data.length>10)throw new Error('TOO_MANY_ATTACHMENTS');
  return payload.data;
 }
 async isAutomatic(emailId:string):Promise<boolean> {
  const payload=z.object({headers:z.record(z.string()).default({})}).parse(await this.get(`/emails/receiving/${emailId}?html_format=cid`));
  const headers=Object.fromEntries(Object.entries(payload.headers).map(([k,v])=>[k.toLowerCase(),v.toLowerCase()]));
  return headers['auto-submitted']==='auto-replied';
 }
 async download(attachment:Attachment):Promise<Buffer> {
  if(attachment.size>MAX_PDF_BYTES)throw new Error('ATTACHMENT_TOO_LARGE');
  const url=new URL(attachment.download_url);
  // Signed download URLs come from the authenticated Resend API, never from email text.
  if(url.protocol!=='https:' || url.hostname!=='inbound-cdn.resend.com' || url.username || url.password || (url.port && url.port!=='443'))throw new Error('UNTRUSTED_ATTACHMENT_HOST');
  const r=await this.request(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  const bytes=await limitedBody(r,MAX_PDF_BYTES);
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('INVALID_PDF');
  return bytes;
 }
}
