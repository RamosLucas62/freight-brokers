import type {AccessorialExtractionResult} from '../accessorial/schema.js';
import type {InvoiceRecord} from '../types/invoice.types.js';
import type {PodExtractionResult} from '../pod/types.js';
import type {RateConfirmationExtractionResult} from '../rate-confirmation/types.js';
export interface EvidenceIssue {load:string|null;missing:string[];}
export class IncompleteTmsEvidence extends Error{
 constructor(readonly issues:EvidenceIssue[]){super('TMS_EVIDENCE_INCOMPLETE');}
}
const norm=(value:string)=>value.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
type SourcedField<T>={value:T|null;confidence:number;evidence:{page:number|null;text:string|null}|null};
const proven=<T>(field:SourcedField<T>|undefined,threshold:number):boolean=>field?.value!=null&&field.confidence>=threshold&&Boolean(field.evidence?.page&&field.evidence?.text?.trim());
/** Presence alone is not proof: bind evidence to each invoice's load and require
 * readable source evidence. Receipts are extracted separately, but currency and
 * contractual terms still require review; possession of a receipt is not approval. */
export function tmsEvidenceIssues(invoices:InvoiceRecord[],pods:PodExtractionResult[],rates:RateConfirmationExtractionResult[],threshold=0.9,accessorialEvidence:AccessorialExtractionResult[]=[]):EvidenceIssue[]{
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('INVALID_EVIDENCE_THRESHOLD');
 if(!invoices.length)return [{load:null,missing:['CARRIER_INVOICE']}];
 return invoices.flatMap<EvidenceIssue>(invoice=>{
  const load=invoice.numero_carga,missing:string[]=[];
  if(!invoice.numero_fatura?.trim()||!invoice.carrier_name?.trim()||invoice.valor_total==null)missing.push('INVOICE_DETAILS');
  if((invoice.confidence_scores.numero_carga??0)<threshold)missing.push('INVOICE_LOAD_REVIEW');
  if(!load||!norm(load))return [{load:null,missing:['INVOICE_LOAD_NUMBER']}];
  const match=<T extends {fields:{load_number:SourcedField<string>}}>(items:T[])=>items.filter(item=>proven(item.fields.load_number,threshold)&&norm(item.fields.load_number.value??'')===norm(load));
  const matchedPods=match(pods),matchedRates=match(rates);
  const pod=matchedPods.length===1?matchedPods[0]:undefined,rate=matchedRates.length===1?matchedRates[0]:undefined;
  if(!pod)missing.push(matchedPods.length?'AMBIGUOUS_POD':'POD');
  else{
   if(pod.requires_human_review)missing.push('POD_REVIEW');
   if(!proven(pod.fields.signature_present,threshold)||pod.fields.signature_present.value!==true)missing.push('SIGNED_POD');
   if(!proven(pod.fields.delivery_date,threshold))missing.push('DELIVERY_DATE');
  }
  if(!rate)missing.push(matchedRates.length?'AMBIGUOUS_RATE_CONFIRMATION':'RATE_CONFIRMATION');
  else{
   if(rate.requires_human_review)missing.push('RATE_CONFIRMATION_REVIEW');
   if(!proven(rate.fields.total_amount,threshold))missing.push('AUTHORIZED_TOTAL');
  }
  if(invoice.accessorials.some(item=>!['FUEL','FUELSURCHARGE','LINEHAUL'].includes(norm(item.tipo)))){
   if(!match(accessorialEvidence).length)missing.push('ACCESSORIAL_DOCUMENT');
   missing.push('ACCESSORIAL_EVIDENCE_REVIEW');
  }
  return missing.length?[{load:load.slice(0,200),missing}]:[];
 });
}
