import { describe, it, expect } from 'vitest';
import { mcDivergenceRule } from '../../src/rules/mc-divergence.rule.js';
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

describe('MC_DIVERGENCE rule', () => {
  it('returns no exceptions when FMCSA name matches invoice carrier_name', async () => {
    const inv = makeInvoice({ carrier_name: 'SWIFT TRANSPORT LLC', mc_number: '123456' });
    const getCarrier = makeGetCarrier({ legal_name: 'SWIFT TRANSPORT LLC' });
    const result = await mcDivergenceRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('flags invoice when FMCSA name differs from invoice carrier_name', async () => {
    const inv = makeInvoice({ carrier_name: 'SWIFT TRANSPORT LLC', mc_number: '123456' });
    const getCarrier = makeGetCarrier({ legal_name: 'SWIFT TRUCKING INC' });
    const result = await mcDivergenceRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].tipo_regra).toBe('MC_DIVERGENCE');
    expect(result[0].metadata.fmcsa_name).toBe('SWIFT TRUCKING INC');
    expect(result[0].metadata.invoice_name).toBe('SWIFT TRANSPORT LLC');
  });

  it('is case-insensitive for comparison', async () => {
    const inv = makeInvoice({ carrier_name: 'swift transport llc', mc_number: '123456' });
    const getCarrier = makeGetCarrier({ legal_name: 'SWIFT TRANSPORT LLC' });
    const result = await mcDivergenceRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('skips invoices without mc_number', async () => {
    const inv = makeInvoice({ mc_number: null, carrier_name: 'SOME CARRIER' });
    const getCarrier = makeGetCarrier({ legal_name: 'DIFFERENT NAME' });
    const result = await mcDivergenceRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('skips when FMCSA legal_name is null', async () => {
    const inv = makeInvoice({ mc_number: '123456', carrier_name: 'SOME CARRIER' });
    const getCarrier = makeGetCarrier({ legal_name: null });
    const result = await mcDivergenceRule.evaluate([inv], getCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('deduplicates getCarrier calls for same MC', async () => {
    let callCount = 0;
    const getCarrier = async () => {
      callCount++;
      return makeCarrierResult({ legal_name: 'SWIFT TRANSPORT LLC' });
    };
    const invoices = [
      makeInvoice({ mc_number: '123456', carrier_name: 'SWIFT TRANSPORT LLC' }),
      makeInvoice({ mc_number: '123456', carrier_name: 'SWIFT TRANSPORT LLC' }),
      makeInvoice({ mc_number: '123456', carrier_name: 'SWIFT TRANSPORT LLC' }),
    ];
    await mcDivergenceRule.evaluate(invoices, getCarrier, ctx);
    // Should only call getCarrier once for the same MC number
    expect(callCount).toBe(1);
  });
});
