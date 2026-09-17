import {afterEach,describe,expect,it,vi} from 'vitest';
import {paymentLink,paymentLinks,planFromMetadata,plans,prices,selectionFromPriceId,selectionFromSubscription} from '../../src/billing/plans.js';

afterEach(()=>vi.unstubAllEnvs());

describe('three-tier billing catalog',()=>{
 it('matches the public plan allowances and monthly prices',()=>{
  expect(plans.core).toMatchObject({includedInvoices:500,overageCents:75,reprocessing:false});
  expect(plans.growth).toMatchObject({includedInvoices:1500,overageCents:50,reprocessing:true});
  expect(plans.scale).toMatchObject({includedInvoices:3000,overageCents:50,reprocessing:true});
  expect([prices.core.monthly.amount,prices.growth.monthly.amount,prices.scale.monthly.amount]).toEqual([49700,99700,149700]);
 expect(prices.scale.semiannual.amount).toBe(808200);
  expect(paymentLinks).toEqual({
   core:{monthly:'https://buy.stripe.com/6oUaEPbuO1Xh3xh38FcQU00',semiannual:'https://buy.stripe.com/6oU3cnfL46dxc3N38FcQU01',annual:'https://buy.stripe.com/6oU14fdCW45p8RBbFbcQU02'},
   growth:{monthly:'https://buy.stripe.com/5kQaEPbuO59t6JtbFbcQU03',semiannual:'https://buy.stripe.com/cNicMX2Yi8lFffZbFbcQU04',annual:'https://buy.stripe.com/7sYfZ99mGdFZ6JtdNjcQU05'},
   scale:{monthly:'https://buy.stripe.com/bJe7sDfL459t1p95gNcQU06',semiannual:'https://buy.stripe.com/4gMfZ956qfO73xheRncQU07',annual:'https://buy.stripe.com/fZu3cn6au1Xhd7R10xcQU08'},
  });
  expect(paymentLink('scale','semiannual')).toBe(paymentLinks.scale.semiannual);
 });

 it('preserves all three plan codes from Stripe metadata',()=>{
  expect(planFromMetadata('core')).toBe('core');
  expect(planFromMetadata('growth')).toBe('growth');
  expect(planFromMetadata('scale')).toBe('scale');
 });

 it('maps a Growth Stripe price back to its plan and period',()=>{
  vi.stubEnv('STRIPE_PRICE_GROWTH_ANNUAL','price_growth_annual');
  expect(selectionFromPriceId('price_growth_annual')).toEqual({plan:'growth',period:'annual'});
 });

 it('uses the subscription price before potentially stale Checkout metadata',()=>{
  vi.stubEnv('STRIPE_PRICE_SCALE_SEMIANNUAL','price_scale_six_months');
  expect(selectionFromSubscription({items:{data:[{price:{id:'price_scale_six_months'}}]},metadata:{plan_code:'core',billing_period:'monthly'}})).toEqual({plan:'scale',period:'semiannual'});
 });

 it('recognizes a Payment Link subscription even when price IDs and metadata are not configured',()=>{
  expect(selectionFromSubscription({items:{data:[{price:{id:'price_from_payment_link',unit_amount:808200,currency:'usd',recurring:{interval:'month',interval_count:6}}}]}})).toEqual({plan:'scale',period:'semiannual'});
  expect(selectionFromSubscription({items:{data:[{price:{id:'price_scheduled',unit_amount:997000,currency:'usd',recurring:{interval:'year',interval_count:1}}}]}})).toEqual({plan:'growth',period:'annual'});
 });

 it('does not infer a catalog plan from an unsupported currency or billing cadence',()=>{
  expect(selectionFromSubscription({items:{data:[{price:{unit_amount:808200,currency:'eur',recurring:{interval:'month',interval_count:6}}}]}})).toBeNull();
  expect(selectionFromSubscription({items:{data:[{price:{unit_amount:808200,currency:'usd',recurring:{interval:'month',interval_count:3}}}]}})).toBeNull();
 });
});
