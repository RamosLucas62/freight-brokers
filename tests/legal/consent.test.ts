import {describe,expect,it} from 'vitest';
import {PORTAL_ACCEPTANCE_TEXT,PRIVACY_VERSION,TERMS_VERSION,legalPage} from '../../src/legal/consent.js';

describe('portal legal consent',()=>{
 it('freezes the current legal versions and exact first-login acceptance text',()=>{
  expect({TERMS_VERSION,PRIVACY_VERSION}).toEqual({TERMS_VERSION:'2026-09-12',PRIVACY_VERSION:'2026-09-12'});
  expect(PORTAL_ACCEPTANCE_TEXT).toContain('agree to the Terms of Service');
  expect(PORTAL_ACCEPTANCE_TEXT).toContain('acknowledge the Privacy Policy');
  expect(PORTAL_ACCEPTANCE_TEXT).toContain('authorized to accept');
 });
 it('publishes decision-support and privacy disclosures',()=>{
  expect(legalPage('terms')).toContain('not accusations');
  expect(legalPage('terms')).toContain('automatically renew');
  expect(legalPage('privacy')).toContain('do not sell personal information');
  expect(legalPage('privacy')).toContain('IP address');
 });
});
