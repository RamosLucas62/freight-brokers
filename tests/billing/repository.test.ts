import {beforeEach,describe,expect,it,vi} from 'vitest';
const rpc=vi.fn();
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({rpc})}));
import {processStripeEvent} from '../../src/billing/repository.js';

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('STRIPE_PRICE_SCALE_ANNUAL','price_scale_year');rpc.mockResolvedValue({data:true,error:null});});
describe('Stripe webhook persistence',()=>{
 it('passes supported events to the atomic idempotent database function',async()=>{
  await expect(processStripeEvent({id:'evt_1',type:'invoice.payment_failed',created:123,data:{object:{subscription:'sub_1'}}})).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('process_stripe_billing_event',{p_event_id:'evt_1',p_event_type:'invoice.payment_failed',p_event_created:123,p_object:{subscription:'sub_1'}});
 });
 it('ignores unrelated Stripe events without a database write',async()=>{
  await expect(processStripeEvent({id:'evt_2',type:'charge.refunded',data:{object:{}}})).resolves.toBe(false);expect(rpc).not.toHaveBeenCalled();
 });
 it('surfaces persistence failures so Stripe receives a retryable response',async()=>{
  rpc.mockResolvedValue({data:null,error:new Error('temporary')});await expect(processStripeEvent({id:'evt_3',type:'invoice.paid',data:{object:{subscription:'sub_1'}}})).rejects.toThrow('temporary');
 });
 it('maps a portal price change back to the local plan',async()=>{
  await processStripeEvent({id:'evt_4',type:'customer.subscription.updated',created:124,data:{object:{id:'sub_4',status:'active',items:{data:[{price:{id:'price_scale_year'}}]}}}});
  expect(rpc).toHaveBeenLastCalledWith('sync_billing_plan_from_stripe',{p_subscription_id:'sub_4',p_plan:'scale',p_period:'annual'});
 });
});
