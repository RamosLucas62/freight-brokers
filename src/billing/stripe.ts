import Stripe from 'stripe';
import {privacyKey} from '../security/rate-limit.js';
import {readResponseBody} from '../security/http.js';
import {paymentLink,type BillingPeriod,type PlanCode} from './plans.js';

type StripeReference=string|{id?:string}|null;
export type StripeCheckoutSession={id:string;url?:string|null;payment_status?:string;status?:string;customer?:StripeReference;subscription?:StripeReference;customer_details?:{email?:string|null};metadata?:Record<string,string>} ;
export type StripeSubscription={id:string;status?:string;customer?:StripeReference;trial_end?:number|null;metadata?:Record<string,string>;items?:{data?:Array<{price?:{id?:string}}>} };

function config(){
 const secret=process.env.STRIPE_SECRET_KEY;
 if(!secret)throw new Error('STRIPE_NOT_CONFIGURED');
 return secret;
}
async function stripe(path:string,init:RequestInit={}){
 const response=await fetch('https://api.stripe.com/v1'+path,{...init,signal:init.signal??AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${config()}`,...init.headers}});
 const data=await readResponseBody(response,2*1024*1024).then(bytes=>JSON.parse(bytes.toString('utf8'))).catch(()=>({}));
 if(!response.ok)throw new Error(typeof data.error?.message==='string'?data.error.message:'STRIPE_REQUEST_FAILED');
 return data;
}
export async function createCheckoutSession(email:string,plan:PlanCode,period:BillingPeriod,_cancelUrl?:string,clientReferenceId?:string){
 const url=new URL(paymentLink(plan,period));
 url.searchParams.set('prefilled_email',email);
 if(clientReferenceId)url.searchParams.set('client_reference_id',clientReferenceId);
 return {id:`payment-link-${plan}-${period}`,url:url.href,status:'open'} satisfies StripeCheckoutSession;
}
export async function retrieveCheckoutSession(id:string){
 return stripe('/checkout/sessions/'+encodeURIComponent(id)) as Promise<StripeCheckoutSession>;
}
export async function retrieveSubscription(id:string){
 return stripe('/subscriptions/'+encodeURIComponent(id)) as Promise<StripeSubscription>;
}
export async function createBillingPortalSession(customerId:string){
 const origin=process.env.PORTAL_URL;
 const configuration=process.env.STRIPE_PORTAL_CONFIGURATION_ID;
 if(!origin||!configuration)throw new Error('STRIPE_NOT_CONFIGURED');
 const body=new URLSearchParams({customer:customerId,configuration,return_url:new URL('/',origin).href});
 return stripe('/billing_portal/sessions',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`billing-portal-${privacyKey(customerId).slice(0,48)}-${Math.floor(Date.now()/300000)}`}}) as Promise<{url:string}>;
}
export async function applyRetentionDiscount(subscriptionId:string,tenantId:string){
 const coupon=process.env.STRIPE_RETENTION_COUPON_ID;
 if(!coupon)throw new Error('STRIPE_RETENTION_NOT_CONFIGURED');
 const body=new URLSearchParams({'discounts[0][coupon]':coupon});
 return stripe('/subscriptions/'+encodeURIComponent(subscriptionId),{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`retention-discount-${tenantId}`}});
}
export async function pauseSubscriptionOneMonth(subscriptionId:string,tenantId:string,resumesAt:Date){
 const body=new URLSearchParams({'pause_collection[behavior]':'void','pause_collection[resumes_at]':String(Math.floor(resumesAt.getTime()/1000))});
 return stripe('/subscriptions/'+encodeURIComponent(subscriptionId),{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`retention-pause-${tenantId}-${resumesAt.getUTCFullYear()}`}});
}
export async function cancelSubscriptionAtPeriodEnd(subscriptionId:string,tenantId:string){
 const body=new URLSearchParams({cancel_at_period_end:'true'});
 return stripe('/subscriptions/'+encodeURIComponent(subscriptionId),{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`cancel-at-period-end-${tenantId}`}});
}
export async function createOverageInvoice(input:{settlementId:string;customerId:string;subscriptionId:string;usageMonth:string;overageCount:number;unitAmountCents:number}){
 const amount=input.overageCount*input.unitAmountCents;
 const item=new URLSearchParams({customer:input.customerId,subscription:input.subscriptionId,amount:String(amount),currency:'usd',
  description:`${input.overageCount} additional invoice${input.overageCount===1?'':'s'} · ${input.usageMonth}`,
  'metadata[usage_settlement_id]':input.settlementId,'metadata[usage_month]':input.usageMonth,'metadata[overage_count]':String(input.overageCount)});
 await stripe('/invoiceitems',{method:'POST',body:item,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`overage-item-${input.settlementId}`}});
 const invoice=new URLSearchParams({customer:input.customerId,subscription:input.subscriptionId,collection_method:'charge_automatically',auto_advance:'true',pending_invoice_item_behavior:'include',
  description:`Freight Audit monthly overage · ${input.usageMonth}`,'metadata[usage_settlement_id]':input.settlementId});
 return stripe('/invoices',{method:'POST',body:invoice,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`overage-invoice-${input.settlementId}`}}) as Promise<{id:string}>;
}
export function verifyStripeSignature(raw:string,header:string|undefined){
 const secret=process.env.STRIPE_WEBHOOK_SECRET;
 if(!secret||!header)throw new Error('STRIPE_SIGNATURE_INVALID');
 try{
  const event=Stripe.webhooks.constructEvent(raw,header,secret,300);
  return {id:event.id,type:event.type,created:event.created,data:{object:event.data.object as unknown as Record<string,unknown>}};
 }
 catch{throw new Error('STRIPE_SIGNATURE_INVALID');}
}
