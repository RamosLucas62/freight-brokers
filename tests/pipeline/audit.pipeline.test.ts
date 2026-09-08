import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAuditPipeline } from '../../src/pipeline/audit.pipeline.js';
import { StubExtractor } from '../../src/extraction/stub.extractor.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { InvoiceRecord } from '../../src/types/invoice.types.js';
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
