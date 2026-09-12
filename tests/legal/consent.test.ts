import {describe,expect,it} from 'vitest';
import {CHECKOUT_DISCLOSURE_VERSION,PRIVACY_VERSION,TERMS_VERSION,checkoutDisclosure,legalPage} from '../../src/legal/consent.js';

describe('checkout legal consent',()=>{
 it('freezes versioned terms and the exact post-trial charge',()=>{
  expect({TERMS_VERSION,PRIVACY_VERSION,CHECKOUT_DISCLOSURE_VERSION}).toEqual({TERMS_VERSION:'2026-09-12',PRIVACY_VERSION:'2026-09-12',CHECKOUT_DISCLOSURE_VERSION:'2026-09-12.1'});
  expect(checkoutDisclosure('scale','semiannual')).toContain('7-day free trial');
  expect(checkoutDisclosure('scale','semiannual')).toContain('price and billing frequency displayed below');
  expect(checkoutDisclosure('scale','semiannual')).toContain('until canceled');
 });
 it('publishes decision-support and privacy disclosures',()=>{
  expect(legalPage('terms')).toContain('not accusations');
  expect(legalPage('terms')).toContain('automatically renew');
  expect(legalPage('privacy')).toContain('do not sell personal information');
  expect(legalPage('privacy')).toContain('IP address');
 });
});
