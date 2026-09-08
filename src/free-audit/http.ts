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
function escapeHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}
function page(res:ServerResponse,status:number,content:string){
 const nonce=randomBytes(18).toString('base64url');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Olympian free audit</title><style nonce="${nonce}">
 :root{color-scheme:light;--ink:#11110f;--paper:#f7f7f0;--panel:#fff;--muted:#66665f;--line:#d8d8ce;--orange:#ef5427;--soft:#efefe7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,Helvetica,sans-serif;min-height:100vh}.top{height:78px;border-top:3px solid var(--ink);border-bottom:1px solid var(--ink);display:flex;align-items:center;padding:0 clamp(22px,5vw,72px);font-size:21px;letter-spacing:.02em}.dot{width:9px;height:9px;border-radius:50%;background:var(--orange);margin-right:13px}.shell{width:min(1040px,calc(100% - 32px));margin:clamp(48px,9vh,110px) auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(310px,440px);gap:clamp(36px,8vw,110px);align-items:center}.copy h1{font-size:clamp(42px,6vw,72px);line-height:.98;letter-spacing:-.055em;margin:0 0 26px;max-width:760px}.copy p{font-size:18px;line-height:1.55;color:var(--muted);max-width:590px;margin:0}.card{background:var(--panel);border:2px solid var(--ink);border-radius:14px;padding:clamp(24px,4vw,40px);box-shadow:9px 10px 0 var(--ink)}.status{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--orange);color:#fff;font-size:28px;font-weight:700;margin-bottom:28px}.card h2{font-size:28px;letter-spacing:-.025em;margin:0 0 12px}.card p{color:var(--muted);line-height:1.5;margin:0 0 24px}.action{display:inline-block;background:var(--orange);color:#fff;border:2px solid var(--ink);border-radius:7px;padding:14px 19px;text-decoration:none;font-weight:700;box-shadow:4px 4px 0 var(--ink)}.action:focus-visible,input:focus-visible{outline:3px solid #3156d8;outline-offset:3px}.drop{display:block;border:2px dashed #aaa99f;border-radius:9px;background:var(--soft);padding:28px 18px;margin:22px 0 18px;text-align:center;font-weight:700}.drop small{display:block;color:var(--muted);font-weight:400;margin-top:8px}.drop input{display:block;width:100%;margin-top:18px}.note{font-size:13px!important}.error{border-left:4px solid var(--orange);padding-left:14px;color:#8a3017!important}.action-button{width:100%;cursor:pointer;font-size:16px}.footer{position:fixed;bottom:0;left:0;right:0;border-top:1px solid var(--line);padding:15px;text-align:center;color:var(--muted);font-size:13px;background:rgba(247,247,240,.94)}@media(max-width:760px){.shell{grid-template-columns:1fr;margin:38px auto 90px}.copy h1{font-size:42px}.top{height:66px}.footer{position:static}}@media(prefers-reduced-motion:no-preference){.card{animation:settle .35s ease-out both}@keyframes settle{from{transform:translateY(8px);opacity:.3}}}
 </style></head><body><header class="top"><span class="dot"></span>Olympian</header>${content}<footer class="footer">Private documents are encrypted in transit and deleted after 30 days.</footer></body></html>`;
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,'Content-Length':String(Buffer.byteLength(html))});res.end(html);
}
function confirmationPage(success:boolean,offerUrl:string){
 const title=success?'Email confirmed. Your audit is underway.':'This confirmation link is no longer valid.';
 const detail=success?'We are reviewing your carrier invoices now. Your report will arrive by email when it is ready.':'The link may have expired or already been used. Return to the free audit page to request a new one.';
 return `<main class="shell"><section class="copy"><h1>${title}</h1><p>${detail}</p></section><section class="card"><div class="status">${success?'✓':'!'}</div><h2>${success?'Nothing else to do':'Request a fresh link'}</h2><p>${success?'You can close this page. We will keep you updated in your inbox.':'Your uploaded files will not be processed without a valid confirmation.'}</p><a class="action" href="${escapeHtml(offerUrl)}">${success?'Explore Olympian plans':'Return to Olympian'}</a></section></main>`;
}
function retryPage(token:string,valid:boolean,state:'ready'|'uploaded'|'error'='ready'){
 const action=`/free-audit/retry?token=${encodeURIComponent(token)}`;
 if(state==='uploaded')return `<main class="shell"><section class="copy"><h1>Your new files are in.</h1><p>We kept your contact details and restarted the audit. The report will arrive by email when it is ready.</p></section><section class="card"><div class="status">✓</div><h2>Upload complete</h2><p>You can close this page. No second email confirmation is required.</p></section></main>`;
 if(!valid)return `<main class="shell"><section class="copy"><h1>This upload link is no longer valid.</h1><p>The private link may have expired or already been used.</p></section><section class="card"><div class="status">!</div><h2>Request another link</h2><p>Reply to the audit email and our team can help you continue securely.</p></section></main>`;
 return `<main class="shell"><section class="copy"><h1>Replace your invoice files.</h1><p>Your name, company, email and audit details are already saved. Upload only the corrected PDFs below.</p></section><form class="card" method="post" enctype="multipart/form-data" action="${escapeHtml(action)}"><div class="status">↥</div><h2>Choose replacement files</h2>${state==='error'?'<p class="error">We could not use those files. Choose readable, unencrypted PDFs or a ZIP containing only PDFs.</p>':'<p>The previous files will be replaced after this upload succeeds.</p>'}<label class="drop">PDF or ZIP<input type="file" name="files" accept="application/pdf,.pdf,application/zip,.zip" multiple required><small>Up to 50 PDFs · 20 MB each · 100 MB total</small></label><button class="action action-button" type="submit">Upload files and restart audit</button><p class="note">This private link expires in 72 hours and can be used once.</p></form></main>`;
}
function submissionMessage(code:string){
 if(['payload_too_large','files_too_large','pdf_too_large'].includes(code))return 'The upload is too large. Each PDF must be 20 MB or smaller, with no more than 100 MB total.';
 if(['pdfs_only','pdfs_required','files_required','invalid_or_unsafe_zip','too_many_files','invalid_multipart','multipart_required','invalid_request'].includes(code))return 'Attach up to 50 valid, unencrypted PDF files, or a ZIP containing only those PDFs.';
 return 'We could not receive the audit right now. Please try again in a moment.';
}
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

async function parseRetryFiles(req:IncomingMessage):Promise<File[]>{
 const contentType=req.headers['content-type']??'';
 if(!contentType.toLowerCase().startsWith('multipart/form-data;'))throw new HttpError(415,'multipart_required');
 const body=await readBody(req,MAX_BODY_BYTES);let form:FormData;
 try{form=await new Response(new Uint8Array(body),{headers:{'Content-Type':contentType}}).formData();}catch{throw new HttpError(400,'invalid_multipart');}
 const files=[...form.getAll('files')].filter((value):value is File=>value instanceof Blob&&typeof (value as File).name==='string');
 if(!files.length)throw new HttpError(400,'files_required');return files;
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

function cors(req:IncomingMessage,res:ServerResponse,allowedOrigins:string[]):boolean{
 const origin=typeof req.headers.origin==='string'?req.headers.origin:'';
 if(!allowedOrigins.includes(origin))return false;
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('Vary','Origin');
 return true;
}

export function createFreeAuditHttpHandler(config:{allowedOrigins:string[];publicUrl:string;offerUrl:string}){
 return async(req:IncomingMessage,res:ServerResponse,limiter:RateLimiter):Promise<boolean>=>{
  const url=new URL(req.url??'/',config.publicUrl);const submit=url.pathname==='/webhooks/free-audit';const verify=url.pathname==='/free-audit/verify';const retry=url.pathname==='/free-audit/retry';
  if(!submit&&!verify&&!retry)return false;
  const ip=clientIp(req.headers,req.socket.remoteAddress);
  if(submit&&req.method==='OPTIONS'){
   if(!cors(req,res,config.allowedOrigins)){respond(res,403,{error:'origin_not_allowed'});return true;}
   res.writeHead(204,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});res.end();return true;
  }
  if(submit&&req.method==='POST'){
   const traceId=requestId(req);
   if(!cors(req,res,config.allowedOrigins)){warn('free_audit.submission.rejected',{request_id:traceId,reason:'origin_not_allowed'});respond(res,403,{error:'origin_not_allowed'});req.resume();return true;}
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
    if(error instanceof z.ZodError){respond(res,400,{error:'invalid_request',message:submissionMessage('invalid_request')});return true;}
    if(error instanceof HttpError){respond(res,error.status,{error:error.code,message:submissionMessage(error.code)});return true;}
    failure('free_audit.submission.failed',error,{request_id:traceId});respond(res,503,{error:'temporarily_unavailable'});return true;
   }
  }
  if(verify&&req.method==='GET'){
   try{
    const rate=await limiter.consume({scope:'free-audit-verification',key:ip,limit:20,windowSeconds:3600,failClosed:true});
    if(!rate.allowed){respond(res,429,{error:'too_many_requests'});return true;}
    const token=url.searchParams.get('token')??'';
    const valid=/^[A-Za-z0-9_-]{43}$/.test(token)?await repository.verifyRequest(tokenHash(token)):null;
    const success=Boolean(valid);info('free_audit.verification.completed',{request_id:requestId(req),audit_request_id:valid,success});page(res,success?200:400,confirmationPage(success,config.offerUrl));return true;
   }catch(error){failure('free_audit.verification.failed',error,{request_id:requestId(req)});respond(res,503,{error:'temporarily_unavailable'});return true;}
  }
  if(retry&&req.method==='GET'){
   const token=url.searchParams.get('token')??'';const hash=/^[A-Za-z0-9_-]{43}$/.test(token)?tokenHash(token):'';
   try{const valid=Boolean(hash)&&await repository.inspectRetry(hash);info('free_audit.retry.opened',{request_id:requestId(req),valid});page(res,valid?200:400,retryPage(token,valid));return true;}
   catch(error){failure('free_audit.retry.open_failed',error,{request_id:requestId(req)});page(res,503,retryPage('',false));return true;}
  }
  if(retry&&req.method==='POST'){
   const traceId=requestId(req);const token=url.searchParams.get('token')??'';const hash=/^[A-Za-z0-9_-]{43}$/.test(token)?tokenHash(token):'';
   let retryRequest:string|null=null;const uploaded:string[]=[];
   try{
    const rate=await limiter.consume({scope:'free-audit-retry-ip',key:ip,limit:5,windowSeconds:86400,failClosed:true});
    if(!rate.allowed){page(res,429,retryPage('',false));req.resume();return true;}
    if(!hash){page(res,400,retryPage('',false));req.resume();return true;}
    const files=await parseRetryFiles(req);const pdfs=await pdfsFromFiles(files);
    retryRequest=await repository.beginRetry(hash);if(!retryRequest){page(res,400,retryPage('',false));return true;}
    const previous=await repository.loadAttachments(retryRequest);await deleteInvoiceObjects(previous.map(file=>file.storage_path));await repository.clearAttachments(retryRequest);
    for(const pdf of pdfs){const attachmentId=randomUUID();const path=freeAuditObjectKey(retryRequest,attachmentId);await putInvoiceObject(path,pdf.bytes);uploaded.push(path);await repository.saveAttachment({request_id:retryRequest,attachment_id:attachmentId,filename:pdf.name,storage_path:path,document_hash:pdf.hash,size_bytes:pdf.bytes.length});}
    await repository.finishRetry(retryRequest,hash);info('free_audit.retry.completed',{request_id:traceId,audit_request_id:retryRequest,pdf_count:pdfs.length});page(res,200,retryPage('',true,'uploaded'));return true;
   }catch(error){
    await deleteInvoiceObjects(uploaded).catch(()=>{});if(retryRequest){await repository.clearAttachments(retryRequest).catch(()=>{});await repository.failRetry(retryRequest,hash).catch(()=>{});}
    if(error instanceof HttpError){warn('free_audit.retry.rejected',{request_id:traceId,reason:error.code});page(res,error.status,retryPage(token,true,'error'));return true;}
    failure('free_audit.retry.failed',error,{request_id:traceId,audit_request_id:retryRequest});page(res,503,retryPage(token,true,'error'));return true;
   }
  }
  respond(res,405,{error:'method_not_allowed'});return true;
 };
}
