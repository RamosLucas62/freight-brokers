import { describe, it, expect } from 'vitest';
import { authorityInactiveRule } from '../../src/rules/authority-inactive.rule.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext, CarrierLookupResult } from '../../src/types/carrier.types.js';

const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

function makeGetCarrier(result: Partial<CarrierLookupResult> = {}) {
  return async () => makeCarrierResult(result);
}

describe('AUTHORITY_INACTIVE rule', () => {
  it('returns no exceptions for ACTIVE carrier with carrier_authority=true', async () => {
    const inv = makeInvoice({ mc_number: '123456' });
    const getCarrier = makeGetCarrier({ authority_status: 'ACTIVE', carrier_authority: true });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('flags invoice when authority_status is INACTIVE', async () => {
    const inv = makeInvoice({ mc_number: '123456' });
    const getCarrier = makeGetCarrier({ authority_status: 'INACTIVE', carrier_authority: true });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].tipo_regra).toBe('AUTHORITY_INACTIVE');
    expect(result[0].metadata.authority_status).toBe('INACTIVE');
  });

  it('flags invoice when authority_status is REVOKED', async () => {
    const inv = makeInvoice({ mc_number: '123456' });
    const getCarrier = makeGetCarrier({ authority_status: 'REVOKED', carrier_authority: true });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.authority_status).toBe('REVOKED');
  });

  it('flags invoice when ACTIVE but carrier_authority=false', async () => {
    const inv = makeInvoice({ mc_number: '123456' });
    const getCarrier = makeGetCarrier({ authority_status: 'ACTIVE', carrier_authority: false });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.carrier_authority).toBe(false);
  });

  it('skips invoices with no mc_number and no dot_number', async () => {
    const inv = makeInvoice({ mc_number: null, dot_number: null });
    const getCarrier = makeGetCarrier({ authority_status: 'INACTIVE' });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('uses dot_number when mc_number is absent', async () => {
    const inv = makeInvoice({ mc_number: null, dot_number: '9876543' });
    const getCarrier = makeGetCarrier({ authority_status: 'INACTIVE', carrier_authority: true });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(1);
  });

  it('includes data_carga in metadata', async () => {
    const inv = makeInvoice({ mc_number: '123456', data_carga: '2024-01-15' });
    const getCarrier = makeGetCarrier({ authority_status: 'INACTIVE', carrier_authority: false });
    const result = await authorityInactiveRule.evaluate([inv], getCarrier, ctx);
    expect(result[0].metadata.data_carga).toBe('2024-01-15');
  });
});
