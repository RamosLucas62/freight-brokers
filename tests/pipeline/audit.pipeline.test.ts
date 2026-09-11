import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAuditPipeline } from '../../src/pipeline/audit.pipeline.js';
import { StubExtractor } from '../../src/extraction/stub.extractor.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { InvoiceRecord } from '../../src/types/invoice.types.js';
import type { PodExtractionResult, PodField } from '../../src/pod/types.js';
import type { RateConfirmationExtractionResult } from '../../src/rate-confirmation/types.js';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'freight-test-')); await writeFile(join(dir, 'a.pdf'), '%PDF-1.4 test'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
function options(history: InvoiceRecord[] = []) {
  return { tenantId: '00000000-0000-4000-8000-000000000001', filePaths: [join(dir, 'a.pdf')], ctx: { run_id: 'test', carrierCache: new Map(), cacheTtlHours: 4 },
    extractor: new StubExtractor(), getCarrier: async () => makeCarrierResult(),
    store: { assertActive: vi.fn(async () => {}), history: async () => history.map(i => ({...i, tenant_id: i.tenant_id ?? '00000000-0000-4000-8000-000000000001'})), commit: vi.fn(async () => {}) } };
}
describe('audit transaction boundary', () => {
  it('compares new invoices to history but only reports new ones', async () => {
    const opts = options([makeInvoice()]);
    const report = await runAuditPipeline(opts);
    expect(report.total_invoices_processed).toBe(1);
    expect(report.exceptions.filter(e => e.tipo_regra === 'DUPLICATE_EXACT')).toHaveLength(1);
    expect(opts.store.commit).toHaveBeenCalledTimes(1);
  });
  it('skips identical content across filenames and retries', async () => {
    const opts = options();
    await writeFile(join(dir, 'copy.pdf'), '%PDF-1.4 test');
    opts.filePaths.push(join(dir, 'copy.pdf'));
    let saved: InvoiceRecord[] = [];
    opts.store.commit = vi.fn(async (invoices?: InvoiceRecord[]) => { saved = invoices!; });
    const first = await runAuditPipeline(opts);
    expect(first.total_invoices_processed).toBe(1);
    const retry = options(saved);
    const report = await runAuditPipeline(retry);
    expect(report.total_invoices_processed).toBe(0);
    expect(retry.store.commit).not.toHaveBeenCalled();
  });
  it('does not save any invoice when carrier lookup fails', async () => {
    const opts = options(); opts.getCarrier = async () => { throw new Error('offline'); };
    await expect(runAuditPipeline(opts)).rejects.toThrow('offline');
    expect(opts.store.commit).not.toHaveBeenCalled();
  });
  it('completes with a carrier verification alert when FMCSA cannot identify one carrier',async()=>{
    const opts=options();opts.getCarrier=async input=>({dot:input.dot??null,mc:input.mc??null,legal_name:null,authority_status:'UNVERIFIABLE',
      broker_authority:false,carrier_authority:false,checked_at:new Date().toISOString(),verification_reason:'NO_UNIQUE_CARRIER'});
    const report=await runAuditPipeline(opts);
    expect(report.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({tipo_regra:'CARRIER_VERIFICATION_REQUIRED'})]));
    expect(opts.store.commit).toHaveBeenCalledOnce();
  });
  it('does not save a partial batch when a later file is missing', async () => {
    const opts = options(); opts.filePaths.push(join(dir, 'missing.pdf'));
    await expect(runAuditPipeline(opts)).rejects.toThrow();
    expect(opts.store.commit).not.toHaveBeenCalled();
  });
  it('rejects non-PDF content', async () => {
    await writeFile(join(dir, 'a.pdf'), 'not PDF');
    await expect(runAuditPipeline(options())).rejects.toThrow('Not a PDF');
  });
  it('excludes invoices older than the free-audit window before evaluating rules', async () => {
    const opts=options();opts.minimumInvoiceDate='2026-08-08';
    const report=await runAuditPipeline(opts);
    expect(report.total_invoices_processed).toBe(0);expect(report.skipped_files).toEqual([join(dir,'a.pdf')]);expect(opts.store.commit).not.toHaveBeenCalled();
  });
  it('propagates atomic commit failure instead of reporting success', async () => {
    const opts = options(); opts.store.commit = vi.fn(async () => { throw new Error('history changed'); });
    await expect(runAuditPipeline(opts)).rejects.toThrow('history changed');
  });
  it('persists supporting-document reconciliation in the audit report', async () => {
    const field = <T>(value: T): PodField<T> => ({
      value,
      confidence: 0.99,
      evidence: { page: 1, text: String(value), bounding_box: null },
    });
    const pod: PodExtractionResult = {
      source_file: 'POD_LOAD-9876.pdf',
      source_kind: 'ocr',
      fields: {
        load_number: field('LOAD-9876'), bol_number: field('BOL-1'), delivery_date: field('2024-01-16'),
        delivery_time: field('12:00'), receiver_name: field('Receiver'), delivery_location: field('Dallas, TX'),
        signature_present: field(true), damage_or_shortage_noted: field(false), exception_notes: field('No exceptions'),
      },
      quality: { score: 1, rotation_degrees: 0, perspective_distortion: false, blur: false, glare_or_shadow: false, cropped: false, reasons: [] },
      requires_human_review: false,
      raw: {},
    };
    const rate: RateConfirmationExtractionResult = {
      source_file: 'RATE_LOAD-9876.pdf',
      fields: {
        load_number: field('LOAD-9876'), bol_number: field('BOL-1'), carrier_name: field('SWIFT TRANSPORT LLC'),
        origin: field('Chicago, IL'), destination: field('Dallas, TX'), linehaul_amount: field(2000),
        total_amount: field(2600),
        accessorials: [{ type: 'FUEL_SURCHARGE', description: 'Fuel surcharge', amount: 500, confidence: 0.99, evidence: field(500).evidence }],
      },
      requires_human_review: false,
      raw: {},
    };
    const opts = { ...options(), pods: [pod], rateConfirmations: [rate], reconcileSupportingDocuments: true };
    const report = await runAuditPipeline(opts);
    expect(report.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ tipo_regra: 'RATE_CONFIRMATION_MISMATCH' })]));
    expect(report.reconciliation).toMatchObject({ divergent: 1, supporting_documents: 2 });
    expect((opts.store.commit.mock.calls as any)[0][1]).toEqual(expect.arrayContaining([expect.objectContaining({ tipo_regra: 'RATE_CONFIRMATION_MISMATCH' })]));
    expect((opts.store.commit.mock.calls as any)[0][2].reconciliation).toMatchObject({ divergent: 1, supporting_documents: 2 });
  });
});

describe('tenant isolation', () => {
  it('rejects foreign history before calling extraction or saving', async () => {
    const opts=options([makeInvoice({tenant_id:'00000000-0000-4000-8000-000000000099'})]);
    const extract=vi.spyOn(opts.extractor,'extract');
    await expect(runAuditPipeline(opts)).rejects.toThrow('Cross-account history');
    expect(extract).not.toHaveBeenCalled();expect(opts.store.commit).not.toHaveBeenCalled();
  });
  it('blocks paused accounts before extraction', async () => {
    const opts=options();opts.store.assertActive=vi.fn(async()=>{throw new Error('not active');});
    const extract=vi.spyOn(opts.extractor,'extract');
    await expect(runAuditPipeline(opts)).rejects.toThrow('not active');expect(extract).not.toHaveBeenCalled();
  });
  it('checks status again before persistence', async () => {
    const opts=options();opts.store.assertActive=vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('paused'));
    await expect(runAuditPipeline(opts)).rejects.toThrow('paused');expect(opts.store.commit).not.toHaveBeenCalled();
  });
  it('attaches account identity to saved invoice and report', async () => {
    const opts=options();const report=await runAuditPipeline(opts);
    expect(report.tenant_id).toBe(opts.tenantId);
    expect((opts.store.commit.mock.calls as any)[0][0][0].tenant_id).toBe(opts.tenantId);
  });
});
