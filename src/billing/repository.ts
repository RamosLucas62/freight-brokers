import {getSupabaseClient} from '../config/supabase.js';
import {selectionFromPriceId} from './plans.js';

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
 try{await processStripeEvent(item.payload);const done=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:true,p_error:null});if(done.error)throw done.error;return true;}
 catch(error){const failed=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:false,p_error:error instanceof Error?error.message:'PROCESSING_FAILED'});if(failed.error)throw failed.error;throw error;}
}

export async function processStripeEvent(event:StripeEvent){
 const supported=new Set(['checkout.session.completed','invoice.payment_failed','invoice.paid','customer.subscription.updated','customer.subscription.deleted']);
 if(!supported.has(event.type))return false;
 if(!event.id||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const {data,error}=await getSupabaseClient().rpc('process_stripe_billing_event',{
  p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_object:event.data.object,
 });
 if(error)throw error;
 if(event.type==='customer.subscription.updated'){
  const object=event.data.object;const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
  const items=typeof object.items==='object'&&object.items?object.items as {data?:Array<{price?:{id?:unknown}}>}:{},selection=selectionFromPriceId(items.data?.[0]?.price?.id);
  const plan=selection?.plan??metadata.plan_code,period=selection?.period??metadata.billing_period;
  if((plan==='core'||plan==='scale')&&(period==='monthly'||period==='semiannual'||period==='annual')){
   const synced=await getSupabaseClient().rpc('sync_billing_plan_from_stripe',{p_subscription_id:String(object.id??''),p_plan:plan,p_period:period});if(synced.error)throw synced.error;
  }
 }
 return Boolean(data);
}
