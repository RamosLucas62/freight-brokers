import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),retrieveCheckout:vi.fn(),sendSecurityEmail:vi.fn()}));
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('../../src/billing/stripe.js',()=>({retrieveCheckoutSession:mocks.retrieveCheckout}));
vi.mock('../../src/notifications/security.sender.js',()=>({sendSecurityEmail:mocks.sendSecurityEmail}));
import {processOnboardingInvite} from '../../src/billing/onboarding.worker.js';

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PORTAL_URL','https://portal.aiolympian.com');mocks.sendSecurityEmail.mockResolvedValue(undefined);});

describe('checkout onboarding invitation',()=>{
 it('welcomes a trial customer and links directly to account setup',async()=>{
  mocks.rpc.mockImplementation(async(name)=>name==='claim_checkout_onboarding_invite'?{data:[{checkout_session_id:'cs_test_trial',email:'owner@example.com',attempts:1}],error:null}:{data:null,error:null});
  mocks.retrieveCheckout.mockResolvedValue({id:'cs_test_trial',status:'complete',payment_status:'no_payment_required',customer_details:{email:'owner@example.com'},metadata:{plan_code:'scale',billing_period:'semiannual'}});
  await expect(processOnboardingInvite()).resolves.toBe(true);
  expect(mocks.sendSecurityEmail).toHaveBeenCalledWith(expect.objectContaining({to:'owner@example.com',subject:'Welcome to Olympian — set up your account',idempotencyKey:expect.stringMatching(/^checkout-onboarding-/),html:expect.stringContaining('Your 7-day free trial of Olympian Scale has started.')}));
  expect(mocks.sendSecurityEmail.mock.calls[0][0].html).toContain('https://portal.aiolympian.com/onboarding?session_id=cs_test_trial');
  expect(mocks.sendSecurityEmail.mock.calls[0][0].html).toContain('Set up your account');
  expect(mocks.rpc).toHaveBeenCalledWith('finish_checkout_onboarding_invite',{p_session_id:'cs_test_trial',p_success:true,p_error:null});
 });
 it('records a retry when email delivery fails',async()=>{
  mocks.rpc.mockImplementation(async(name)=>name==='claim_checkout_onboarding_invite'?{data:[{checkout_session_id:'cs_test_retry',email:'owner@example.com',attempts:2}],error:null}:{data:null,error:null});
  mocks.retrieveCheckout.mockResolvedValue({id:'cs_test_retry',status:'complete',payment_status:'paid',customer_details:{email:'owner@example.com'},metadata:{plan_code:'core'}});
  mocks.sendSecurityEmail.mockRejectedValue(new Error('RESEND_SEND_FAILED_503'));
  await expect(processOnboardingInvite()).resolves.toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith('finish_checkout_onboarding_invite',{p_session_id:'cs_test_retry',p_success:false,p_error:'RESEND_SEND_FAILED_503'});
 });
});
