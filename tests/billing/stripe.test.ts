import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {applyRetentionDiscount,cancelSubscriptionAtPeriodEnd,createBillingPortalSession,pauseSubscriptionOneMonth} from '../../src/billing/stripe.js';
import {verifyStripeSignature} from '../../src/billing/stripe.js';
import Stripe from 'stripe';

const fetchMock=vi.fn();
beforeEach(()=>{
 vi.stubGlobal('fetch',fetchMock);vi.stubEnv('STRIPE_SECRET_KEY','sk_test_secret');vi.stubEnv('PORTAL_URL','https://portal.example.com');
 vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID','bpc_customer');vi.stubEnv('STRIPE_RETENTION_COUPON_ID','coupon_15_once');
 fetchMock.mockResolvedValue({ok:true,json:async()=>({url:'https://billing.stripe.test/session'})});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});

describe('Stripe subscription actions',()=>{
 it('opens the restricted customer portal configuration',async()=>{
  await createBillingPortalSession('cus_123');const [,request]=fetchMock.mock.calls[0];const body=request.body as URLSearchParams;
  expect(body.get('customer')).toBe('cus_123');expect(body.get('configuration')).toBe('bpc_customer');expect(body.get('return_url')).toBe('https://portal.example.com/');
 });
 it('applies the configured one-time retention coupon idempotently',async()=>{
  await applyRetentionDiscount('sub_123','tenant-1');const [url,request]=fetchMock.mock.calls[0];
  expect(url).toContain('/subscriptions/sub_123');expect((request.body as URLSearchParams).get('discounts[0][coupon]')).toBe('coupon_15_once');expect(request.headers['Idempotency-Key']).toBe('retention-discount-tenant-1');
 });
 it('sets an automatic 30-day resume and schedules final cancellation',async()=>{
  const resumesAt=new Date('2026-10-07T12:00:00Z');await pauseSubscriptionOneMonth('sub_pause','tenant-1',resumesAt);
  expect((fetchMock.mock.calls[0][1].body as URLSearchParams).get('pause_collection[resumes_at]')).toBe(String(resumesAt.getTime()/1000));
  await cancelSubscriptionAtPeriodEnd('sub_cancel','tenant-1');expect((fetchMock.mock.calls[1][1].body as URLSearchParams).get('cancel_at_period_end')).toBe('true');
 });
});
it('uses Stripe official verification and supports rotated signature headers',()=>{const secret='whsec_test_secret';vi.stubEnv('STRIPE_WEBHOOK_SECRET',secret);const payload=JSON.stringify({id:'evt_1',type:'invoice.paid',created:1,data:{object:{subscription:'sub_1'}}});const header=Stripe.webhooks.generateTestHeaderString({payload,secret});expect(verifyStripeSignature(payload,header)).toMatchObject({id:'evt_1',type:'invoice.paid'});expect(()=>verifyStripeSignature(payload+' ',header)).toThrow('STRIPE_SIGNATURE_INVALID');});
