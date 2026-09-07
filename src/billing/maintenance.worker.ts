import {getSupabaseClient} from '../config/supabase.js';
import {deleteInvoiceObjects} from '../storage/r2.js';
import {processNextStripeEvent} from './repository.js';

type DeletionJob={id:string;tenant_id:string;attempts:number};

async function maintain(){
 const db=getSupabaseClient();
 for(let index=0;index<25&&await processNextStripeEvent();index++);
 const resumed=await db.rpc('resume_due_customer_pauses',{});
 if(resumed.error)throw resumed.error;
 const claimed=await db.rpc('claim_due_data_deletion');
 if(claimed.error)throw claimed.error;
 const job=(claimed.data as DeletionJob[]|null)?.[0];
 if(!job)return;
 try{
  const attachments=await db.from('audit_inbound_attachments').select('storage_path').eq('tenant_id',job.tenant_id);
  if(attachments.error)throw attachments.error;
  const keys=[...new Set((attachments.data??[]).map(row=>row.storage_path).filter(Boolean))];
  await deleteInvoiceObjects(keys);
  const completed=await db.rpc('complete_tenant_data_deletion',{p_job:job.id,p_deleted_counts:{stored_files:keys.length}});
  if(completed.error)throw completed.error;
 }catch(error){
  const failed=await db.rpc('fail_tenant_data_deletion',{p_job:job.id,p_error:error instanceof Error?error.message:'DELETION_FAILED'});
  if(failed.error)console.error('[billing] Could not record deletion failure.');
 }
}

export function startBillingMaintenanceWorker(){
 let stopped=false,running=false;
 const tick=async()=>{if(stopped||running)return;running=true;try{await maintain();}catch{console.error('[billing] Subscription maintenance failed.');}finally{running=false;}};
 void tick();const timer=setInterval(()=>void tick(),60_000);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);while(running)await new Promise(resolve=>setTimeout(resolve,25));};
}
