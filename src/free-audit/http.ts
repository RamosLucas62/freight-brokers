import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {unzipSync} from 'fflate';
import type {RateLimiter} from '../security/rate-limit.js';
import {clientIp,privacyKey} from '../security/rate-limit.js';
import {HttpError,readBody} from '../security/http.js';
import {verifyTurnstile} from '../security/turnstile.js';
import {freeAuditObjectKey,putInvoiceObject,deleteInvoiceObjects} from '../storage/r2.js';
import {sendSecurityEmail} from '../notifications/security.sender.js';
import * as repository from './repository.js';
import {repeatOfferEmail,verificationEmail} from './artifacts.js';
import {failure,info,requestId,warn} from '../observability/logger.js';

const MAX_BODY_BYTES=105*1024*1024;
const MAX_TOTAL_BYTES=100*1024*1024;
const MAX_PDF_BYTES=20*1024*1024;
const MAX_FILES=50;
const Input=z.object({
 name:z.string().trim().min(2).max(120),company:z.string().trim().min(2).max(200),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
 phone:z.string().trim().max(40).optional(),loads_per_month:z.string().trim().max(40).optional(),turnstile_token:z.string().max(4096).optional(),consent:z.literal(true),
});

interface PdfUpload {name:string;bytes:Buffer;hash:string;}

function respond(res:ServerResponse,status:number,body:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function cleanFilename(value:string){const name=value.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g,'').trim()||'invoice.pdf';return name.slice(0,240);}
function tokenHash(value:string){return createHash('sha256').update(value).digest('hex');}
function isPdf(bytes:Buffer){return bytes.subarray(0,1024).includes(Buffer.from('%PDF-'));}

async function parseForm(req:IncomingMessage):Promise<{input:z.infer<typeof Input>;files:File[]}> {
 const contentType=req.headers['content-type']??'';
 if(!contentType.toLowerCase().startsWith('multipart/form-data;'))throw new HttpError(415,'multipart_required');
 const body=await readBody(req,MAX_BODY_BYTES);
 let form:FormData;
 try{form=await new Response(new Uint8Array(body),{headers:{'Content-Type':contentType}}).formData();}catch{throw new HttpError(400,'invalid_multipart');}
 const consent=['true','1','on','yes'].includes(String(form.get('consent')??'').toLowerCase());
 const input=Input.parse({name:form.get('name'),company:form.get('company'),email:form.get('email'),phone:form.get('phone')||undefined,loads_per_month:form.get('loads_per_month')||form.get('loads')||undefined,turnstile_token:form.get('turnstile_token')||undefined,consent});
 const entries=[...form.getAll('files'),...form.getAll('invoices')].filter((value):value is File=>value instanceof Blob&&typeof (value as File).name==='string');
 if(!entries.length)throw new HttpError(400,'files_required');
 return {input,files:entries};
}

async function pdfsFromFiles(files:File[]):Promise<PdfUpload[]>{
 const candidates:{name:string;bytes:Buffer}[]=[];let expandedTotal=0;
 for(const file of files){
  const bytes=Buffer.from(await file.arrayBuffer());const name=cleanFilename(file.name);
  if(bytes.length>MAX_TOTAL_BYTES)throw new HttpError(413,'files_too_large');
  if(name.toLowerCase().endsWith('.zip')||file.type==='application/zip'){
   let declaredTotal=0;let entries:Record<string,Uint8Array>;
   try{entries=unzipSync(bytes,{filter(info){
    const pdf=info.name.toLowerCase().endsWith('.pdf')&&!info.name.endsWith('/');
    if(!pdf)return false;
    if(info.originalSize>MAX_PDF_BYTES)throw new Error('PDF_TOO_LARGE');
    declaredTotal+=info.originalSize;if(declaredTotal>MAX_TOTAL_BYTES)throw new Error('ZIP_TOO_LARGE');
    return true;
   }});}catch{throw new HttpError(400,'invalid_or_unsafe_zip');}
   for(const [entry,data] of Object.entries(entries))candidates.push({name:cleanFilename(entry),bytes:Buffer.from(data)});
  }else candidates.push({name,bytes});
 }
 if(!candidates.length||candidates.length>MAX_FILES)throw new HttpError(400,candidates.length?'too_many_files':'pdfs_required');
 const unique=new Map<string,PdfUpload>();
 for(const item of candidates){
  expandedTotal+=item.bytes.length;if(expandedTotal>MAX_TOTAL_BYTES)throw new HttpError(413,'files_too_large');
  if(item.bytes.length>MAX_PDF_BYTES)throw new HttpError(413,'pdf_too_large');
  if(!item.name.toLowerCase().endsWith('.pdf')||!isPdf(item.bytes))throw new HttpError(400,'pdfs_only');
  const hash=createHash('sha256').update(item.bytes).digest('hex');
  if(!unique.has(hash))unique.set(hash,{...item,hash});
 }
 return [...unique.values()];
}

function cors(req:IncomingMessage,res:ServerResponse,allowedOrigin:string):boolean{
 const origin=typeof req.headers.origin==='string'?req.headers.origin:'';
 if(origin!==allowedOrigin)return false;
 res.setHeader('Access-Control-Allow-Origin',allowedOrigin);res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('Vary','Origin');
 return true;
}

export function createFreeAuditHttpHandler(config:{allowedOrigin:string;publicUrl:string;offerUrl:string}){
 return async(req:IncomingMessage,res:ServerResponse,limiter:RateLimiter):Promise<boolean>=>{
  const url=new URL(req.url??'/',config.publicUrl);const submit=url.pathname==='/webhooks/free-audit';const verify=url.pathname==='/free-audit/verify';
  if(!submit&&!verify)return false;
  const ip=clientIp(req.headers,req.socket.remoteAddress);
  if(submit&&req.method==='OPTIONS'){
   if(!cors(req,res,config.allowedOrigin)){respond(res,403,{error:'origin_not_allowed'});return true;}
   res.writeHead(204,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});res.end();return true;
  }
  if(submit&&req.method==='POST'){
   const traceId=requestId(req);
   if(!cors(req,res,config.allowedOrigin)){warn('free_audit.submission.rejected',{request_id:traceId,reason:'origin_not_allowed'});respond(res,403,{error:'origin_not_allowed'});req.resume();return true;}
   try{
    const ipRate=await limiter.consume({scope:'free-audit-ip',key:ip,limit:3,windowSeconds:86400,failClosed:true});
    if(!ipRate.allowed){warn('free_audit.submission.rate_limited',{request_id:traceId,scope:'ip',retry_after_seconds:ipRate.retryAfter});res.setHeader('Retry-After',String(ipRate.retryAfter));respond(res,429,{error:'too_many_requests'});req.resume();return true;}
    const {input,files}=await parseForm(req);
    const emailRate=await limiter.consume({scope:'free-audit-email',key:input.email,limit:3,windowSeconds:86400,failClosed:true});
    if(!emailRate.allowed){warn('free_audit.submission.rate_limited',{request_id:traceId,scope:'email',retry_after_seconds:emailRate.retryAfter});res.setHeader('Retry-After',String(emailRate.retryAfter));respond(res,429,{error:'too_many_requests'});return true;}
    if(!(await verifyTurnstile(input.turnstile_token,ip))){warn('free_audit.submission.rejected',{request_id:traceId,reason:'turnstile_failed'});respond(res,403,{error:'security_verification_failed'});return true;}
    const token=randomBytes(32).toString('base64url');
    const registered=await repository.registerRequest({email:input.email,name:input.name,company:input.company,phone:input.phone,loads:input.loads_per_month,tokenHash:tokenHash(token),ipFingerprint:privacyKey(ip)});
    info('free_audit.request.registered',{request_id:traceId,audit_request_id:registered.request_id,action:registered.action,submitted_files:files.length});
    if(registered.action==='repeat'){
     if(registered.offer_allowed){const offer=repeatOfferEmail(input.name,config.offerUrl);try{await sendSecurityEmail({to:input.email,...offer,idempotencyKey:`free-audit-offer-${registered.request_id}-${registered.offer_number}`});}catch(error){await repository.releaseOffer(registered.request_id,registered.offer_number);throw error;}}
     info('free_audit.offer.completed',{request_id:traceId,audit_request_id:registered.request_id,email_sent:registered.offer_allowed});respond(res,202,{accepted:true,message:'Check your email for the next step.'});return true;
    }
    if(registered.action==='in_progress'){respond(res,202,{accepted:true,message:'Your request is already being received.'});return true;}
    if(registered.action==='created'||registered.action==='replace'){
     const uploaded:string[]=[];let oldObjectsDeleted=registered.action!=='replace';
     try{
      if(registered.action==='replace'){const previous=await repository.loadAttachments(registered.request_id);await deleteInvoiceObjects(previous.map(file=>file.storage_path));oldObjectsDeleted=true;await repository.clearAttachments(registered.request_id);}
      const pdfs=await pdfsFromFiles(files);
      for(const pdf of pdfs){const attachmentId=randomUUID();const path=freeAuditObjectKey(registered.request_id,attachmentId);await putInvoiceObject(path,pdf.bytes);uploaded.push(path);await repository.saveAttachment({request_id:registered.request_id,attachment_id:attachmentId,filename:pdf.name,storage_path:path,document_hash:pdf.hash,size_bytes:pdf.bytes.length});}
      await repository.markUploaded(registered.request_id);
      info('free_audit.upload.completed',{request_id:traceId,audit_request_id:registered.request_id,pdf_count:pdfs.length,total_bytes:pdfs.reduce((sum,pdf)=>sum+pdf.bytes.length,0)});
     }catch(error){await deleteInvoiceObjects(uploaded).catch(()=>{});if(oldObjectsDeleted)await repository.failUpload(registered.request_id);else await repository.markUploaded(registered.request_id).catch(()=>{});throw error;}
    }
    const verificationUrl=new URL('/free-audit/verify',config.publicUrl);verificationUrl.searchParams.set('token',token);
    const email=verificationEmail(input.name,verificationUrl.href);await sendSecurityEmail({to:input.email,...email,idempotencyKey:`free-audit-verify-${tokenHash(token).slice(0,24)}`});
    info('free_audit.verification_email.sent',{request_id:traceId,audit_request_id:registered.request_id});
    respond(res,202,{accepted:true,message:'Check your email to confirm and start the audit.'});return true;
   }catch(error){
    if(error instanceof z.ZodError){respond(res,400,{error:'invalid_request'});return true;}
    if(error instanceof HttpError){respond(res,error.status,{error:error.code});return true;}
    failure('free_audit.submission.failed',error,{request_id:traceId});respond(res,503,{error:'temporarily_unavailable'});return true;
   }
  }
  if(verify&&req.method==='GET'){
   try{
    const rate=await limiter.consume({scope:'free-audit-verification',key:ip,limit:20,windowSeconds:3600,failClosed:true});
    if(!rate.allowed){respond(res,429,{error:'too_many_requests'});return true;}
    const token=url.searchParams.get('token')??'';
    const valid=/^[A-Za-z0-9_-]{43}$/.test(token)?await repository.verifyRequest(tokenHash(token)):null;
    const success=Boolean(valid);info('free_audit.verification.completed',{request_id:requestId(req),audit_request_id:valid,success});res.writeHead(success?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:620px;margin:80px auto;padding:24px;color:#171717"><p style="color:#ef5427;font-weight:bold">OLYMPIAN</p><h1>${success?'Email confirmed. Your audit has started.':'This confirmation link is invalid or has expired.'}</h1><p>${success?'We will email the report when it is ready.':'Return to the free audit page to request a new confirmation link.'}</p><p><a href="${config.offerUrl.replaceAll('&','&amp;').replaceAll('"','&quot;')}">View Olympian plans</a></p></body></html>`);return true;
   }catch(error){failure('free_audit.verification.failed',error,{request_id:requestId(req)});respond(res,503,{error:'temporarily_unavailable'});return true;}
  }
  respond(res,405,{error:'method_not_allowed'});return true;
 };
}
