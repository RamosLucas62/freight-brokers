import Stripe from 'stripe';
import {privacyKey} from '../security/rate-limit.js';
import {readResponseBody} from '../security/http.js';

export type StripeCheckoutSession={id:string;url?:string|null;payment_status?:string;status?:string;customer?:string;subscription?:string;customer_details?:{email?:string|null}};

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
export async function createCheckoutSession(email:string){
 const price=process.env.STRIPE_PRICE_ID;
 const origin=process.env.PORTAL_URL;
 if(!price||!origin)throw new Error('STRIPE_NOT_CONFIGURED');
 const body=new URLSearchParams({
  mode:'subscription',
  'line_items[0][price]':price,
  'line_items[0][quantity]':'1',
  customer_email:email,
  success_url:new URL('/onboarding?session_id={CHECKOUT_SESSION_ID}',origin).href,
  cancel_url:new URL('/',origin).href,
  allow_promotion_codes:'true',
 });
 return stripe('/checkout/sessions',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`checkout-${privacyKey(email).slice(0,48)}`}}) as Promise<StripeCheckoutSession>;
}
export async function retrieveCheckoutSession(id:string){
 return stripe('/checkout/sessions/'+encodeURIComponent(id)) as Promise<StripeCheckoutSession>;
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
export function verifyStripeSignature(raw:string,header:string|undefined){
 const secret=process.env.STRIPE_WEBHOOK_SECRET;
 if(!secret||!header)throw new Error('STRIPE_SIGNATURE_INVALID');
 try{
  const event=Stripe.webhooks.constructEvent(raw,header,secret,300);
  return {id:event.id,type:event.type,created:event.created,data:{object:event.data.object as unknown as Record<string,unknown>}};
 }
 catch{throw new Error('STRIPE_SIGNATURE_INVALID');}
}
