import { describe, it, expect } from 'vitest';
import { buildReport } from '../../src/report/report.builder.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import type { RuleException } from '../../src/types/rule.types.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const ctx: AuditContext = {
  run_id:       'test-run-abc',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

function makeException(overrides: Partial<RuleException> = {}): RuleException {
  return {
    invoice_id:      'some-id',
    tipo_regra:      'LOW_CONFIDENCE',
    valor_envolvido: 1000,
    descricao:       'Test exception',
    source_file:     'test.pdf',
    source_page:     null,
    metadata:        {},
    ...overrides,
  };
}

describe('buildReport', () => {
  it('returns correct run_id and generated_at', () => {
    const report = buildReport([], [], ctx);
    expect(report.run_id).toBe('test-run-abc');
    expect(() => new Date(report.generated_at)).not.toThrow();
  });

  it('returns correct total_invoices_processed', () => {
    const invoices = [makeInvoice(), makeInvoice(), makeInvoice()];
    const report = buildReport(invoices, [], ctx);
    expect(report.total_invoices_processed).toBe(3);
  });

  it('returns correct total_exceptions count', () => {
    const inv = makeInvoice();
    const exceptions = [
      makeException({ invoice_id: inv.id }),
      makeException({ invoice_id: inv.id }),
    ];
    const report = buildReport([inv], exceptions, ctx);
    expect(report.total_exceptions).toBe(2);
  });

  it('calculates valor_total_under_review only for invoices with exceptions', () => {
    const inv1 = makeInvoice({ valor_total: 1000 });
    const inv2 = makeInvoice({ valor_total: 2000 });
    const inv3 = makeInvoice({ valor_total: 3000 }); // no exception

    const exceptions = [makeException({ invoice_id: inv1.id }), makeException({ invoice_id: inv2.id })];
    const report = buildReport([inv1, inv2, inv3], exceptions, ctx);

    expect(report.valor_total_under_review).toBe(3000); // 1000 + 2000
  });

  it('maps tipo_regra to a human-readable rule_label', () => {
    const inv = makeInvoice();
    const exceptions = [
      makeException({ invoice_id: inv.id, tipo_regra: 'DUPLICATE_EXACT' }),
    ];
    const report = buildReport([inv], exceptions, ctx);
    expect(report.exceptions[0].rule_label).toBe('Exact Duplicate Invoice');
  });

  it('maps source_file and source_page into source_reference', () => {
    const inv = makeInvoice();
    const exceptions = [
      makeException({ invoice_id: inv.id, source_file: 'inv.pdf', source_page: 3 }),
    ];
    const report = buildReport([inv], exceptions, ctx);
    expect(report.exceptions[0].source_reference).toEqual({ file: 'inv.pdf', page: 3 });
  });

  it('returns empty report when no invoices or exceptions', () => {
    const report = buildReport([], [], ctx);
    expect(report.total_invoices_processed).toBe(0);
    expect(report.total_exceptions).toBe(0);
    expect(report.valor_total_under_review).toBe(0);
    expect(report.exceptions).toHaveLength(0);
  });
});
