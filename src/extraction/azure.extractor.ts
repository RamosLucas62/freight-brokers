import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { IExtractionProvider } from './extraction.interface.js';
import type { InvoiceExtractionResult } from '../types/invoice.types.js';

type Field = { valueString?: string; valueDate?: string; valueCurrency?: { amount?: number }; content?: string; confidence?: number };
type Result = { documents?: { fields?: Record<string, Field> }[]; [key: string]: unknown };

export function mapAzureInvoice(result: Result, file: string): InvoiceExtractionResult {
  if (result.documents?.length !== 1) throw new Error('Expected exactly one invoice per PDF; split the document and retry.');
  const f = result.documents[0].fields ?? {};
  const content = typeof result.content === 'string' ? result.content : '';
  const mc = /\bMC\s*(?:number|no\.?|#)?\s*[:#-]?\s*(\d{3,8})\b/i.exec(content)?.[1] ?? null;
  const dot = /\b(?:USDOT|DOT)\s*(?:number|no\.?|#)?\s*[:#-]?\s*(\d{3,9})\b/i.exec(content)?.[1] ?? null;
  const text = (name: string) => f[name]?.valueString ?? f[name]?.content ?? null;
  return {
    source_file: file,
    fields: {
      numero_fatura: text('InvoiceId'), numero_carga: null, carrier_name: text('VendorName'),
      mc_number: mc, dot_number: dot, data_carga: null,
      data_fatura: f.InvoiceDate?.valueDate ?? null, valor_total: f.InvoiceTotal?.valueCurrency?.amount ?? null,
      origem: null, destino: null, dados_bancarios: null,
    },
    confidence_scores: {
      numero_fatura: f.InvoiceId?.confidence ?? 0, carrier_name: f.VendorName?.confidence ?? 0,
      data_fatura: f.InvoiceDate?.confidence ?? 0, valor_total: f.InvoiceTotal?.confidence ?? 0,
      mc_number: mc ? 0.5 : 0, dot_number: dot ? 0.5 : 0, dados_bancarios: 0,
    },
    // Freight-specific fields and charges require a trained model or human review.
    accessorials: [], extraction_raw: { provider: 'azure', ...result },
  };
}

export class AzureInvoiceExtractor implements IExtractionProvider {
  constructor(private readonly request: typeof fetch = fetch, private readonly pause = delay) {}
  async extract(file: string): Promise<InvoiceExtractionResult> {
    const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    if (!endpoint || !key) throw new Error('Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.');
    const base = new URL(endpoint);
    if (base.protocol !== 'https:') throw new Error('Azure endpoint must use HTTPS.');
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error(`Not a PDF: ${file}`);
    const headers = { 'Ocp-Apim-Subscription-Key': key };
    const url = new URL('/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30', base);
    const response = await this.request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: bytes.toString('base64') }), signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (response.status !== 202) throw new Error(`Azure analysis failed (HTTP ${response.status}).`);
    const location = response.headers.get('operation-location');
    if (!location) throw new Error('Azure did not return an operation location.');
    const operation = new URL(location, base);
    if (operation.origin !== base.origin) throw new Error('Azure returned an unexpected operation host.');
    const deadline = Date.now() + 120_000;
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      await this.pause(1000);
      const poll = await this.request(operation, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!poll.ok) throw new Error(`Azure status request failed (HTTP ${poll.status}).`);
      const body = await poll.json() as { status?: string; analyzeResult?: Result };
      if (body.status === 'succeeded' && body.analyzeResult) return mapAzureInvoice(body.analyzeResult, file);
      if (body.status !== 'running' && body.status !== 'notStarted') throw new Error('Azure analysis failed or returned an invalid result.');
    }
    throw new Error('Azure analysis timed out; retry the document.');
  }
}
