import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cachedCarrierLookup } from '../../src/carrier/cache.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext, ICarrierLookupProvider, CarrierLookupInput, CarrierLookupResult } from '../../src/types/carrier.types.js';

// Mock the DB repo functions
vi.mock('../../src/db/carrier-lookups.repo.js', () => ({
  findFreshLookup: vi.fn(),
  insertLookup:    vi.fn(),
}));

import { findFreshLookup, insertLookup } from '../../src/db/carrier-lookups.repo.js';

function makeCtx(): AuditContext {
  return {
    run_id:       'test-run',
    carrierCache: new Map(),
    cacheTtlHours: 4,
  };
}

function makeProvider(result: Partial<CarrierLookupResult> = {}): ICarrierLookupProvider {
  return {
    lookup: vi.fn().mockResolvedValue(makeCarrierResult(result)),
  };
}

describe('cachedCarrierLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns from in-memory cache on second call (no DB or provider hit)', async () => {
    const ctx = makeCtx();
    const provider = makeProvider();
    vi.mocked(findFreshLookup).mockResolvedValue(null);
    vi.mocked(insertLookup).mockResolvedValue();

    const first  = await cachedCarrierLookup({ mc: '123456' }, ctx, provider);
    const second = await cachedCarrierLookup({ mc: '123456' }, ctx, provider);

    expect(first).toEqual(second);
    // Provider should only have been called once
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    // DB insert only once
    expect(insertLookup).toHaveBeenCalledTimes(1);
  });

  it('returns from DB cache when findFreshLookup returns a result', async () => {
    const ctx = makeCtx();
    const provider = makeProvider();
    const dbResult = makeCarrierResult({ legal_name: 'DB CACHED LLC' });
    vi.mocked(findFreshLookup).mockResolvedValue(dbResult);

    const result = await cachedCarrierLookup({ mc: '123456' }, ctx, provider);

    expect(result.legal_name).toBe('DB CACHED LLC');
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(insertLookup).not.toHaveBeenCalled();
  });

  it('calls provider and persists when DB miss (findFreshLookup returns null)', async () => {
    const ctx = makeCtx();
    const provider = makeProvider({ legal_name: 'PROVIDER FRESH LLC' });
    vi.mocked(findFreshLookup).mockResolvedValue(null);
    vi.mocked(insertLookup).mockResolvedValue();

    const result = await cachedCarrierLookup({ mc: '999999' }, ctx, provider);

    expect(result.legal_name).toBe('PROVIDER FRESH LLC');
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    expect(insertLookup).toHaveBeenCalledTimes(1);
  });

  it('stores result in ctx.carrierCache after DB miss', async () => {
    const ctx = makeCtx();
    const provider = makeProvider();
    vi.mocked(findFreshLookup).mockResolvedValue(null);
    vi.mocked(insertLookup).mockResolvedValue();

    await cachedCarrierLookup({ mc: '777777' }, ctx, provider);

    expect(ctx.carrierCache.has('mc:777777')).toBe(true);
  });

  it('stores result in ctx.carrierCache after DB hit', async () => {
    const ctx = makeCtx();
    const provider = makeProvider();
    const dbResult = makeCarrierResult();
    vi.mocked(findFreshLookup).mockResolvedValue(dbResult);

    await cachedCarrierLookup({ mc: '888888' }, ctx, provider);

    expect(ctx.carrierCache.has('mc:888888')).toBe(true);
  });
});
