import {createServer} from 'node:http';
import {dashboard} from '../dashboard/handler.js';
import {Webhook} from 'svix';
import {ReceivedEvent} from '../inbound/events.js';
import {verifyStripeSignature} from '../billing/stripe.js';
import {enqueueStripeEvent} from '../billing/repository.js';
import {createRateLimiter,clientIp,type RateLimiter} from '../security/rate-limit.js';
import {HttpError,readBody,securityHeaders} from '../security/http.js';
import {increment,metricsAuthorized,renderMetrics} from '../observability/metrics.js';
export interface HttpDependencies {
 secret:string;
 enqueue:(eventId:string,event:ReceivedEvent)=>Promise<void>;
 ready:()=>Promise<boolean>;
 limiter?:RateLimiter;
 freeAudit?:(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,limiter:RateLimiter)=>Promise<boolean>;
}
export function createApp(deps:HttpDependencies) {
 const webhook=new Webhook(deps.secret);
 const limiter=deps.limiter??createRateLimiter();
 let readyCache:{value:boolean;until:number}|undefined;
 const server=createServer(async(req,res)=>{
  securityHeaders(res);
  if(req.method==='GET'&&req.url==='/internal/metrics'){
   if(!metricsAuthorized(typeof req.headers.authorization==='string'?req.headers.authorization:undefined)){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'});res.end(renderMetrics());return;
  }
  if(deps.freeAudit&&await deps.freeAudit(req,res,limiter))return;
  if(await dashboard(req,res,limiter))return;
  const respond=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const ip=clientIp(req.headers,req.socket.remoteAddress);
  if(req.method==='GET' && req.url==='/healthz'){respond(200,{status:'ok'});return;}
  if(req.method==='GET' && req.url==='/readyz'){
   try{if(!readyCache||readyCache.until<Date.now())readyCache={value:await deps.ready(),until:Date.now()+5000};const ready=readyCache.value;respond(ready?200:503,{status:ready?'ready':'unavailable'});}catch{respond(503,{status:'unavailable'});}return;
  }
  if(req.url==='/webhooks/stripe'&&req.method==='POST'){
   if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
   let raw:string;
   try{raw=(await readBody(req,256*1024)).toString('utf8');}catch(error){respond(error instanceof HttpError?error.status:400,{error:'payload_too_large'});return;}
   let event;
   try{event=verifyStripeSignature(raw,typeof req.headers['stripe-signature']==='string'?req.headers['stripe-signature']:undefined);}
   catch{increment('stripe_webhook_invalid_total');const rate=await limiter.consume({scope:'invalid-stripe-signature',key:ip,limit:10,windowSeconds:60});if(!rate.allowed)res.setHeader('Retry-After',String(rate.retryAfter));respond(rate.allowed?401:429,{error:rate.allowed?'invalid_signature':'too_many_requests'});return;}
   try{await enqueueStripeEvent(event);increment('stripe_webhook_accepted_total');respond(200,{received:true});return;}
   catch{increment('stripe_webhook_failed_total');respond(503,{error:'temporarily_unavailable'});return;}
  }
  if(req.url!=='/webhooks/resend' || req.method!=='POST'){respond(404,{error:'not_found'});return;}
  if(req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json'){respond(415,{error:'json_required'});req.resume();return;}
  try{
   const chunks=[await readBody(req,256*1024)];
   let verified:unknown;
   const headers:Record<string,string>={};
   for(const key of ['svix-id','svix-timestamp','svix-signature']){const value=req.headers[key];if(typeof value!=='string'){respond(401,{error:'invalid_signature'});return;}headers[key]=value;}
   try{const raw=Buffer.concat(chunks).toString('utf8');webhook.verify(raw,headers);verified=JSON.parse(raw);}catch{increment('resend_webhook_invalid_total');const rate=await limiter.consume({scope:'invalid-resend-signature',key:ip,limit:10,windowSeconds:60});if(!rate.allowed)res.setHeader('Retry-After',String(rate.retryAfter));respond(rate.allowed?401:429,{error:rate.allowed?'invalid_signature':'too_many_requests'});return;}
   if((verified as {type?:string})?.type!=='email.received'){respond(200,{status:'ignored'});return;}
   const event=ReceivedEvent.safeParse(verified);
   if(!event.success){respond(400,{error:'invalid_event'});return;}
   await deps.enqueue(headers['svix-id'],event.data);
   increment('resend_webhook_accepted_total');
   respond(200,{status:'accepted'});
  }catch(error){if(!res.headersSent)respond(error instanceof HttpError?error.status:503,{error:error instanceof HttpError?'payload_too_large':'temporarily_unavailable'});}
 });
 server.requestTimeout=120000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=100;server.maxRequestsPerSocket=1000;
 return server;
}
