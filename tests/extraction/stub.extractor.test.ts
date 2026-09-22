import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { StubExtractor } from '../../src/extraction/stub.extractor.js';
import { ExtractionResultSchema, ValidatingExtractor } from '../../src/extraction/index.js';

describe('StubExtractor', () => {
  const extractor = new StubExtractor();

  it('returns a result that conforms to InvoiceExtractionResult schema', async () => {
    const result = await extractor.extract('invoices/test.pdf');
    const parsed = ExtractionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('uses provided filePath as source_file', async () => {
    const result = await extractor.extract('invoices/my-invoice.pdf');
    expect(result.source_file).toBe('invoices/my-invoice.pdf');
  });

  it('returns all required InvoiceFields', async () => {
    const result = await extractor.extract('test.pdf');
    const fields = result.fields;
    expect(fields.numero_fatura).toBeDefined();
    expect(fields.valor_total).toBeDefined();
    expect(fields.mc_number).toBeDefined();
    expect(fields.dados_bancarios).toBeDefined();
  });

  it('returns confidence scores for all critical fields', async () => {
    const result = await extractor.extract('test.pdf');
    const scores = result.confidence_scores;
    expect(scores.numero_fatura).toBeGreaterThan(0);
    expect(scores.valor_total).toBeGreaterThan(0);
    expect(scores.mc_number).toBeGreaterThan(0);
    expect(scores.dados_bancarios).toBeGreaterThan(0);
  });

  it('accepts field overrides', async () => {
    const custom = new StubExtractor({
      fields: { numero_fatura: 'CUSTOM-999' } as any,
    });
    const result = await custom.extract('test.pdf');
    expect(result.fields.numero_fatura).toBe('CUSTOM-999');
  });

  it('returns accessorials array', async () => {
    const result = await extractor.extract('test.pdf');
    expect(Array.isArray(result.accessorials)).toBe(true);
    if (result.accessorials.length > 0) {
      const acc = result.accessorials[0];
      expect(acc.tipo).toBeDefined();
      expect(acc.valor).toBeDefined();
      expect(acc.confidence).toBeGreaterThanOrEqual(0);
      expect(acc.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('forwards the cost attribution context through contract validation', async () => {
    const context={tenantId:'11111111-1111-4111-8111-111111111111',subjectType:'audit_run' as const,subjectId:'run-1'};
    const inner=new StubExtractor();
    const extract=vi.spyOn(inner,'extract');
    await new ValidatingExtractor(inner).extract('test.pdf',context);
    expect(extract).toHaveBeenCalledWith('test.pdf',context);
  });
});
