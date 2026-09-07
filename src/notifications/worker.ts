import * as repository from './repository.js';
import {composeEmail,createCsv,createPdf} from './artifacts.js';
import {ResendSender} from './resend.sender.js';

export async function processNotification(sender:ResendSender,portalUrl:string):Promise<boolean>{
 const delivery=await repository.claimNotification();
 if(!delivery)return false;
 try{
  const data=await repository.loadNotification(delivery);
  if(!data.recipients.length)throw new Error('NO_VERIFIED_REPORT_RECIPIENTS');
  const email=composeEmail(data,portalUrl);
  const basename=delivery.period_key.replace(':','-');
  await sender.send({idempotencyKey:delivery.id,to:data.recipients,...email,attachments:[
   {filename:`invoice-audit-${basename}.pdf`,content:createPdf(data)},
   {filename:`invoice-audit-${basename}.csv`,content:createCsv(data)},
  ]});
  await repository.finishNotification(delivery);return true;
 }catch(error){await repository.finishNotification(delivery,error);throw error;}
}

export function startNotificationWorker(sender:ResendSender,portalUrl:string){
 let stopping=false;let running:Promise<void>|null=null;
 const tick=()=>{if(stopping||running)return;running=(async()=>{
  try{await repository.enqueueDueNotifications();for(let i=0;i<25&&await processNotification(sender,portalUrl);i++);}
  catch(error){console.error('[notifications] Delivery failed',error instanceof Error?error.message:'unknown_error');}
 })().finally(()=>{running=null;});};
 const timer=setInterval(tick,60000);tick();
 return async()=>{stopping=true;clearInterval(timer);await running;};
}
