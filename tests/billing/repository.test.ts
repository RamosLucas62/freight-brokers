import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),billingMaybeSingle:vi.fn(),leadMaybeSingle:vi.fn(),notifyLeadFunnel:vi.fn()}));
const {rpc,billingMaybeSingle,leadMaybeSingle,notifyLeadFunnel}=mocks;
vi.mock('../../src/config/supabase.js',()=>({
 getSupabaseClient:()=>({
  rpc:mocks.rpc,
  from:(table:string)=>{
   if(table==='audit_billing_customers')return{select:()=>({eq:()=>({maybeSingle:mocks.billingMaybeSingle})})};
   return{select:()=>({eq:()=>({order:()=>({limit:()=>({maybeSingle:mocks.leadMaybeSingle})})})})};
  },
 }),
}));
vi.mock('../../src/notifications/google-chat.sender.js',()=>({notifyLeadFunnel:mocks.notifyLeadFunnel,notifyOperationalError:vi.fn().mockResolvedValue(undefined)}));
import {processNextStripeEvent,processStripeEvent} from '../../src/billing/repository.js';

beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL','price_growth_year');rpc.mockResolvedValue({data:true,error:null});
 notifyLeadFunnel.mockResolvedValue(undefined);
 billingMaybeSingle.mockResolvedValue({data:{billing_email:'buyer@example.com',status:'active',plan_code:'growth',billing_period:'annual'},error:null});
 leadMaybeSingle.mockResolvedValue({data:{email:'buyer@example.com',contact_name:'Ana Silva',company_name:'Carrier Co'},error:null});
});
describe('Stripe webhook persistence',()=>{
 it('passes supported events to the atomic idempotent database function',async()=>{
  await expect(processStripeEvent({id:'evt_1',type:'invoice.payment_failed',created:123,data:{object:{subscription:'sub_1'}}})).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('process_stripe_billing_event',{p_event_id:'evt_1',p_event_type:'invoice.payment_failed',p_event_created:123,p_object:{subscription:'sub_1'}});
 });
 it('processes completed Stripe checkout without checkout-page legal acceptance',async()=>{
  await processStripeEvent({id:'evt_checkout',type:'checkout.session.completed',created:123,data:{object:{id:'cs_1',client_reference_id:'22222222-2222-4222-8222-222222222222',customer:'cus_1',subscription:'sub_1',payment_status:'no_payment_required',customer_details:{email:'buyer@example.com'}}}});
  expect(rpc).not.toHaveBeenCalledWith('confirm_checkout_acceptance',expect.anything());
  expect(notifyLeadFunnel).toHaveBeenCalledWith(expect.objectContaining({stage:'trial_started',name:'Ana Silva',company:'Carrier Co',email:'buyer@example.com'}));
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
 it('labels trial conversion correctly and includes the lead identity',async()=>{
  billingMaybeSingle.mockResolvedValueOnce({data:{billing_email:'buyer@example.com',status:'trialing',plan_code:'growth',billing_period:'annual'},error:null});
  await processStripeEvent({id:'evt_trial_end',type:'customer.subscription.updated',created:126,data:{object:{id:'sub_trial',status:'active',items:{data:[{price:{id:'price_growth_year'}}]}}}});
  expect(notifyLeadFunnel).toHaveBeenCalledWith(expect.objectContaining({stage:'trial_ended',name:'Ana Silva',company:'Carrier Co',email:'buyer@example.com'}));
 });
 it('announces a plan change only when the plan or billing period actually changed',async()=>{
  billingMaybeSingle.mockResolvedValueOnce({data:{billing_email:'buyer@example.com',status:'active',plan_code:'core',billing_period:'monthly'},error:null});
  await processStripeEvent({id:'evt_plan',type:'customer.subscription.updated',created:127,data:{object:{id:'sub_plan',status:'active',items:{data:[{price:{id:'price_growth_year'}}]}}}});
  expect(notifyLeadFunnel).toHaveBeenCalledWith(expect.objectContaining({stage:'plan_changed',name:'Ana Silva',company:'Carrier Co'}));
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
