import type {InvoiceRecord,AccessorialLineItem} from '../types/invoice.types.js';
import type {RuleException} from '../types/rule.types.js';
import type {PodExtractionResult,PodField} from '../pod/types.js';
import type {RateConfirmationAccessorial,RateConfirmationExtractionResult} from '../rate-confirmation/types.js';

export interface ReconciliationSummary {matched:number;divergent:number;unverifiable:number;unbilled_revenue:number;supporting_documents:number;}
export interface ReconciliationResult {exceptions:RuleException[];summary:ReconciliationSummary;warnings:string[];}
const norm=(value:string|null|undefined)=>String(value??'').normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const kind=(value:string)=>{const n=norm(value);if(n.includes('FUEL'))return 'FUEL_SURCHARGE';if(n.includes('DETENTION'))return 'DETENTION';if(n.includes('LAYOVER'))return 'LAYOVER';if(n.includes('LIFTGATE'))return 'LIFTGATE';if(n.includes('TONU')||n.includes('TRUCKORDERNOTUSED'))return 'TONU';return n||'OTHER';};
const confident=<T>(field:PodField<T>|undefined,threshold:number):field is PodField<T>&{value:T}=>field?.value!=null&&field.confidence>=threshold;
const sameAmount=(a:number,b:number)=>Math.abs(a-b)<0.01;
const sourcePage=(item:{evidence?:{page:number|null}|null})=>item.evidence?.page??null;

export function reconcileDocuments(invoices:InvoiceRecord[],pods:PodExtractionResult[],rates:RateConfirmationExtractionResult[],threshold=0.9):ReconciliationResult{
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new Error('Supporting document confidence must be between 0 and 1.');
 const exceptions:RuleException[]=[];const warnings:string[]=[];let matched=0,divergent=0,unverifiable=0,unbilled=0;
 const findPod=(load:string)=>pods.find(p=>confident(p.fields.load_number,threshold)&&norm(p.fields.load_number.value)===load);
 const findRate=(load:string)=>rates.find(r=>confident(r.fields.load_number,threshold)&&norm(r.fields.load_number.value)===load);
  const add=(invoice:InvoiceRecord,type:RuleException['tipo_regra'],description:string,value:number|null,metadata:Record<string,unknown>,page:number|null,sourceFile=invoice.source_file)=>exceptions.push({invoice_id:invoice.id,tipo_regra:type,valor_envolvido:value,descricao:description,source_file:sourceFile,source_page:page,metadata});
 for(const invoice of invoices){
  const load=norm(invoice.numero_carga);if(!load){unverifiable++;warnings.push(`${invoice.source_file}: load number is unavailable; POD/rate confirmation reconciliation skipped.`);continue;}
  const pod=findPod(load),rate=findRate(load);if(!pod||!rate){unverifiable++;warnings.push(`${invoice.source_file}: matching ${!pod&&!rate?'POD and rate confirmation':!pod?'POD':'rate confirmation'} not found with high-confidence load ${invoice.numero_carga}.`);continue;}
  if(pod.requires_human_review||rate.requires_human_review){unverifiable++;warnings.push(`${invoice.source_file}: supporting documents require human review; no divergence was inferred.`);continue;}
  let invoiceDivergent=false;
  if(confident(rate.fields.carrier_name,threshold)&&invoice.carrier_name&&norm(rate.fields.carrier_name.value)!==norm(invoice.carrier_name)){invoiceDivergent=true;add(invoice,'RATE_CONFIRMATION_MISMATCH','Invoice carrier differs from the matched rate confirmation.',invoice.valor_total,{field:'carrier_name',expected:rate.fields.carrier_name.value,actual:invoice.carrier_name,rate_confirmation:rate.source_file,pod:pod.source_file},sourcePage(rate.fields.carrier_name),rate.source_file);}
  if(confident(rate.fields.total_amount,threshold)&&invoice.valor_total!=null&&!sameAmount(rate.fields.total_amount.value,invoice.valor_total)){invoiceDivergent=true;add(invoice,'RATE_CONFIRMATION_MISMATCH',`Invoice total ${invoice.valor_total.toFixed(2)} differs from authorized total ${rate.fields.total_amount.value.toFixed(2)}.`,Math.abs(invoice.valor_total-rate.fields.total_amount.value),{field:'total_amount',expected:rate.fields.total_amount.value,actual:invoice.valor_total,rate_confirmation:rate.source_file,pod:pod.source_file},sourcePage(rate.fields.total_amount),rate.source_file);}
  const authorized=new Map<string,RateConfirmationAccessorial[]>();for(const item of rate.fields.accessorials.filter(item=>item.confidence>=threshold)){const key=kind(item.type||item.description);authorized.set(key,[...(authorized.get(key)??[]),item]);}
  const billed=new Map<string,AccessorialLineItem[]>();for(const item of invoice.accessorials){const key=kind(item.tipo||item.descricao);billed.set(key,[...(billed.get(key)??[]),item]);}
  for(const [key,items] of billed){const allowed=authorized.get(key);for(const item of items){const match=allowed?.find(candidate=>sameAmount(candidate.amount,item.valor));if(!match){invoiceDivergent=true;const maxAllowed=Math.max(0,...(allowed??[]).map(candidate=>candidate.amount));add(invoice,'UNSUPPORTED_ACCESSORIAL',`${item.tipo} charge of ${item.valor.toFixed(2)} is not supported by the matched rate confirmation.`,Math.max(0,item.valor-maxAllowed),{accessorial:key,billed:item.valor,authorized:maxAllowed,rate_confirmation:rate.source_file,pod:pod.source_file},item.pagina);}}}
  const podNotes=confident(pod.fields.exception_notes,threshold)?norm(pod.fields.exception_notes.value):'';
  for(const [key,items] of authorized){if(billed.has(key)||!podNotes.includes(norm(key)))continue;for(const item of items){invoiceDivergent=true;unbilled+=item.amount;add(invoice,'UNBILLED_ACCESSORIAL',`${item.type} is authorized and supported by POD notes but is absent from the invoice.`,item.amount,{accessorial:key,authorized:item.amount,rate_confirmation:rate.source_file,pod:pod.source_file,pod_evidence:pod.fields.exception_notes.evidence},sourcePage(item),rate.source_file);}}
  if(invoiceDivergent)divergent++;else matched++;
 }
 return {exceptions,summary:{matched,divergent,unverifiable,unbilled_revenue:unbilled,supporting_documents:pods.length+rates.length},warnings};
}
