import {getSupabaseClient} from '../config/supabase.js';
import {notifyLeadFunnel} from '../notifications/google-chat.sender.js';
import {selectionFromSubscription} from './plans.js';
import {errorFields,failure,info} from '../observability/logger.js';

export interface StripeEvent {id:string;type:string;created?:number;data?:{object?:Record<string,unknown>}}
interface StripeQueueItem {event_id:string;event_type:string;event_created:number;payload:StripeEvent;attempts:number;}
interface BillingContext {billing_email?:string|null;status?:string|null;plan_code?:string|null;billing_period?:string|null;}
interface LeadContext {email?:string;name?:string;company?:string;}

async function billingContext(subscriptionId:string):Promise<BillingContext|null>{
 const result=await getSupabaseClient().from('audit_billing_customers').select('billing_email,status,plan_code,billing_period').eq('stripe_subscription_id',subscriptionId).maybeSingle();
 if(result.error){failure('stripe.notification_context.billing_failed',result.error,{subscription_id:subscriptionId});return null;}
 return result.data as BillingContext|null;
}

async function leadContext(email:unknown):Promise<LeadContext>{
 if(typeof email!=='string'||!email.trim())return {};
 const normalized=email.trim().toLowerCase();
 const result=await getSupabaseClient().from('free_audit_requests').select('email,contact_name,company_name').eq('email',normalized).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(result.error){failure('stripe.notification_context.lead_failed',result.error,{email_domain:normalized.split('@')[1]??'unknown'});return {email:normalized};}
 const row=result.data as {email?:string|null;contact_name?:string|null;company_name?:string|null}|null;
 return {email:row?.email??normalized,name:row?.contact_name??undefined,company:row?.company_name??undefined};
}

export async function enqueueStripeEvent(event:StripeEvent):Promise<boolean>{
 if(!event.id||!event.type||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const {data,error}=await getSupabaseClient().rpc('enqueue_stripe_webhook',{p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_payload:event});
 if(error)throw error;return Boolean(data);
}

export async function processNextStripeEvent():Promise<boolean>{
 const db=getSupabaseClient();const claimed=await db.rpc('claim_stripe_webhook');if(claimed.error)throw claimed.error;
 const item=(claimed.data as StripeQueueItem[]|null)?.[0];if(!item)return false;
 const started=Date.now();info('stripe.event.processing',{event_id:item.event_id,event_type:item.event_type});
 try{
  const applied=await processStripeEvent(item.payload);
  const done=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:true,p_error:null});
  if(done.error){failure('stripe.event.completion_record_failed',done.error,{event_id:item.event_id,event_type:item.event_type});return true;}
  info('stripe.event.completed',{event_id:item.event_id,event_type:item.event_type,applied,duration_ms:Date.now()-started});return true;
 }catch(error){
  const fields=errorFields(error);const code=String(fields.error_code??'STRIPE_EVENT_PROCESSING_FAILED');
  const failed=await db.rpc('finish_stripe_webhook',{p_event_id:item.event_id,p_success:false,p_error:code});
  if(failed.error){failure('stripe.event.failure_record_failed',failed.error,{event_id:item.event_id,event_type:item.event_type,original_error_code:code});return true;}
  if(code==='STRIPE_SUBSCRIPTION_NOT_READY'&&item.attempts<12){
   info('stripe.event.deferred',{event_id:item.event_id,event_type:item.event_type,error_code:code,attempt:item.attempts,retry_in_seconds:60,duration_ms:Date.now()-started});return true;
  }
  failure('stripe.event.failed',error,{event_id:item.event_id,event_type:item.event_type,attempt:item.attempts,duration_ms:Date.now()-started});return true;
 }
}

export async function processStripeEvent(event:StripeEvent){
 const supported=new Set(['checkout.session.completed','invoice.payment_failed','invoice.paid','customer.subscription.updated','customer.subscription.deleted']);
 if(!supported.has(event.type))return false;
 if(!event.id||!event.data?.object)throw new Error('INVALID_STRIPE_EVENT');
 const subscriptionId=event.type==='customer.subscription.updated'?String(event.data.object.id??''):'';
 const previousBilling=subscriptionId?await billingContext(subscriptionId):null;
 const {data,error}=await getSupabaseClient().rpc('process_stripe_billing_event',{
  p_event_id:event.id,p_event_type:event.type,p_event_created:event.created??0,p_object:event.data.object,
 });
 if(error)throw error;
 if(event.type==='checkout.session.completed'&&data){
  const object=event.data.object;
  const customerDetails=typeof object.customer_details==='object'&&object.customer_details?object.customer_details as Record<string,unknown>:{};
  const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
  const contact=await leadContext(customerDetails.email??object.customer_email);
  const stage=object.payment_status==='no_payment_required'?'trial_started':'client_signed';
  void notifyLeadFunnel({stage,requestId:String(object.id??event.id),...contact,name:contact.name??(typeof customerDetails.name==='string'?customerDetails.name:undefined),company:contact.company??(typeof metadata.company_name==='string'?metadata.company_name:undefined),metadata:{plan:metadata.plan_code??metadata.plan,period:metadata.billing_period,subscription:object.subscription??null}}).catch(error=>failure('google_chat.lead_notification.failed',error,{event_id:event.id,stage}));
 }
 if(event.type==='customer.subscription.updated'){
  const object=event.data.object;const metadata=typeof object.metadata==='object'&&object.metadata?object.metadata as Record<string,unknown>:{};
  const selection=selectionFromSubscription(object);
  const plan=selection?.plan??metadata.plan_code,period=selection?.period??metadata.billing_period;
  if((plan==='core'||plan==='growth'||plan==='scale')&&(period==='monthly'||period==='semiannual'||period==='annual')){
   const synced=await getSupabaseClient().rpc('sync_billing_plan_from_stripe',{p_subscription_id:subscriptionId,p_plan:plan,p_period:period});if(synced.error)throw synced.error;
   const trialEnded=previousBilling?.status==='trialing'&&object.status==='active';
   const planChanged=Boolean(previousBilling&&((previousBilling.plan_code&&previousBilling.plan_code!==plan)||(previousBilling.billing_period&&previousBilling.billing_period!==period)));
   const stage=trialEnded?'trial_ended':planChanged?'plan_changed':null;
   if(stage){const contact=await leadContext(previousBilling?.billing_email);void notifyLeadFunnel({stage,requestId:subscriptionId||String(event.id),...contact,metadata:{plan,period,status:object.status??null}}).catch(error=>failure('google_chat.lead_notification.failed',error,{event_id:event.id,stage}));}
  }
 }
 return Boolean(data);
}
