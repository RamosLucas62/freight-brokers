import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),update:vi.fn(),select:vi.fn()}));
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({
 rpc:mocks.rpc,from:(table:string)=>{
  if(table!=='audit_rose_events')throw new Error('unexpected table');
  return {update:mocks.update};
 },
})}));
import {enqueueRoseEvent,claimRoseEvent,completeRoseDiscovery,failRoseEvent} from '../../src/tms/rose-rocket.repository.js';

const job={id:'11111111-1111-4111-8111-111111111111',org_id:'22222222-2222-4222-8222-222222222222',tenant_id:'33333333-3333-4333-8333-333333333333',event_id:'44444444-4444-4444-8444-444444444444',order_id:'55555555-5555-4555-8555-555555555555',attempts:1};
const event={id:job.event_id,orgId:job.org_id,refId:job.order_id,ownerId:job.tenant_id,type:'Order Status Changed',objectKey:'order',createdAt:'2026-09-17T16:00:00Z'};
beforeEach(()=>{
 vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:'queued',error:null});
 const chain={eq:vi.fn(),select:mocks.select};chain.eq.mockReturnValue(chain);
 mocks.update.mockReturnValue(chain);mocks.select.mockResolvedValue({data:[{id:job.id}],error:null});
});
describe('Rose Rocket durable event repository',()=>{
 it('queues only event identifiers, never the webhook payload',async()=>{
  expect(await enqueueRoseEvent(event)).toBe('queued');
  expect(mocks.rpc).toHaveBeenCalledWith('enqueue_rose_order_event',{p_org_id:job.org_id,p_event_id:job.event_id,p_order_id:job.order_id,p_occurred_at:event.createdAt});
 });
 it('claims and completes a discovery with tenant-scoped compare-and-swap',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:[job],error:null});
  expect(await claimRoseEvent()).toEqual(job);
  await completeRoseDiscovery(job,{orderId:job.order_id,documentCount:0,documentIds:[],discoveredAt:event.createdAt});
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({status:'discovered',result:expect.objectContaining({orderId:job.order_id})}));
 });
 it('retries temporary failures and stops after five attempts',async()=>{
  await failRoseEvent(job,'ROSE_API_HTTP_503');
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({status:'queued',error_code:'ROSE_API_HTTP_503'}));
  await failRoseEvent({...job,attempts:5},'ROSE_API_HTTP_503');
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({status:'failed'}));
 });
 it('rejects a lost processing claim',async()=>{
  mocks.select.mockResolvedValueOnce({data:[],error:null});
  await expect(completeRoseDiscovery(job,{orderId:job.order_id,documentCount:0,documentIds:[],discoveredAt:event.createdAt})).rejects.toThrow('ROSE_QUEUE_UPDATE_FAILED');
 });
});
