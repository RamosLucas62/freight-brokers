import {beforeEach,describe,expect,it,vi} from 'vitest';
const rpc=vi.fn();
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({rpc})}));
vi.mock('../../src/notifications/google-chat.sender.js',()=>({notifyLeadFunnel:vi.fn().mockResolvedValue(undefined),notifyOperationalError:vi.fn().mockResolvedValue(undefined)}));
import {processNextStripeEvent,processStripeEvent} from '../../src/billing/repository.js';

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL','price_growth_year');rpc.mockResolvedValue({data:true,error:null});});
describe('Stripe webhook persistence',()=>{
 it('passes supported events to the atomic idempotent database function',async()=>{
  await expect(processStripeEvent({id:'evt_1',type:'invoice.payment_failed',created:123,data:{object:{subscription:'sub_1'}}})).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('process_stripe_billing_event',{p_event_id:'evt_1',p_event_type:'invoice.payment_failed',p_event_created:123,p_object:{subscription:'sub_1'}});
 });
 it('processes completed Stripe checkout without checkout-page legal acceptance',async()=>{
  await processStripeEvent({id:'evt_checkout',type:'checkout.session.completed',created:123,data:{object:{id:'cs_1',client_reference_id:'22222222-2222-4222-8222-222222222222',customer:'cus_1',subscription:'sub_1',customer_details:{email:'buyer@example.com'}}}});
  expect(rpc).not.toHaveBeenCalledWith('confirm_checkout_acceptance',expect.anything());
 });
 it('ignores unrelated Stripe events without a database write',async()=>{
  await expect(processStripeEvent({id:'evt_2',type:'charge.refunded',data:{object:{}}})).resolves.toBe(false);expect(rpc).not.toHaveBeenCalled();
 });
 it('surfaces persistence failures so Stripe receives a retryable response',async()=>{
  rpc.mockResolvedValue({data:null,error:new Error('temporary')});await expect(processStripeEvent({id:'evt_3',type:'invoice.paid',data:{object:{subscription:'sub_1'}}})).rejects.toThrow('temporary');
 });
 it('maps a portal price change back to the local plan',async()=>{
  await processStripeEvent({id:'evt_4',type:'customer.subscription.updated',created:124,data:{object:{id:'sub_4',status:'active',items:{data:[{price:{id:'price_growth_year'}}]}}}});
  expect(rpc).toHaveBeenLastCalledWith('sync_billing_plan_from_stripe',{p_subscription_id:'sub_4',p_plan:'growth',p_period:'annual'});
 });
 it('maps Payment Link subscriptions using their Stripe amount and cadence',async()=>{
  await processStripeEvent({id:'evt_5',type:'customer.subscription.updated',created:125,data:{object:{id:'sub_5',status:'trialing',items:{data:[{price:{id:'price_unknown',unit_amount:808200,currency:'usd',recurring:{interval:'month',interval_count:6}}}]}}}});
  expect(rpc).toHaveBeenLastCalledWith('sync_billing_plan_from_stripe',{p_subscription_id:'sub_5',p_plan:'scale',p_period:'semiannual'});
 });
 it('defers invoice events when their checkout subscription is not ready yet',async()=>{
  const errorWrite=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
  rpc
   .mockResolvedValueOnce({data:[{event_id:'evt_invoice',event_type:'invoice.paid',event_created:126,payload:{id:'evt_invoice',type:'invoice.paid',created:126,data:{object:{subscription:'sub_new'}}},attempts:1}],error:null})
   .mockResolvedValueOnce({data:null,error:{code:'P0001',message:'Unknown Stripe subscription',details:null}})
   .mockResolvedValueOnce({data:null,error:null});
  await expect(processNextStripeEvent()).resolves.toBe(true);
  expect(rpc).toHaveBeenLastCalledWith('finish_stripe_webhook',{p_event_id:'evt_invoice',p_success:false,p_error:'STRIPE_SUBSCRIPTION_NOT_READY'});
  expect(errorWrite).not.toHaveBeenCalled();
 });
});
