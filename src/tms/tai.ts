import {z} from 'zod';

// Customer input cannot select arbitrary hosts, ports, paths, or redirects.
export const TaiCredentials=z.object({
 site:z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
 api_key:z.string().trim().min(1).max(2048).regex(/^[\x21-\x7e]+$/),
}).strict();
export type TaiCredentials=z.infer<typeof TaiCredentials>;
export class TaiClient{
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
}
