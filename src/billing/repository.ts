import {getSupabaseClient} from '../config/supabase.js';
import {notifyLeadFunnel} from '../notifications/google-chat.sender.js';
import {selectionFromSubscription} from './plans.js';
import {failure,info} from '../observability/logger.js';

export interface StripeEvent {id:string;type:string;created?:number;data?:{object?:Record<string,unknown>}}
interface StripeQueueItem {event_id:string;event_type:string;event_created:number;payload:StripeEvent;}

export async function enqueueStripeEvent(event:StripeEvent):Promise<boolean>{
 if(!event.id||!event.type||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const {data,error}=await getSupabaseClient().rpc('enqueue_stripe_webhook',{p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_payload:event});
 if(error)throw error;return Boolean(data);
}

export async function processNextStripeEvent():Promise<boolean>{
 const db=getSupabaseClient();const claimed=await db.rpc('claim_stripe_webhook');if(claimed.error)throw claimed.error;
 const item=(claimed.data as StripeQueueItem[]|null)?.[0];if(!item)return false;
 const started=Date.now();info('stripe.event.processing',{event_id:item.event_id,event_type:item.event_type});
 try{const applied=await processStripeEvent(item.payload);const done=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:true,p_error:null});if(done.error)throw done.error;info('stripe.event.completed',{event_id:item.event_id,event_type:item.event_type,applied,duration_ms:Date.now()-started});return true;}
 catch(error){failure('stripe.event.failed',error,{event_id:item.event_id,event_type:item.event_type,duration_ms:Date.now()-started});const failed=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:false,p_error:error instanceof Error?error.message:'PROCESSING_FAILED'});if(failed.error)throw failed.error;throw error;}
}

export async function processStripeEvent(event:StripeEvent){
 const supported=new Set(['checkout.session.completed','invoice.payment_failed','invoice.paid','customer.subscription.updated','customer.subscription.deleted']);
 if(!supported.has(event.type))return false;
 if(!event.id||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const {data,error}=await getSupabaseClient().rpc('process_stripe_billing_event',{
  p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_object:event.data.object,
 });
 if(error)throw error;
 if(event.type==='checkout.session.completed'&&data){
  const object=event.data.object;
  const customerDetails=typeof object.customer_details==='object'&&object.customer_details?object.customer_details as Record<string,unknown>:{};
  const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
  void notifyLeadFunnel({stage:'client_signed',requestId:String(object.id??event.id),email:typeof customerDetails.email==='string'?customerDetails.email:undefined,metadata:{plan:metadata.plan_code??metadata.plan,period:metadata.billing_period,subscription:object.subscription??null}}).catch(error=>failure('google_chat.lead_notification.failed',error,{event_id:event.id,stage:'client_signed'}));
 }
 if(event.type==='customer.subscription.updated'){
  const object=event.data.object;const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
  const selection=selectionFromSubscription(object);
  const plan=selection?.plan??metadata.plan_code,period=selection?.period??metadata.billing_period;
  if((plan==='core'||plan==='growth'||plan==='scale')&&(period==='monthly'||period==='semiannual'||period==='annual')){
   const synced=await getSupabaseClient().rpc('sync_billing_plan_from_stripe',{p_subscription_id:String(object.id??''),p_plan:plan,p_period:period});if(synced.error)throw synced.error;
   void notifyLeadFunnel({stage:'plan_changed',requestId:String(object.id??event.id),metadata:{plan,period,status:object.status??null}}).catch(error=>failure('google_chat.lead_notification.failed',error,{event_id:event.id,stage:'plan_changed'}));
  }
 }
 return Boolean(data);
}
