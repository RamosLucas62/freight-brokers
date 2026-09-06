import { describe, it, expect } from 'vitest';
import { duplicateProbableRule } from '../../src/rules/duplicate-probable.rule.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const noopGetCarrier = async () => makeCarrierResult();
const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

describe('DUPLICATE_PROBABLE rule', () => {
  it('returns no exceptions for different carriers', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
      makeInvoice({ numero_fatura: 'INV-002', carrier_name: 'CARRIER B', valor_total: 1000, data_fatura: '2024-01-01' }),
    ];
    const result = await duplicateProbableRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('returns no exceptions for different amounts', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
      makeInvoice({ numero_fatura: 'INV-002', carrier_name: 'CARRIER A', valor_total: 2000, data_fatura: '2024-01-01' }),
    ];
    const result = await duplicateProbableRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('returns no exceptions when dates are more than 7 days apart', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
      makeInvoice({ numero_fatura: 'INV-002', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-10' }),
    ];
    const result = await duplicateProbableRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('flags both invoices when same carrier, amount, and within 7 days with different numbers', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
      makeInvoice({ numero_fatura: 'INV-002', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-05' }),
    ];
    const result = await duplicateProbableRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(2);
    expect(result.every(e => e.tipo_regra === 'DUPLICATE_PROBABLE')).toBe(true);
  });

  it('does not flag same number (handled by DUPLICATE_EXACT)', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
      makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' }),
    ];
    const result = await duplicateProbableRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('includes partner invoice id in metadata', async () => {
    const inv1 = makeInvoice({ numero_fatura: 'INV-001', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-01' });
    const inv2 = makeInvoice({ numero_fatura: 'INV-002', carrier_name: 'CARRIER A', valor_total: 1000, data_fatura: '2024-01-02' });
    const result = await duplicateProbableRule.evaluate([inv1, inv2], noopGetCarrier, ctx);
    const ex1 = result.find(e => e.invoice_id === inv1.id)!;
    expect(ex1.metadata.partner_invoice).toBe(inv2.id);
  });
});
