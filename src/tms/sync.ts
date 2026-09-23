import {v5 as uuidv5} from 'uuid';
import {z} from 'zod';
import {getSupabaseClient,operationalDatabaseError} from '../config/supabase.js';
import {decryptTmsCredentials} from './credentials.js';
import {decryptRoseCredentials} from './rose-rocket.credentials.js';
import {RoseRocketClient} from './rose-rocket.js';
import {RoseDocumentConnector} from './rose-sync.js';
import {TaiClient,TaiCredentials} from './tai.js';
import {McLeodClient} from './mcleod.js';
import type {DocumentConnector,TmsDocument} from './documents.js';
import type {InboundJob} from '../inbound/repository.js';
import type {Attachment} from '../inbound/resend.js';
import {failure,warn,info,errorFields} from '../observability/logger.js';

export interface SyncConnection {tenant_id:string;provider:string;credentials_ciphertext:string;connection_version:string;sync_claim:string;}
const namespace='8a6b571e-78e5-4916-8482-adbb72b3b466';
export function connector(connection:SyncConnection):DocumentConnector{
 if(connection.provider==='rose-rocket')return new RoseDocumentConnector(new RoseRocketClient({account:decryptRoseCredentials(connection.credentials_ciphertext)}));
 const credentials=decryptTmsCredentials(connection.tenant_id,connection.provider,connection.credentials_ciphertext);
 if(connection.provider==='tai')return new TaiClient(TaiCredentials.parse(credentials));
 if(connection.provider==='mcleod')return new McLeodClient(credentials);
 throw new Error('TMS_CONNECTOR_UNAVAILABLE');
}
export function documentBatch(connection:SyncConnection,recordId:string,documents:TmsDocument[]){
 const sorted=[...documents].sort((a,b)=>a.id.localeCompare(b.id));
 const snapshot=sorted.map(doc=>({externalId:doc.id,attachmentId:uuidv5(`${connection.provider}:${recordId}:${doc.id}:${doc.revision}`,namespace),revision:doc.revision}));
 // Credential rotations must not create duplicate billable jobs.
 const batch=uuidv5(JSON.stringify([connection.tenant_id,connection.provider,recordId,snapshot]),namespace);
 return {batch,snapshot};
}
export async function syncConnection(connection:SyncConnection,client?:DocumentConnector){
 const db=getSupabaseClient();let code:string|null=null;const observed:Array<{record:string;batch:string|null}>=[];
 try{
  const started=Date.now();
  for await(const record of (client??connector(connection)).records()){
   if(Date.now()-started>10*60_000)throw new Error('TMS_SYNC_TIME_LIMIT');
   if(observed.length>=10000)throw new Error('TMS_COVERAGE_LIMIT');
   if(!record.documents.length){observed.push({record:record.id,batch:null});continue;}
   const {batch,snapshot}=documentBatch(connection,record.id,record.documents);
   const result=await db.rpc('enqueue_tms_documents',{p_tenant:connection.tenant_id,p_provider:connection.provider,p_version:connection.connection_version,p_claim:connection.sync_claim,p_batch:batch,p_record:record.id,p_documents:snapshot});
   if(result.error)throw new Error('TMS_ENQUEUE_FAILED');
   observed.push({record:record.id,batch});
  }
 }catch(error){code=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)?error.message:'TMS_SYNC_FAILED';failure('tms.sync.failed',new Error(code),{tenant_id:connection.tenant_id,provider:connection.provider});}
 const finished=await db.rpc('finish_tms_coverage',{p_tenant:connection.tenant_id,p_provider:connection.provider,p_version:connection.connection_version,p_claim:connection.sync_claim,p_error:code,p_records:code?null:observed});
 if(finished.error)throw operationalDatabaseError('TMS_SYNC_UPDATE_FAILED',finished.error);
}
/** Backoff and alert suppression are local to this worker process. Warnings
 * retain each retry in logs without emitting another Google Chat error alert. */
export function startTmsSyncWorker(){
 const normalDelay=5000,alertInterval=15*60_000;
 let stopped=false,running:Promise<void>|null=null,timer:ReturnType<typeof setTimeout>|undefined;
 let attempts=0,lastFingerprint='',lastAlertAt=0,suppressed=0;
 const tick=()=>{
  if(stopped||running)return;
  let delay=normalDelay;
  running=(async()=>{
   try{
    const result=await getSupabaseClient().rpc('claim_tms_sync');
    if(result.error)throw operationalDatabaseError('TMS_CLAIM_FAILED',result.error);
    if(result.data?.[0])await syncConnection(result.data[0]);
    if(attempts)info('tms.sync.worker_recovered',{failed_attempts:attempts,suppressed_alerts:suppressed});
    attempts=0;lastFingerprint='';lastAlertAt=0;suppressed=0;
   }catch(error){
    attempts++;
    delay=Math.min(300_000,15_000*2**Math.min(attempts-1,5));
    const safe=errorFields(error);
    const fingerprint=JSON.stringify([safe.error_code,safe.provider_code,safe.provider_reason]);
    const context={attempt:attempts,retry_in_seconds:delay/1000,suppressed_alerts:suppressed};
    if(fingerprint!==lastFingerprint||Date.now()-lastAlertAt>=alertInterval){
     failure('tms.sync.worker_failed',error,context);
     lastFingerprint=fingerprint;lastAlertAt=Date.now();suppressed=0;
    }else{
     suppressed++;
     warn('tms.sync.worker_retry',{...safe,...context,suppressed_alerts:suppressed});
    }
   }
  })().finally(()=>{running=null;if(!stopped)timer=setTimeout(tick,delay);});
 };
 tick();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);await running;};
}

/** Read references from a service-role-created job, then refetch links using that
 * company's current connection. No webhook URLs or customer-supplied bytes are trusted. */
export class TmsReceivingClient{
 readonly kind='tms';private documents=new Map<string,TmsDocument>();
 constructor(private readonly job:InboundJob){}
 async authorize():Promise<void>{
  const db=getSupabaseClient();const {data,error}=await db.from('audit_tms_connections').select('tenant_id,provider,credentials_ciphertext,connection_version,status,sync_enabled').eq('tenant_id',this.job.tenant_id).eq('provider',this.job.tms_provider).maybeSingle();
  if(error||!data||!data.sync_enabled||data.status!=='verified'||data.connection_version!==this.job.tms_connection_version)throw new Error('TMS_CONNECTION_INACTIVE');
 }
 async attachments():Promise<Attachment[]>{
  await this.authorize();const {data,error}=await getSupabaseClient().from('audit_tms_connections').select('*').eq('tenant_id',this.job.tenant_id).eq('provider',this.job.tms_provider).maybeSingle();if(error||!data)throw new Error('TMS_CONNECTION_INACTIVE');
  const requested=z.array(z.object({externalId:z.string(),attachmentId:z.string().uuid(),revision:z.string()})).min(1).max(100).parse(this.job.tms_documents);
  const record=await connector(data).record(z.string().min(1).parse(this.job.tms_record_id));
  return requested.map(expected=>{
   const doc=record.documents.find(item=>item.id===expected.externalId&&item.revision===expected.revision);
   if(!doc)throw new Error('TMS_DOCUMENT_CHANGED');this.documents.set(expected.attachmentId,doc);
   return {id:expected.attachmentId,filename:doc.filename,content_type:'application/pdf',size:0,download_url:'https://unused.invalid'};
  });
 }
 async download(attachment:Attachment):Promise<Buffer>{await this.authorize();const doc=this.documents.get(attachment.id);if(!doc)throw new Error('TMS_DOCUMENT_NOT_FOUND');return doc.download();}
 async metadata(){throw new Error('TMS_IS_NOT_EMAIL');}
 async isAutomatic(){return false;}
}
