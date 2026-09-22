import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {dashboard} from '../dashboard/handler.js';
import {Webhook} from 'svix';
import {ReceivedEvent} from '../inbound/events.js';
import {verifyStripeSignature} from '../billing/stripe.js';
import {enqueueStripeEvent} from '../billing/repository.js';
import {createRateLimiter,clientIp,type RateLimiter} from '../security/rate-limit.js';
import {HttpError,readBody,securityHeaders} from '../security/http.js';
import {increment,metricsAuthorized,renderMetrics} from '../observability/metrics.js';
import {beginRequest,failure,info,requestId,warn} from '../observability/logger.js';
import {RoseWebhookEvent,type RoseWebhookEvent as RoseEvent} from '../tms/rose-rocket.js';
import {roseSyncToken} from '../tms/rose-sync.js';
import {enqueueRoseEvent} from '../tms/rose-rocket.repository.js';
import type {RoseEnqueueResult} from '../tms/rose-rocket.repository.js';
export interface HttpDependencies {
 secret:string;
 enqueue:(eventId:string,event:ReceivedEvent)=>Promise<void>;
 ready:()=>Promise<boolean>;
 limiter?:RateLimiter;
 freeAudit?:(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,limiter:RateLimiter)=>Promise<boolean>;
 roseWebhook?:{token:string;orgId:string;enqueue:(event:RoseEvent)=>Promise<RoseEnqueueResult>};
}
function equalWebhookToken(actual:string,expected:string):boolean{
 const left=createHash('sha256').update(actual).digest();
 const right=createHash('sha256').update(expected).digest();
 return timingSafeEqual(left,right);
}
export function createApp(deps:HttpDependencies) {
 const webhook=new Webhook(deps.secret);
 const limiter=deps.limiter??createRateLimiter();
 let readyCache:{value:boolean;until:number}|undefined;
 const server=createServer(async(req,res)=>{
  const traceId=beginRequest(req);const started=Date.now();
  res.setHeader('X-Request-Id',traceId);
  res.once('finish',()=>{const path=new URL(req.url??'/','http://local').pathname;
   info('http.request.completed',{request_id:traceId,method:req.method,path:(path.startsWith('/webhooks/rose-rocket/')||path.startsWith('/webhooks/rose-sync/'))?'/webhooks/rose-rocket/[redacted]':path,status_code:res.statusCode,duration_ms:Date.now()-started});});
  securityHeaders(res);
  if(req.method==='GET'&&req.url==='/internal/metrics'){
   if(!metricsAuthorized(typeof req.headers.authorization==='string'?req.headers.authorization:undefined)){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'});res.end(renderMetrics());return;
  }
  const respond=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const ip=clientIp(req.headers,req.socket.remoteAddress);
  const roseSyncPath=new URL(req.url??'/','http://local').pathname;
  if(roseSyncPath.startsWith('/webhooks/rose-sync/')){
   const match=roseSyncPath.match(/^\/webhooks\/rose-sync\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{43})$/);
   if(req.method!=='POST'){respond(405,{error:'method_not_allowed'});req.resume();return;}
   const rate=await limiter.consume({scope:'rose-sync-webhook',key:ip,limit:120,windowSeconds:60,failClosed:true});
   if(!rate.allowed){respond(429,{error:'too_many_requests'});req.resume();return;}
   if(!match||!process.env.ROSE_ROCKET_CREDENTIAL_KEY||!equalWebhookToken(match[2],roseSyncToken(match[1]))){respond(401,{error:'unauthorized'});req.resume();return;}
   if(req.headers['content-type']?.split(';',1)[0].trim()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
   try{
    const event=RoseWebhookEvent.safeParse(JSON.parse((await readBody(req,64*1024)).toString('utf8')));
    if(!event.success){respond(400,{error:'invalid_event'});return;}
    if(event.data.orgId!==match[1]||event.data.objectKey!=='order'){respond(202,{status:'ignored'});return;}
    const result=await enqueueRoseEvent(event.data);respond(result==='rate_limited'?429:202,{status:result});
   }catch(error){respond(error instanceof HttpError?error.status:error instanceof SyntaxError?400:503,{error:error instanceof SyntaxError?'invalid_event':'temporarily_unavailable'});}return;
  }
  if(new URL(req.url??'/','http://local').pathname.startsWith('/webhooks/rose-rocket/')){
   const path=new URL(req.url??'/','http://local').pathname;
   if(!deps.roseWebhook){respond(404,{error:'not_found'});req.resume();return;}
   if(req.method!=='POST'){respond(405,{error:'method_not_allowed'});req.resume();return;}
   const supplied=path.slice('/webhooks/rose-rocket/'.length);
   if(!/^[A-Za-z0-9_-]{48,128}$/.test(supplied)||!equalWebhookToken(supplied,deps.roseWebhook.token)){
    const rate=await limiter.consume({scope:'invalid-rose-token',key:ip,limit:10,windowSeconds:60});
    if(!rate.allowed)res.setHeader('Retry-After',String(rate.retryAfter));
    respond(rate.allowed?401:429,{error:rate.allowed?'unauthorized':'too_many_requests'});req.resume();return;
   }
   if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
   let event:RoseEvent;
   try{event=RoseWebhookEvent.parse(JSON.parse((await readBody(req,64*1024)).toString('utf8')));}
   catch(error){respond(error instanceof HttpError?error.status:400,{error:error instanceof HttpError?'payload_too_large':'invalid_event'});return;}
   if(event.orgId!==deps.roseWebhook.orgId){respond(202,{status:'ignored'});return;}
   if(event.objectKey!=='order'){respond(200,{status:'ignored'});return;}
   try{
    const result=await deps.roseWebhook.enqueue(event);
    if(result==='rate_limited'){respond(429,{error:'too_many_requests'});return;}
    info('rose.webhook.received',{request_id:traceId,event_id:event.id,org_id:event.orgId,queued:result==='queued'});
    respond(202,{status:result==='queued'?'queued':'ignored'});return;
   }catch(error){failure('rose.webhook.enqueue_failed',error,{request_id:traceId,event_id:event.id});respond(503,{error:'temporarily_unavailable'});return;}
  }
  if(deps.freeAudit&&await deps.freeAudit(req,res,limiter))return;
  if(await dashboard(req,res,limiter))return;
  if(req.method==='GET' && req.url==='/healthz'){respond(200,{status:'ok'});return;}
  if(req.method==='GET' && req.url==='/readyz'){
   try{if(!readyCache||readyCache.until<Date.now())readyCache={value:await deps.ready(),until:Date.now()+5000};const ready=readyCache.value;respond(ready?200:503,{status:ready?'ready':'unavailable'});}catch(error){failure('health.readiness.failed',error,{request_id:traceId});respond(503,{status:'unavailable'});}return;
  }
  if(req.url==='/webhooks/stripe'&&req.method==='POST'){
   if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
   let raw:string;
   try{raw=(await readBody(req,256*1024)).toString('utf8');}catch(error){respond(error instanceof HttpError?error.status:400,{error:'payload_too_large'});return;}
   let event;
   try{event=verifyStripeSignature(raw,typeof req.headers['stripe-signature']==='string'?req.headers['stripe-signature']:undefined);}
   catch(error){increment('stripe_webhook_invalid_total');warn('stripe.webhook.rejected',{request_id:traceId,reason:'invalid_signature'});const rate=await limiter.consume({scope:'invalid-stripe-signature',key:ip,limit:10,windowSeconds:60});if(!rate.allowed)res.setHeader('Retry-After',String(rate.retryAfter));respond(rate.allowed?401:429,{error:rate.allowed?'invalid_signature':'too_many_requests'});return;}
   try{const created=await enqueueStripeEvent(event);increment('stripe_webhook_accepted_total');info('stripe.webhook.accepted',{request_id:traceId,event_id:event.id,event_type:event.type,queue_created:created});respond(200,{received:true});return;}
   catch(error){increment('stripe_webhook_failed_total');failure('stripe.webhook.enqueue_failed',error,{request_id:traceId,event_id:event.id,event_type:event.type});respond(503,{error:'temporarily_unavailable'});return;}
  }
  if(req.url!=='/webhooks/resend' || req.method!=='POST'){respond(404,{error:'not_found'});return;}
  if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
  try{
   const chunks=[await readBody(req,256*1024)];
   let verified:unknown;
   const headers:Record<string,string>={};
   for(const key of ['svix-id','svix-timestamp','svix-signature']){const value=req.headers[key];if(typeof value!=='string'){respond(401,{error:'invalid_signature'});return;}headers[key]=value;}
   try{const raw=Buffer.concat(chunks).toString('utf8');webhook.verify(raw,headers);verified=JSON.parse(raw);}catch{increment('resend_webhook_invalid_total');const rate=await limiter.consume({scope:'invalid-resend-signature',key:ip,limit:10,windowSeconds:60});if(!rate.allowed)res.setHeader('Retry-After',String(rate.retryAfter));respond(rate.allowed?401:429,{error:rate.allowed?'invalid_signature':'too_many_requests'});return;}
   if((verified as {type?:string})?.type!=='email.received'){info('resend.webhook.ignored',{request_id:traceId,event_type:(verified as {type?:string})?.type??'unknown'});respond(200,{status:'ignored'});return;}
   const event=ReceivedEvent.safeParse(verified);
   if(!event.success){respond(400,{error:'invalid_event'});return;}
   await deps.enqueue(headers['svix-id'],event.data);
   increment('resend_webhook_accepted_total');
   info('resend.webhook.accepted',{request_id:traceId,event_id:headers['svix-id'],email_id:event.data.data.email_id});
   respond(200,{status:'accepted'});
  }catch(error){failure('resend.webhook.failed',error,{request_id:requestId(req)});if(!res.headersSent)respond(error instanceof HttpError?error.status:503,{error:error instanceof HttpError?'payload_too_large':'temporarily_unavailable'});}
 });
 server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;server.maxRequestsPerSocket=1000;
 return server;
}
