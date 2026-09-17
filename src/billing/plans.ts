export type PlanCode='core'|'growth'|'scale';
export type BillingPeriod='monthly'|'semiannual'|'annual';

export const plans={
 core:{name:'Core',includedInvoices:500,overageCents:75,maxRecipients:3,maxSenders:1,reprocessing:false},
 growth:{name:'Growth',includedInvoices:1500,overageCents:50,maxRecipients:500,maxSenders:500,reprocessing:true},
 scale:{name:'Scale',includedInvoices:3000,overageCents:50,maxRecipients:500,maxSenders:500,reprocessing:true},
} as const;

export const prices={
 core:{monthly:{amount:49700,env:'STRIPE_PRICE_CORE_MONTHLY'},semiannual:{amount:268200,env:'STRIPE_PRICE_CORE_SEMIANNUAL'},annual:{amount:497000,env:'STRIPE_PRICE_CORE_ANNUAL'}},
 growth:{monthly:{amount:99700,env:'STRIPE_PRICE_GROWTH_MONTHLY'},semiannual:{amount:538200,env:'STRIPE_PRICE_GROWTH_SEMIANNUAL'},annual:{amount:997000,env:'STRIPE_PRICE_GROWTH_ANNUAL'}},
 scale:{monthly:{amount:149700,env:'STRIPE_PRICE_SCALE_MONTHLY'},semiannual:{amount:808200,env:'STRIPE_PRICE_SCALE_SEMIANNUAL'},annual:{amount:1497000,env:'STRIPE_PRICE_SCALE_ANNUAL'}},
} as const;

export const paymentLinks={
 core:{
  monthly:'https://buy.stripe.com/6oUaEPbuO1Xh3xh38FcQU00',
  semiannual:'https://buy.stripe.com/6oU3cnfL46dxc3N38FcQU01',
  annual:'https://buy.stripe.com/6oU14fdCW45p8RBbFbcQU02',
 },
 growth:{
  monthly:'https://buy.stripe.com/5kQaEPbuO59t6JtbFbcQU03',
  semiannual:'https://buy.stripe.com/cNicMX2Yi8lFffZbFbcQU04',
  annual:'https://buy.stripe.com/7sYfZ99mGdFZ6JtdNjcQU05',
 },
 scale:{
  monthly:'https://buy.stripe.com/bJe7sDfL459t1p95gNcQU06',
  semiannual:'https://buy.stripe.com/4gMfZ956qfO73xheRncQU07',
  annual:'https://buy.stripe.com/fZu3cn6au1Xhd7R10xcQU08',
 },
} as const satisfies Record<PlanCode,Record<BillingPeriod,string>>;

export function paymentLink(plan:PlanCode,period:BillingPeriod){return paymentLinks[plan][period];}

export function priceId(plan:PlanCode,period:BillingPeriod):string{
 const value=process.env[prices[plan][period].env];
 if(!value?.startsWith('price_'))throw new Error('STRIPE_PRICE_NOT_CONFIGURED');
 return value;
}

export function planFromMetadata(value:unknown):PlanCode{return value==='growth'||value==='scale'?value:'core';}
export function periodFromMetadata(value:unknown):BillingPeriod{return value==='semiannual'||value==='annual'?value:'monthly';}
export function selectionFromPriceId(value:unknown):{plan:PlanCode;period:BillingPeriod}|null{
 if(typeof value!=='string')return null;
 for(const plan of ['core','growth','scale'] as const)for(const period of ['monthly','semiannual','annual'] as const)
  if(process.env[prices[plan][period].env]===value)return {plan,period};
 return null;
}

function selectionFromPriceDetails(value:unknown):{plan:PlanCode;period:BillingPeriod}|null{
 if(!value||typeof value!=='object')return null;
 const price=value as {unit_amount?:unknown;currency?:unknown;recurring?:{interval?:unknown;interval_count?:unknown}};
 if(price.currency!=='usd'||typeof price.unit_amount!=='number')return null;
 const interval=price.recurring?.interval,intervalCount=price.recurring?.interval_count;
 const period:BillingPeriod|null=interval==='month'&&intervalCount===1?'monthly':interval==='month'&&intervalCount===6?'semiannual':interval==='year'&&intervalCount===1?'annual':null;
 if(!period)return null;
 for(const plan of ['core','growth','scale'] as const)if(prices[plan][period].amount===price.unit_amount)return {plan,period};
 return null;
}

export function selectionFromSubscription(value:unknown):{plan:PlanCode;period:BillingPeriod}|null{
 if(!value||typeof value!=='object')return null;
 const subscription=value as {metadata?:Record<string,unknown>;items?:{data?:Array<{price?:unknown}>} };
 const price=subscription.items?.data?.[0]?.price;
 const priceId=price&&typeof price==='object'?(price as {id?:unknown}).id:undefined;
 const fromPrice=selectionFromPriceId(priceId)??selectionFromPriceDetails(price);if(fromPrice)return fromPrice;
 const plan=subscription.metadata?.plan_code,period=subscription.metadata?.billing_period;
 return (plan==='core'||plan==='growth'||plan==='scale')&&(period==='monthly'||period==='semiannual'||period==='annual')?{plan,period}:null;
}
