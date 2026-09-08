import {afterEach,describe,expect,it,vi} from 'vitest';
import {planFromMetadata,plans,prices,selectionFromPriceId} from '../../src/billing/plans.js';

afterEach(()=>vi.unstubAllEnvs());

describe('three-tier billing catalog',()=>{
 it('matches the public plan allowances and monthly prices',()=>{
  expect(plans.core).toMatchObject({includedInvoices:500,overageCents:75,reprocessing:false});
  expect(plans.growth).toMatchObject({includedInvoices:1500,overageCents:50,reprocessing:true});
  expect(plans.scale).toMatchObject({includedInvoices:3000,overageCents:50,reprocessing:true});
  expect([prices.core.monthly.amount,prices.growth.monthly.amount,prices.scale.monthly.amount]).toEqual([49700,99700,149700]);
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
