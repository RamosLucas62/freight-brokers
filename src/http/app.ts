import {createServer} from 'node:http';
import {Webhook} from 'svix';
import {ReceivedEvent} from '../inbound/events.js';
export interface HttpDependencies {
 secret:string;
 enqueue:(eventId:string,event:ReceivedEvent)=>Promise<void>;
 ready:()=>Promise<boolean>;
}
export function createApp(deps:HttpDependencies) {
 const webhook=new Webhook(deps.secret);
 const server=createServer(async(req,res)=>{
  const respond=(code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method==='GET' && req.url==='/healthz'){respond(200,{status:'ok'});return;}
  if(req.method==='GET' && req.url==='/readyz'){
   try{const ready=await deps.ready();respond(ready?200:503,{status:ready?'ready':'unavailable'});}catch{respond(503,{status:'unavailable'});}return;
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
