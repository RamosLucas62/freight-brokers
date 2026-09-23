import type {InvoiceRecord} from '../types/invoice.types.js';
import type {RateConfirmationExtractionResult} from '../rate-confirmation/types.js';
import type {AccessorialExtractionResult} from './schema.js';
export interface AccessorialCheck {type:string;currency:string|null;status:'verified'|'review';reasons:string[];billed:number;expected:number|null;sources:string[];}
const norm=(s:string)=>s.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');
type Field<T>={value:T|null;confidence:number;evidence:{page:number|null;text:string|null}|null};
const proven=<T>(f:Field<T>|undefined,t:number):f is Field<T>&{value:T}=>f?.value!=null&&f.confidence>=t&&!!f.evidence?.page&&!!f.evidence?.text?.trim();
const cents=(n:number)=>Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))&&Math.abs(n*100-Math.round(n*100))<1e-6?Math.round(n*100):null;
/** Conservative, deterministic checks. Unknown terms never inherit industry defaults. */
export function verifyAccessorials(invoice:InvoiceRecord,rate:RateConfirmationExtractionResult|undefined,documents:AccessorialExtractionResult[],threshold=.9,deliveryDate?:string|null):AccessorialCheck[]{
 const charges=invoice.accessorials.filter(c=>!['FUEL','FUELSURCHARGE','LINEHAUL'].includes(norm(c.tipo)));
 return charges.map(charge=>{
  const type=norm(charge.tipo),reasons:string[]=[],sources:string[]=[];let expected:number|null=null;
  const add=(reason:string)=>reasons.push(reason);
  if(!['LUMPER','LIFTGATE','REDELIVERY','DETENTION','LAYOVER'].includes(type))add('UNSUPPORTED_TERMS');
  if(charges.filter(c=>norm(c.tipo)===type).length!==1)add('AMBIGUOUS_CHARGES');
  if(cents(charge.valor)===null||!charge.evidence?.page||!charge.evidence.text?.includes(charge.valor.toFixed(2)))add('CHARGE_SOURCE');
  const currency=invoice.currency;
  if(!currency||invoice.verification?.fields.currency?.status!=='verified')add('INVOICE_CURRENCY');
  const matched=documents.filter(d=>proven(d.fields.load_number,threshold)&&norm(d.fields.load_number.value)===norm(invoice.numero_carga??'')&&proven(d.fields.charge_type,threshold)&&norm(d.fields.charge_type.value)===type);
  const receipts=matched.filter(d=>proven(d.fields.record_kind,threshold)&&d.fields.record_kind.value===(['DETENTION','LAYOVER'].includes(type)?'time_record':'receipt'));
  const authorizations=matched.filter(d=>proven(d.fields.record_kind,threshold)&&d.fields.record_kind.value==='authorization');
  const receipt=receipts.length===1?receipts[0]:undefined,auth=authorizations.length===1?authorizations[0]:undefined;
  if(!receipt)add(receipts.length?'AMBIGUOUS_RECEIPT':'RECEIPT');
  const currencyMatches=(d:AccessorialExtractionResult)=>proven(d.fields.currency,threshold)&&d.fields.currency.value===currency;
  if(receipt){sources.push(receipt.source_file);if(receipt.requires_human_review)add('RECEIPT_REVIEW');if(!proven(receipt.fields.service_date,threshold)||!deliveryDate||receipt.fields.service_date.value!==deliveryDate)add('SERVICE_DATE');if(!['DETENTION','LAYOVER'].includes(type)&&!currencyMatches(receipt))add('RECEIPT_CURRENCY');}
  // A signed contract's explicit fixed line may authorize a fixed receipt. Time
  // calculations require a separate explicit authorization with all calculation terms.
  const fixed=rate?.fields.accessorials?.filter(a=>norm(a.type)===type&&a.confidence>=threshold&&a.evidence?.page&&a.evidence.text?.trim())??[];
  const timeBased=['DETENTION','LAYOVER'].includes(type);
  if(authorizations.length>1)add('AMBIGUOUS_AUTHORIZATION');
  if(auth){
   sources.push(auth.source_file);
   if(auth.requires_human_review||!proven(auth.fields.authorized_by,threshold)||!proven(auth.fields.carrier_name,threshold)||norm(auth.fields.carrier_name.value)!==norm(invoice.carrier_name??''))add('AUTHORIZATION');
   if(!currencyMatches(auth))add('AUTHORIZATION_CURRENCY');
   if(!proven(auth.fields.service_date,threshold)||auth.fields.service_date.value!==receipt?.fields.service_date.value)add('AUTHORIZATION_DATE');
  }
  if(timeBased){
   if(!auth)add('TIME_TERMS');
   if(auth&&receipt){
    const a=auth.fields,r=receipt.fields;
    if(!proven(a.hourly_rate,threshold)||!proven(a.free_minutes,threshold)||!proven(a.rounding_minutes,threshold)||!proven(r.arrival_at,threshold)||!proven(r.departure_at,threshold))add('TIME_TERMS');
    else{
     const duration=(Date.parse(r.departure_at.value)-Date.parse(r.arrival_at.value))/60000;
     if(!Number.isFinite(duration)||duration<0||duration>31*24*60||r.arrival_at.value.slice(0,10)!==r.service_date.value)add('TIME_RANGE');
     else{
      const units=Math.ceil(Math.max(0,duration-a.free_minutes.value)/a.rounding_minutes.value);
      const hourly=cents(a.hourly_rate.value);
      if(hourly===null)add('TIME_TERMS');else expected=Math.round(units*a.rounding_minutes.value*hourly/60)/100;
      if(a.maximum_amount?.value!=null){if(!proven(a.maximum_amount,threshold)||cents(a.maximum_amount.value)===null)add('TIME_CAP');else if(expected!==null)expected=Math.min(expected,a.maximum_amount.value);}
     }
    }
   }
  }else{
   if(auth){if(proven(auth.fields.amount,threshold)&&cents(auth.fields.amount.value)!==null)expected=auth.fields.amount.value;else add('AUTHORIZED_AMOUNT');}
   else if(fixed.length===1&&rate&&!rate.requires_human_review&&proven(rate.fields.carrier_name,threshold)&&norm(rate.fields.carrier_name.value)===norm(invoice.carrier_name??'')&&proven(rate.fields.currency,threshold)&&rate.fields.currency.value===currency){expected=fixed[0].amount;sources.push(rate.source_file);}
   else add('AUTHORIZATION');
   if(receipt&&(!proven(receipt.fields.amount,threshold)||cents(receipt.fields.amount.value)===null||cents(receipt.fields.amount.value)!==cents(charge.valor)))add('RECEIPT_AMOUNT');
  }
  if(expected===null||cents(expected)!==cents(charge.valor))add('AMOUNT_MISMATCH');
  return {type,currency:currency??null,status:reasons.length?'review':'verified',reasons:[...new Set(reasons)],billed:charge.valor,expected,sources:[...new Set(sources)]};
 });
}
