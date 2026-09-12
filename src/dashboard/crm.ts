export const crmStages=[
 {id:'free_audit',label:'Auditoria gratuita'},
 {id:'followup_1',label:'Follow-up D+1'},
 {id:'followup_3',label:'Follow-up D+3'},
 {id:'followup_5',label:'Follow-up D+5'},
 {id:'followup_10',label:'Follow-up D+10'},
 {id:'followup_30',label:'Follow-up D+30'},
 {id:'trial',label:'Teste de 7 dias'},
 {id:'active',label:'Cliente ativo'},
 {id:'churn',label:'Churn'},
] as const;

export type CrmStage=(typeof crmStages)[number]['id'];

export interface CrmLeadRow {
 id:string;email:string;contact_name:string;company_name:string;phone:string|null;loads_per_month:string|null;
 status:string;created_at:string;updated_at:string;completed_at:string|null;result:Record<string,unknown>|null;
 utm_source:string|null;utm_medium:string|null;utm_campaign:string|null;utm_term:string|null;utm_content:string|null;
}
export interface CrmFollowupRow {request_id:string;day_offset:number;status:string;sent_at:string|null;}
export interface CrmBillingRow {billing_email:string|null;status:string;trial_ends_at:string|null;canceled_at:string|null;plan_code:string|null;billing_period:string|null;last_paid_amount_cents:number|null;last_paid_currency:string|null;last_paid_at:string|null;updated_at:string;}

const payingStatuses=new Set(['active','past_due','paused','canceling']);
const stageFor=(billing:CrmBillingRow|undefined,latestFollowup:number):CrmStage=>{
 if(billing?.status==='canceled')return 'churn';
 if(billing?.status==='trialing')return 'trial';
 if(billing&&payingStatuses.has(billing.status))return 'active';
 const reached=[30,10,5,3,1].find(day=>latestFollowup>=day);
 return reached?`followup_${reached}` as CrmStage:'free_audit';
};

export function buildCrmFunnel(leads:CrmLeadRow[],followups:CrmFollowupRow[],billingRows:CrmBillingRow[]){
 const billingByEmail=new Map<string,CrmBillingRow>();
 for(const billing of [...billingRows].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))){
  const email=billing.billing_email?.toLowerCase();if(email&&!billingByEmail.has(email))billingByEmail.set(email,billing);
 }
 const followupsByLead=new Map<string,CrmFollowupRow[]>();
 for(const followup of followups){const current=followupsByLead.get(followup.request_id)??[];current.push(followup);followupsByLead.set(followup.request_id,current);}
 const rows=leads.map(lead=>{
  const sent=(followupsByLead.get(lead.id)??[]).filter(item=>item.status==='sent');
  const latestFollowup=Math.max(0,...sent.map(item=>item.day_offset));
  const billing=billingByEmail.get(lead.email.toLowerCase());
  const stage=stageFor(billing,latestFollowup);
  const result=lead.result??{};const invoiceCount=typeof result.total_invoices_processed==='number'?result.total_invoices_processed:null;
  const activity=[lead.updated_at,billing?.updated_at,...sent.map(item=>item.sent_at)].filter((value):value is string=>Boolean(value)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??lead.created_at;
  return {...lead,result:undefined,stage,latest_followup:latestFollowup,invoice_count:invoiceCount,last_activity_at:activity,
   subscription:billing?{status:billing.status,trial_ends_at:billing.trial_ends_at,canceled_at:billing.canceled_at,plan_code:billing.plan_code,billing_period:billing.billing_period,last_paid_amount_cents:billing.last_paid_amount_cents,last_paid_currency:billing.last_paid_currency,last_paid_at:billing.last_paid_at}:null,
   followups:(followupsByLead.get(lead.id)??[]).sort((a,b)=>a.day_offset-b.day_offset)};
 }).sort((a,b)=>Date.parse(b.last_activity_at)-Date.parse(a.last_activity_at));
 return {rows,total:rows.length,stages:crmStages.map(stage=>({...stage,count:rows.filter(row=>row.stage===stage.id).length}))};
}
