import {createHash} from 'node:crypto';
import type {
  DadosBancarios,
  FieldEvidence,
  FieldVerification,
  InvoiceFields,
  InvoiceRecord,
  InvoiceVerification,
  VerificationStatus,
} from '../types/invoice.types.js';
import {normalizeCompanyName} from '../normalization/index.js';

const FIELD_NAMES=(['numero_fatura','numero_carga','carrier_name','mc_number','dot_number','data_carga','data_fatura','valor_total','origem','destino','dados_bancarios'] as const);
type FieldName=typeof FIELD_NAMES[number];

export interface ConfidenceInput {
  fields: InvoiceFields;
  evidence?: Record<string,FieldEvidence|null>;
  history?: InvoiceRecord[];
  tenantId?: string;
  sourceId?: string;
}

const present=(value:unknown):boolean=>value!=null && (typeof value!=='string'||Boolean(value.trim()));
const digits=(value:unknown):string=>String(value??'').replace(/\D/g,'');
const clamp=(value:number):number=>Math.max(0,Math.min(1,Number(value.toFixed(2))));

function evidenceSupports(value:unknown,evidence:FieldEvidence|null|undefined):boolean{
 if(!evidence?.text?.trim()||!present(value))return false;
 const haystack=evidence.text.toLowerCase().replace(/\s+/g,' ');
 if(typeof value==='number'){
  const forms=[value.toFixed(2),String(value)].flatMap(item=>[item,item.replace('.',','),item.replace(/\B(?=(\d{3})+(?!\d))/g,',')]);
  return forms.some(item=>haystack.includes(item.toLowerCase()));
 }
 if(typeof value==='object'){
  const bank=value as DadosBancarios;
  return [bank.account_number,bank.routing_number].filter(Boolean).every(item=>digits(haystack).includes(digits(item)));
 }
 const normalized=String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
 return normalized.length>0&&haystack.replace(/[^a-z0-9]/g,'').includes(normalized);
}

function formatValid(field:FieldName,value:unknown):boolean{
 if(!present(value))return false;
 if(field==='valor_total')return typeof value==='number'&&Number.isFinite(value)&&value>0;
 if(field==='mc_number')return /^\d{3,8}$/.test(digits(value));
 if(field==='dot_number')return /^\d{3,9}$/.test(digits(value));
 if(field==='data_carga'||field==='data_fatura')return /^\d{4}-\d{2}-\d{2}$/.test(String(value))&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
 if(field==='dados_bancarios'){
  const bank=value as DadosBancarios;
  const account=digits(bank.account_number),routing=digits(bank.routing_number);
  return Boolean(account)&&account.length>=4&&account.length<=17&&routing.length===9;
 }
 return String(value).trim().length>=2;
}

function historicalMatch(field:FieldName,value:unknown,history:InvoiceRecord[]):boolean{
 if(!present(value))return false;
 if(field==='carrier_name')return history.some(item=>normalizeCompanyName(item.carrier_name??'')===normalizeCompanyName(String(value)));
 if(field==='dados_bancarios'){
  const bank=value as DadosBancarios;return history.some(item=>item.dados_bancarios?.account_number===bank.account_number&&item.dados_bancarios?.routing_number===bank.routing_number);
 }
 return history.some(item=>String(item[field]??'')===String(value));
}

function verifyField(field:FieldName,value:unknown,evidence:FieldEvidence|null|undefined,history:InvoiceRecord[],threshold:number):FieldVerification{
 if(!present(value))return {status:'unverifiable',confidence:0,signals:['not_present'],evidence:evidence??null};
 if(!formatValid(field,value))return {status:'review',confidence:0.2,signals:['invalid_format'],evidence:evidence??null};
 const signals=['valid_format'];let score=0.68;
 if(evidence?.page){signals.push('source_page_present');score+=0.08;}
 if(evidenceSupports(value,evidence)){signals.push('source_text_supports_value');score+=0.18;}
 if(historicalMatch(field,value,history)){signals.push('matches_verified_history');score+=0.08;}
 const confidence=clamp(score);
 return {status:confidence>=threshold?'verified':'review',confidence,signals,evidence:evidence??null};
}

function sampled(tenantId:string,sourceId:string,rate:number):boolean{
 if(rate<=0)return false;const bucket=createHash('sha256').update(`${tenantId}:${sourceId}`).digest().readUInt32BE(0)/0xffffffff;return bucket<rate;
}

export function verifyInvoice(input:ConfidenceInput):InvoiceVerification{
 const history=input.history??[];const configured=Number(process.env.CONFIDENCE_VERIFIED_THRESHOLD??'0.92');const threshold=Number.isFinite(configured)&&configured>=0&&configured<=1?configured:0.92;
 const fields=Object.fromEntries(FIELD_NAMES.map(field=>[field,verifyField(field,input.fields[field],input.evidence?.[field],history,threshold)]));
 const reasons:string[]=[];
 for(const field of ['numero_fatura','valor_total','carrier_name'] as const){if(fields[field].status!=='verified')reasons.push(`${field}:${fields[field].status}`);}
 const identityVerified=fields.mc_number.status==='verified'||fields.dot_number.status==='verified';
 if(!identityVerified)reasons.push(fields.mc_number.status==='review'||fields.dot_number.status==='review'?'carrier_identifier:review':'carrier_identifier:unverifiable');
 // Banking is optional. It only blocks automation when present but invalid or unsupported.
 if(present(input.fields.dados_bancarios)&&fields.dados_bancarios.status!=='verified')reasons.push(`dados_bancarios:${fields.dados_bancarios.status}`);
 let status:VerificationStatus=reasons.some(reason=>reason.endsWith(':review'))?'review':reasons.length?'unverifiable':'verified';
 const applicable=Object.values(fields).filter(field=>field.status!=='unverifiable');
 const confidence=applicable.length?clamp(applicable.reduce((sum,field)=>sum+field.confidence,0)/applicable.length):0;
 const rate=Math.max(0,Math.min(1,Number(process.env.CONFIDENCE_QA_SAMPLE_RATE??'0.05')));
 const qa=status==='verified'&&sampled(input.tenantId??'',input.sourceId??'',Number.isFinite(rate)?rate:0.05);
 if(qa)reasons.push('quality_control_sample');
 return {status,confidence,reasons,sampled_for_quality_control:qa,fields};
}

export function confidenceSummary(invoices:InvoiceRecord[]){
 const summary={verified:0,review:0,unverifiable:0,quality_control_samples:0,automation_rate:0,field_statuses:{verified:0,review:0,unverifiable:0}};
 for(const invoice of invoices){const verification=invoice.verification;if(!verification)continue;summary[verification.status]++;if(verification.sampled_for_quality_control)summary.quality_control_samples++;for(const field of Object.values(verification.fields))summary.field_statuses[field.status]++;}
 summary.automation_rate=invoices.length?Number((summary.verified/invoices.length).toFixed(4)):0;return summary;
}
