import { describe, it, expect } from 'vitest';
import { duplicateExactRule } from '../../src/rules/duplicate-exact.rule.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const noopGetCarrier = async () => makeCarrierResult();
const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

describe('DUPLICATE_EXACT rule', () => {
  it('returns no exceptions for unique invoice numbers', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001' }),
      makeInvoice({ numero_fatura: 'INV-002' }),
      makeInvoice({ numero_fatura: 'INV-003' }),
    ];
    const result = await duplicateExactRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('flags both invoices with the same numero_fatura', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-001' }),
      makeInvoice({ numero_fatura: 'INV-001' }),
    ];
    const result = await duplicateExactRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(2);
    expect(result.every(e => e.tipo_regra === 'DUPLICATE_EXACT')).toBe(true);
  });

  it('flags all invoices when 3 share the same number', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-DUP' }),
      makeInvoice({ numero_fatura: 'INV-DUP' }),
      makeInvoice({ numero_fatura: 'INV-DUP' }),
    ];
    const result = await duplicateExactRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(3);
    expect(result[0].metadata.duplicate_count).toBe(3);
  });

  it('is case-insensitive', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'inv-001' }),
      makeInvoice({ numero_fatura: 'INV-001' }),
    ];
    const result = await duplicateExactRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(2);
  });

  it('does not cross-contaminate distinct duplicates', async () => {
    const invoices = [
      makeInvoice({ numero_fatura: 'INV-A' }),
      makeInvoice({ numero_fatura: 'INV-A' }),
      makeInvoice({ numero_fatura: 'INV-B' }),
      makeInvoice({ numero_fatura: 'INV-B' }),
    ];
    const result = await duplicateExactRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(4);
  });
});
