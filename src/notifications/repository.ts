import {getSupabaseClient} from '../config/supabase.js';
import type {NotificationData,NotificationDelivery,NotificationException} from './types.js';

export async function enqueueDueNotifications(now=new Date()):Promise<number>{
 const {data,error}=await getSupabaseClient().rpc('enqueue_due_audit_notifications',{p_now:now.toISOString()});
 if(error)throw new Error('NOTIFICATION_SCHEDULE_FAILED');
 return Number(data??0);
}

export async function claimNotification():Promise<NotificationDelivery|null>{
 const {data,error}=await getSupabaseClient().rpc('claim_audit_notification');
 if(error)throw new Error('NOTIFICATION_CLAIM_FAILED');
 return (data?.[0] as NotificationDelivery|undefined)??null;
}

export async function loadNotification(delivery:NotificationDelivery):Promise<NotificationData>{
 const db=getSupabaseClient();
 const [tenant,contacts,settings]=await Promise.all([
  db.from('audit_tenants').select('name').eq('id',delivery.tenant_id).single(),
  db.from('audit_report_contacts').select('email').eq('tenant_id',delivery.tenant_id).eq('enabled',true).not('verified_at','is',null),
  db.from('audit_notification_settings').select('timezone').eq('tenant_id',delivery.tenant_id).single(),
 ]);
 if(tenant.error||contacts.error||settings.error||!tenant.data||!settings.data)throw new Error('NOTIFICATION_ACCOUNT_FAILED');

 let riskQuery=db.from('exceptions').select('id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,created_at,resolution_status,avoided_amount,resolved_at')
  .eq('tenant_id',delivery.tenant_id);
 if(delivery.exception_id)riskQuery=riskQuery.eq('id',delivery.exception_id);
 else riskQuery=riskQuery.gte('created_at',delivery.period_start).lt('created_at',delivery.period_end);
 const risksResult=await riskQuery.order('created_at',{ascending:true});
 if(risksResult.error)throw new Error('NOTIFICATION_RISKS_FAILED');
 const risks=(risksResult.data??[]) as NotificationException[];

 let avoided:NotificationException[]=[];
 if(delivery.kind==='monthly'){
  const result=await db.from('exceptions').select('id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,created_at,resolution_status,avoided_amount,resolved_at')
   .eq('tenant_id',delivery.tenant_id).eq('resolution_status','avoided')
   .gte('resolved_at',delivery.period_start).lt('resolved_at',delivery.period_end).order('resolved_at',{ascending:true});
  if(result.error)throw new Error('NOTIFICATION_SAVINGS_FAILED');
  avoided=(result.data??[]) as NotificationException[];
 }

 const invoiceIds=[...new Set([...risks,...avoided].map(r=>r.invoice_id))];
 if(invoiceIds.length){
  const invoices=await db.from('invoices').select('id,numero_fatura,numero_carga,carrier_name,valor_total')
   .eq('tenant_id',delivery.tenant_id).in('id',invoiceIds);
  if(invoices.error)throw new Error('NOTIFICATION_INVOICES_FAILED');
  const byId=new Map((invoices.data??[]).map(row=>[row.id,row]));
  for(const risk of [...risks,...avoided])risk.invoice=byId.get(risk.invoice_id);
 }
 return {delivery,companyName:String(tenant.data.name),timezone:String(settings.data.timezone),recipients:(contacts.data??[]).map(c=>String(c.email)),risks,avoided};
}

export async function finishNotification(delivery:NotificationDelivery,error?:unknown):Promise<void>{
 const failed=Boolean(error);const attempts=delivery.attempts;
 const retryMinutes=Math.min(360,5*Math.pow(3,Math.max(0,attempts-1)));
 const update=failed?{
  status:'failed',last_error:error instanceof Error?error.message.slice(0,200):'SEND_FAILED',
  next_attempt_at:new Date(Date.now()+retryMinutes*60000).toISOString(),
 }:{status:'sent',sent_at:new Date().toISOString(),last_error:null};
 const {error:dbError}=await getSupabaseClient().from('audit_notification_deliveries').update(update)
  .eq('id',delivery.id).eq('tenant_id',delivery.tenant_id).eq('status','sending');
 if(dbError)throw new Error('NOTIFICATION_UPDATE_FAILED');
}
