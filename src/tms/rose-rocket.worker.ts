import {RoseRocketClient} from './rose-rocket.js';
import * as repository from './rose-rocket.repository.js';
import {failure,info} from '../observability/logger.js';

/** Discover metadata only. Customer documents never enter an audit without mapping. */
export async function processRoseEvent(job:repository.RoseEventJob,client:RoseRocketClient):Promise<void>{
 try{
  if(job.org_id!==client.orgId)throw new Error('ROSE_OBJECT_SCOPE_MISMATCH');
  const order=await client.getObject('order',job.order_id);
  const ids=[...new Set((order.documents??[]).map(document=>document.id))];
  await repository.completeRoseDiscovery(job,{
   orderId:order.id,documentCount:ids.length,documentIds:ids.slice(0,100),discoveredAt:new Date().toISOString(),
  });
  info('rose.event.discovered',{event_id:job.event_id,tenant_id:job.tenant_id,order_id:order.id,document_count:ids.length});
 }catch(error){
  failure('rose.event.discovery_failed',error,{event_id:job.event_id,tenant_id:job.tenant_id});
  const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:'ROSE_DISCOVERY_FAILED';
  await repository.failRoseEvent(job,code);
 }
}
export function startRoseDiscoveryWorker(client:RoseRocketClient){
 let stopping=false;let running:Promise<void>|null=null;
 const tick=()=>{if(stopping||running)return;running=(async()=>{
  try{const job=await repository.claimRoseEvent();if(job)await processRoseEvent(job,client);}
  catch(error){failure('rose.worker.tick_failed',error);}
 })().finally(()=>{running=null;});};
 const timer=setInterval(tick,3000);tick();
 return async()=>{stopping=true;clearInterval(timer);await running;};
}
