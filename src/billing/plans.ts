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
