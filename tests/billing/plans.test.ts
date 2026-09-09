import {afterEach,describe,expect,it,vi} from 'vitest';
import {paymentLink,paymentLinks,planFromMetadata,plans,prices,selectionFromPriceId} from '../../src/billing/plans.js';

afterEach(()=>vi.unstubAllEnvs());

describe('three-tier billing catalog',()=>{
 it('matches the public plan allowances and monthly prices',()=>{
  expect(plans.core).toMatchObject({includedInvoices:500,overageCents:75,reprocessing:false});
  expect(plans.growth).toMatchObject({includedInvoices:1500,overageCents:50,reprocessing:true});
  expect(plans.scale).toMatchObject({includedInvoices:3000,overageCents:50,reprocessing:true});
  expect([prices.core.monthly.amount,prices.growth.monthly.amount,prices.scale.monthly.amount]).toEqual([49700,99700,149700]);
 expect(prices.scale.semiannual.amount).toBe(808200);
  expect(paymentLinks).toEqual({
   core:{monthly:'https://buy.stripe.com/test_6oU14fdCW45p8RBbFbcQU02',semiannual:'https://buy.stripe.com/test_5kQaEPbuO59t6JtbFbcQU03',annual:'https://buy.stripe.com/test_cNicMX2Yi8lFffZbFbcQU04'},
   growth:{monthly:'https://buy.stripe.com/test_7sYfZ99mGdFZ6JtdNjcQU05',semiannual:'https://buy.stripe.com/test_bJe7sDfL459t1p95gNcQU06',annual:'https://buy.stripe.com/test_4gMfZ956qfO73xheRncQU07'},
   scale:{monthly:'https://buy.stripe.com/test_6oUaEPbuO1Xh3xh38FcQU00',semiannual:'https://buy.stripe.com/test_fZu3cn6au1Xhd7R10xcQU08',annual:'https://buy.stripe.com/test_bJe3cn9mG0Tdgk34cJcQU09'},
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
});
