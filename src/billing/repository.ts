import {getSupabaseClient} from '../config/supabase.js';

export interface StripeEvent {id:string;type:string;created?:number;data?:{object?:Record<string,unknown>}}

export async function processStripeEvent(event:StripeEvent){
 const supported=new Set(['checkout.session.completed','invoice.payment_failed','invoice.paid','customer.subscription.updated','customer.subscription.deleted']);
 if(!supported.has(event.type))return false;
 if(!event.id||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const {data,error}=await getSupabaseClient().rpc('process_stripe_billing_event',{
  p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_object:event.data.object,
 });
 if(error)throw error;
 return Boolean(data);
}
