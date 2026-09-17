import {z} from 'zod';

const ObjectKey=z.enum(['order','manifest','bill','invoice']);
export type RoseObjectKey=z.infer<typeof ObjectKey>;
const Id=z.string().uuid();
const Document=z.object({
 id:Id,
 documentType:z.string().optional(),
 fileName:z.string().optional(),
 mimeType:z.string().optional(),
 externalUrl:z.string().optional(),
 file:z.object({id:Id}).passthrough().nullable().optional(),
}).passthrough();
const RoseObject=z.object({id:Id,orgId:Id,objectKey:ObjectKey,documents:z.array(Document).optional()}).passthrough();
export type RoseObject=z.infer<typeof RoseObject>;
export type RoseDocument=z.infer<typeof Document>;

const TokenResponse=z.object({access_token:z.string().min(1),expires_in:z.number().positive().optional()}).passthrough();
export interface RoseRocketServiceAccount {
 clientId:string;
 clientSecret:string;
 orgId:string;
 userId:string;
}
export interface RoseRocketClientOptions {
 account:RoseRocketServiceAccount;
 fetcher?:typeof fetch;
 apiOrigin?:string;
 authOrigin?:string;
}

const MAX_PDF_BYTES=40*1024*1024;
function origin(value:string,expectedHost:string):string{
 const url=new URL(value);
 const allowedHost=expectedHost==='network.roserocket.com'
  ?/^[a-z0-9-]+\.roserocket\.com$/.test(url.hostname)&&url.hostname!=='a.roserocket.com'
  :url.hostname===expectedHost;
 if(url.protocol!=='https:'||!allowedHost||url.pathname!=='/'||url.search||url.hash||url.username||url.password)
  throw new Error('ROSE_INVALID_ORIGIN');
 return url.origin;
}
function pathId(value:string):string{return encodeURIComponent(Id.parse(value));}

/** Rose Rocket Platform v2 only. No v1 endpoint or tenant credentials are inferred. */
export class RoseRocketClient {
 private readonly fetcher:typeof fetch;
 private readonly apiOrigin:string;
 private readonly authOrigin:string;
 private token?:{value:string;expiresAt:number};
 readonly orgId:string;
 constructor(private readonly options:RoseRocketClientOptions){
  this.fetcher=options.fetcher??fetch;
  this.apiOrigin=origin(options.apiOrigin??'https://network.roserocket.com','network.roserocket.com');
  this.authOrigin=origin(options.authOrigin??'https://a.roserocket.com','a.roserocket.com');
  this.orgId=Id.parse(options.account.orgId);
  Id.parse(options.account.userId);
  if(!options.account.clientId||!options.account.clientSecret)throw new Error('ROSE_CREDENTIALS_REQUIRED');
 }
 private async accessToken():Promise<string>{
  if(this.token&&this.token.expiresAt>Date.now()+60_000)return this.token.value;
  const response=await this.fetcher(`${this.authOrigin}/oauth/token`,{
   method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({grant_type:'client_credentials',client_id:this.options.account.clientId,client_secret:this.options.account.clientSecret,
    audience:'https://roserocket.com',org_id:this.orgId,user_id:this.options.account.userId}),signal:AbortSignal.timeout(15_000),
  });
  if(!response.ok)throw new Error(`ROSE_AUTH_HTTP_${response.status}`);
  const parsed=TokenResponse.parse(await response.json());
  // An unspecified expiry is deliberately short; a future request reauthenticates.
  this.token={value:parsed.access_token,expiresAt:Date.now()+Math.min(parsed.expires_in??300,3600)*1000};
  return this.token.value;
 }
 private async request(path:string):Promise<Response>{
  if(!path.startsWith('/api/v2/platformModel/')||path.startsWith('//')||path.includes('..'))throw new Error('ROSE_INVALID_PATH');
  const get=async()=>this.fetcher(`${this.apiOrigin}${path}`,{
   method:'GET',redirect:'error',headers:{Authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(20_000),
  });
  let response=await get();
  if(response.status===401){this.token=undefined;response=await get();}
  if(!response.ok)throw new Error(`ROSE_API_HTTP_${response.status}`);
  return response;
 }
 /** Verify a customer's service account using Rose Rocket's documented read-only /me request. */
 async verifyAccess():Promise<void>{
  const response=await this.fetcher(`${this.apiOrigin}/api/v1/me`,{
   method:'GET',redirect:'error',headers:{Authorization:`Bearer ${await this.accessToken()}`},signal:AbortSignal.timeout(20_000),
  });
  if(!response.ok)throw new Error(`ROSE_ACCESS_HTTP_${response.status}`);
  await response.body?.cancel();
 }
 async getObject(key:RoseObjectKey,id:string):Promise<RoseObject>{
  ObjectKey.parse(key);
  const response=await this.request(`/api/v2/platformModel/objects/${pathId(id)}?objectKey=${key}&paths=documents.file,documents.externalUrl`);
  const object=RoseObject.parse(await response.json());
  if(object.orgId!==this.orgId||object.id!==id||object.objectKey!==key)throw new Error('ROSE_OBJECT_SCOPE_MISMATCH');
  return object;
 }
 async downloadPdf(document:RoseDocument):Promise<Buffer>{
  const parsed=Document.parse(document);
  // External URLs can be presigned third-party links. Until a real tenant validates
  // their host/redirect behavior, only same-origin Platform document paths are read.
  const path=parsed.externalUrl;
  if(!path||!path.startsWith('/api/v2/platformModel/documents/')||path.startsWith('//')||path.includes('..')||/[?#]/.test(path))
   throw new Error('ROSE_DOCUMENT_URL_UNSUPPORTED');
  const response=await this.request(path);
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>MAX_PDF_BYTES)throw new Error('ROSE_DOCUMENT_TOO_LARGE');
  if(!response.body)throw new Error('ROSE_DOCUMENT_EMPTY');
  const reader=response.body.getReader();const parts:Buffer[]=[];let total=0;
  try{
   while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;
    if(total>MAX_PDF_BYTES)throw new Error('ROSE_DOCUMENT_TOO_LARGE');parts.push(Buffer.from(part.value));}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(parts);
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('ROSE_DOCUMENT_NOT_PDF');
  return bytes;
 }
}

export const RoseWebhookEvent=z.object({
 id:Id,type:z.string().min(1),refId:Id,ownerId:Id,orgId:Id,
 createdAt:z.string().datetime({offset:true}),objectKey:z.string().min(1),json:z.record(z.unknown()).optional(),
}).passthrough();
export type RoseWebhookEvent=z.infer<typeof RoseWebhookEvent>;

/** Events are hints to refetch; never trust their embedded business fields. */
export function roseEventHint(payload:unknown,expectedOrgId:string):{eventId:string;orderId:string;occurredAt:string}|null{
 const event=RoseWebhookEvent.parse(payload);
 if(event.orgId!==Id.parse(expectedOrgId))throw new Error('ROSE_EVENT_SCOPE_MISMATCH');
 // Platform v2 documents an order-status subscription but does not specify the
 // exact value of `type`. Any order event is only a hint to refetch from the API.
 if(event.objectKey!=='order')return null;
 return {eventId:event.id,orderId:event.refId,occurredAt:event.createdAt};
}
