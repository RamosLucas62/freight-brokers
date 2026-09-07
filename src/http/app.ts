import {createServer} from 'node:http';
import {dashboard} from '../dashboard/handler.js';
import {Webhook} from 'svix';
import {ReceivedEvent} from '../inbound/events.js';
import {verifyStripeSignature} from '../billing/stripe.js';
import {getSupabaseClient} from '../config/supabase.js';
export interface HttpDependencies {
 secret:string;
 enqueue:(eventId:string,event:ReceivedEvent)=>Promise<void>;
 ready:()=>Promise<boolean>;
}
export function createApp(deps:HttpDependencies) {
 const webhook=new Webhook(deps.secret);
 const server=createServer(async(req,res)=>{
  if(await dashboard(req,res))return;
  const respond=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method==='GET' && req.url==='/healthz'){respond(200,{status:'ok'});return;}
  if(req.method==='GET' && req.url==='/readyz'){
   try{const ready=await deps.ready();respond(ready?200:503,{status:ready?'ready':'unavailable'});}catch{respond(503,{status:'unavailable'});}return;
  }
  if(req.url==='/webhooks/stripe'&&req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=Buffer.from(chunk).toString('utf8');
   try{
    const event=verifyStripeSignature(raw,typeof req.headers['stripe-signature']==='string'?req.headers['stripe-signature']:undefined);
    const object=event.data?.object??{};
    const db=getSupabaseClient();
    if(event.type==='checkout.session.completed'){
     await db.from('audit_billing_customers').upsert({stripe_checkout_session_id:object.id,stripe_customer_id:object.customer,stripe_subscription_id:object.subscription,billing_email:object.customer_details?.email?.toLowerCase()??object.customer_email?.toLowerCase(),status:object.payment_status==='paid'?'active':'pending_payment'},{onConflict:'stripe_checkout_session_id'});
    }
    if(event.type==='customer.subscription.deleted'||event.type==='customer.subscription.updated'){
     const status=event.type==='customer.subscription.deleted'?'canceled':object.status==='past_due'?'past_due':object.status==='active'?'active':'paused';
     await db.from('audit_billing_customers').update({status,updated_at:new Date().toISOString()}).eq('stripe_subscription_id',object.id);
     const billing=await db.from('audit_billing_customers').select('tenant_id').eq('stripe_subscription_id',object.id).maybeSingle();
     if(billing.data?.tenant_id)await db.from('audit_tenants').update({status:status==='active'?'active':status==='past_due'?'paused':'inactive'}).eq('id',billing.data.tenant_id);
    }
    respond(200,{received:true});return;
   }catch{respond(401,{error:'invalid_signature'});return;}
  }
  if(req.url!=='/webhooks/resend' || req.method!=='POST'){respond(404,{error:'not_found'});return;}
  if(!req.headers['content-type']?.startsWith('application/json')){respond(415,{error:'json_required'});req.resume();return;}
  const length=Number(req.headers['content-length']??0);
  if(length>256*1024){respond(413,{error:'payload_too_large'});req.resume();return;}
  try{
   let size=0;const chunks:Buffer[]=[];
   for await(const chunk of req){size+=chunk.length;if(size>256*1024){respond(413,{error:'payload_too_large'});return;}chunks.push(Buffer.from(chunk));}
   let verified:unknown;
   const headers:Record<string,string>={};
   for(const key of ['svix-id','svix-timestamp','svix-signature']){const value=req.headers[key];if(typeof value!=='string'){respond(401,{error:'invalid_signature'});return;}headers[key]=value;}
   try{const raw=Buffer.concat(chunks).toString('utf8');webhook.verify(raw,headers);verified=JSON.parse(raw);}catch{respond(401,{error:'invalid_signature'});return;}
   if((verified as {type?:string})?.type!=='email.received'){respond(200,{status:'ignored'});return;}
   const event=ReceivedEvent.safeParse(verified);
   if(!event.success){respond(400,{error:'invalid_event'});return;}
   await deps.enqueue(headers['svix-id'],event.data);
   respond(200,{status:'accepted'});
  }catch{if(!res.headersSent)respond(503,{error:'temporarily_unavailable'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return server;
}
