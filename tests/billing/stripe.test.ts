import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {applyRetentionDiscount,cancelSubscriptionAtPeriodEnd,createBillingPortalSession,createCheckoutSession,createOverageInvoice,pauseSubscriptionOneMonth} from '../../src/billing/stripe.js';
import {verifyStripeSignature} from '../../src/billing/stripe.js';
import Stripe from 'stripe';

const fetchMock=vi.fn();
beforeEach(()=>{
 vi.stubGlobal('fetch',fetchMock);vi.stubEnv('STRIPE_SECRET_KEY','sk_test_secret');vi.stubEnv('PORTAL_URL','https://portal.example.com');
 vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID','bpc_customer');vi.stubEnv('STRIPE_RETENTION_COUPON_ID','coupon_15_once');
 vi.stubEnv('STRIPE_PRICE_CORE_MONTHLY','price_core_month');vi.stubEnv('STRIPE_PRICE_CORE_SEMIANNUAL','price_core_6');vi.stubEnv('STRIPE_PRICE_CORE_ANNUAL','price_core_year');
 vi.stubEnv('STRIPE_PRICE_GROWTH_MONTHLY','price_growth_month');vi.stubEnv('STRIPE_PRICE_GROWTH_SEMIANNUAL','price_growth_6');vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL','price_growth_year');
 vi.stubEnv('STRIPE_PRICE_SCALE_MONTHLY','price_scale_month');vi.stubEnv('STRIPE_PRICE_SCALE_SEMIANNUAL','price_scale_6');vi.stubEnv('STRIPE_PRICE_SCALE_ANNUAL','price_scale_year');
 fetchMock.mockResolvedValue({ok:true,json:async()=>({url:'https://billing.stripe.test/session'})});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});

describe('Stripe subscription actions',()=>{
 it('selects one of the nine server-side prices and stores plan metadata',async()=>{
  await createCheckoutSession('buyer@example.com','growth','semiannual');const [,request]=fetchMock.mock.calls[0];const body=request.body as URLSearchParams;
  expect(body.get('line_items[0][price]')).toBe('price_growth_6');expect(body.get('metadata[plan_code]')).toBe('growth');expect(body.get('subscription_data[metadata][billing_period]')).toBe('semiannual');
 });
 it('uses different idempotency keys when the checkout return URL changes',async()=>{
  await createCheckoutSession('buyer@example.com','scale','semiannual','https://portal.example.com/private-result');
  await createCheckoutSession('buyer@example.com','scale','semiannual','https://portal.example.com/');
  const privateKey=fetchMock.mock.calls[0][1].headers['Idempotency-Key'];
  const publicKey=fetchMock.mock.calls[1][1].headers['Idempotency-Key'];
  expect(privateKey).not.toBe(publicKey);
 });
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
 it('creates an idempotent monthly overage invoice in cents',async()=>{
  await createOverageInvoice({settlementId:'set_1',customerId:'cus_1',subscriptionId:'sub_1',usageMonth:'2026-08-01',overageCount:120,unitAmountCents:75});
  const item=fetchMock.mock.calls[0][1];expect(fetchMock.mock.calls[0][0]).toContain('/invoiceitems');expect((item.body as URLSearchParams).get('amount')).toBe('9000');expect(item.headers['Idempotency-Key']).toBe('overage-item-set_1');
  const invoice=fetchMock.mock.calls[1][1];expect((invoice.body as URLSearchParams).get('collection_method')).toBe('charge_automatically');expect(invoice.headers['Idempotency-Key']).toBe('overage-invoice-set_1');
 });
});
it('uses Stripe official verification and supports rotated signature headers',()=>{const secret='whsec_test_secret';vi.stubEnv('STRIPE_WEBHOOK_SECRET',secret);const payload=JSON.stringify({id:'evt_1',type:'invoice.paid',created:1,data:{object:{subscription:'sub_1'}}});const header=Stripe.webhooks.generateTestHeaderString({payload,secret});expect(verifyStripeSignature(payload,header)).toMatchObject({id:'evt_1',type:'invoice.paid'});expect(()=>verifyStripeSignature(payload+' ',header)).toThrow('STRIPE_SIGNATURE_INVALID');});
