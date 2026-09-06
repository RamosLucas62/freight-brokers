import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AzureInvoiceExtractor, mapAzureInvoice } from '../../src/extraction/azure.extractor.js';
const result = { content: 'Carrier MC# 123456 USDOT: 9876543', documents: [{ fields: {
  InvoiceId: { valueString: 'A-123', confidence: 0.98 }, VendorName: { valueString: 'Acme' },
  InvoiceTotal: { valueCurrency: { amount: 123.45 }, confidence: 0.99 }, InvoiceDate: { valueDate: '2026-09-01' },
} }] };
afterEach(() => vi.unstubAllEnvs());
describe('Azure invoice extraction', () => {
  it('maps recognized values and leaves banking unknown', () => {
    const invoice = mapAzureInvoice(result, 'test.pdf');
    expect(invoice.fields.numero_fatura).toBe('A-123');
    expect(invoice.fields.valor_total).toBe(123.45);
    expect(invoice.fields.mc_number).toBe('123456');
    expect(invoice.confidence_scores.mc_number).toBeLessThan(0.85);
    expect(invoice.fields.dados_bancarios).toBeNull();
  });
  it('rejects multiple invoices instead of discarding extra documents', () => {
    expect(() => mapAzureInvoice({ documents: [{}, {}] }, 'test.pdf')).toThrow('exactly one');
  });
  it('uploads PDF bytes and polls to completion', async () => {
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'https://example.cognitiveservices.azure.com');
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', 'test-key');
    const dir = await mkdtemp(join(tmpdir(), 'azure-test-'));
    try {
      const file = join(dir, 'test.pdf'); await writeFile(file, '%PDF-1.4 test');
      const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'operation-location': 'https://example.cognitiveservices.azure.com/result/1' } }))
        .mockResolvedValueOnce(Response.json({ status: 'running' }))
        .mockResolvedValueOnce(Response.json({ status: 'succeeded', analyzeResult: result }));
      const extractor = new AzureInvoiceExtractor(request, (async () => {}) as any);
      expect((await extractor.extract(file)).fields.numero_fatura).toBe('A-123');
      expect(request).toHaveBeenCalledTimes(3);
      expect(JSON.parse(request.mock.calls[0][1].body).base64Source).toBe(Buffer.from('%PDF-1.4 test').toString('base64'));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('fails clearly when credentials are absent', async () => {
    vi.stubEnv('AZURE_DOCUMENT_INTELLIGENCE_KEY', '');
    await expect(new AzureInvoiceExtractor().extract('test.pdf')).rejects.toThrow('AZURE_DOCUMENT_INTELLIGENCE');
  });
});
