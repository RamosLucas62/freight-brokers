import { describe, it, expect } from 'vitest';
import { duplicateExactRule, lowConfidenceRule, bankingChangeRule, authorityInactiveRule } from '../../src/rules/index.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
const ctx = { run_id: 'review', carrierCache: new Map(), cacheTtlHours: 4 };
const carrier = async () => makeCarrierResult();
describe('audit regressions', () => {
  it('does not match invoice numbers across distinct MCs', async () => {
    expect(await duplicateExactRule.evaluate([makeInvoice(), makeInvoice({ mc_number: '999' })], carrier, ctx)).toEqual([]);
  });
  it('does not treat blank numbers as duplicates', async () => {
    expect(await duplicateExactRule.evaluate([makeInvoice({ numero_fatura: '' }), makeInvoice({ numero_fatura: '' })], carrier, ctx)).toEqual([]);
  });
  it('flags missing scores and critical values even with a high reported score', async () => {
    const result = await lowConfidenceRule.evaluate([makeInvoice({ confidence_scores: {} }), makeInvoice({ mc_number: null })], carrier, ctx);
    expect(result).toHaveLength(2);
  });
  it('does not interpret missing banking as a different account', async () => {
    expect(await bankingChangeRule.evaluate([makeInvoice(), makeInvoice({ dados_bancarios: null })], carrier, ctx)).toEqual([]);
  });
  it('does not claim historical authority verification', async () => {
    const result = await authorityInactiveRule.evaluate([makeInvoice()], async () => makeCarrierResult({ authority_status: 'INACTIVE' }), ctx);
    expect(result[0].metadata.historical_status_verified).toBe(false);
    expect(result[0].descricao).toContain('historical load-date status not verified');
  });
});
