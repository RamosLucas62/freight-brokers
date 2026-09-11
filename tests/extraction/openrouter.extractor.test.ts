import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenRouterInvoiceExtractor } from '../../src/extraction/openrouter.extractor.js';
import { ExtractionResultSchema } from '../../src/extraction/schema.js';

const payload = () => ({ invoice_count: 1, fields: {
  numero_fatura: 'INV-1', numero_carga: 'LOAD-2', carrier_name: 'Carrier', mc_number: '123456',
  dot_number: null, data_carga: null, data_fatura: '2026-09-05', valor_total: 1234.5,
  origem: 'Boston', destino: 'Miami', dados_bancarios: { account_number: '001234', routing_number: '012345678', bank_name: null, account_type: null, payee_name: null },
}, evidence:Object.fromEntries(['numero_fatura','numero_carga','carrier_name','mc_number','dot_number','data_carga','data_fatura','valor_total','origem','destino','dados_bancarios'].map(name=>[
  name,
  {page:name==='dot_number'||name==='data_carga'?null:1,text:name==='dot_number'||name==='data_carga'?null:String(name==='valor_total'?'1,234.50':name==='dados_bancarios'?'001234 012345678':name==='numero_fatura'?'INV-1':'source value')},
])),accessorials: [{ tipo: 'DETENTION', descricao: 'Detention', valor: 50, pagina: 1 }] });
const reply = (value: unknown = payload(), finish_reason = 'stop') => Response.json({ id: 'gen-test', model: 'test/model', choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });
let dir: string;
let file: string;
beforeEach(async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'secret-test');
  vi.stubEnv('OPENROUTER_MODEL', 'test/model');
  vi.stubEnv('OPENROUTER_PDF_ENGINE', 'native');
  dir = await mkdtemp(join(tmpdir(), 'openrouter-test-'));
  file = join(dir, 'invoice.pdf'); await writeFile(file, '%PDF-1.4 test');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
describe('OpenRouter extraction', () => {
  it('sends private PDF bytes and a strict schema; preserves banking strings and source evidence', async () => {
    const request = vi.fn().mockResolvedValue(reply());
    const result = await new OpenRouterInvoiceExtractor(request).extract(file);
    expect(ExtractionResultSchema.safeParse(result).success).toBe(true);
    expect(result.fields.dados_bancarios?.account_number).toBe('001234');
    expect(result.confidence_scores).toEqual({});
    expect(result.field_evidence?.numero_fatura).toMatchObject({page:1,text:'INV-1'});
    expect(result.extraction_raw.confidence_source).toBe('verification_engine');
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer secret-test');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('test/model');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider.require_parameters).toBe(true);
    expect(body.messages[1].content[1].file.file_data).toBe('data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64'));
    expect(JSON.stringify(result)).not.toContain('secret-test');
  });
  it.each([0, 2])('rejects invoice count %i', async count => {
    await expect(new OpenRouterInvoiceExtractor(vi.fn().mockResolvedValue(reply({ ...payload(), invoice_count: count }))).extract(file)).rejects.toThrow('exactly one');
  });
  it.each([401, 402, 429, 500])('fails safely on HTTP %i', async status => {
    const request = vi.fn().mockResolvedValue(new Response('secret-test', { status }));
    await expect(new OpenRouterInvoiceExtractor(request).extract(file)).rejects.toThrow(`HTTP ${status}`);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed fields', async () => {
    const value = payload(); (value.fields as any).valor_total = 'wrong';
    await expect(new OpenRouterInvoiceExtractor(vi.fn().mockResolvedValue(reply(value))).extract(file)).rejects.toThrow('invalid extraction');
  });
  it('rejects truncated output', async () => {
    await expect(new OpenRouterInvoiceExtractor(vi.fn().mockResolvedValue(reply(payload(), 'length'))).extract(file)).rejects.toThrow('incomplete');
  });
  it('rejects refusals and non-JSON messages', async () => {
    for (const message of [{ content: '{}', refusal: 'no' }, { content: 'not JSON' }]) {
      const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message }] }));
      await expect(new OpenRouterInvoiceExtractor(request).extract(file)).rejects.toThrow('invalid extraction');
    }
  });
  it('sanitizes network failures', async () => {
    await expect(new OpenRouterInvoiceExtractor(vi.fn().mockRejectedValue(new Error('secret-test'))).extract(file)).rejects.toThrow('request failed or timed out');
  });
  it('rejects missing key, invalid engine and non-PDF before a request', async () => {
    const request = vi.fn(); const extractor = new OpenRouterInvoiceExtractor(request);
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(extractor.extract(file)).rejects.toThrow('OPENROUTER_API_KEY');
    vi.stubEnv('OPENROUTER_API_KEY', 'secret-test'); vi.stubEnv('OPENROUTER_PDF_ENGINE', 'bad');
    await expect(extractor.extract(file)).rejects.toThrow('OPENROUTER_PDF_ENGINE');
    vi.stubEnv('OPENROUTER_PDF_ENGINE', 'native'); await writeFile(file, 'plain text');
    await expect(extractor.extract(file)).rejects.toThrow('Not a PDF');
    expect(request).not.toHaveBeenCalled();
  });
});
