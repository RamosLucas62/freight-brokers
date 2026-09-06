import type { CarrierLookupInput, CarrierLookupResult, AuditContext, ICarrierLookupProvider } from '../types/carrier.types.js';
import { findFreshLookup, insertLookup } from '../db/carrier-lookups.repo.js';

function cacheKey(input: CarrierLookupInput): string {
  if (input.mc)  return `mc:${input.mc}`;
  if (input.dot) return `dot:${input.dot}`;
  throw new Error('CarrierLookupInput must have at least mc or dot');
}

/**
 * Carrier lookup with three-tier caching:
 * 1. In-memory (ctx.carrierCache) — zero I/O
 * 2. DB (carrier_lookups, TTL-based)
 * 3. Provider (stub or FMCSA) — persisted to DB + memory on miss
 */
export async function cachedCarrierLookup(
  input: CarrierLookupInput,
  ctx: AuditContext,
  provider: ICarrierLookupProvider
): Promise<CarrierLookupResult> {
  const key = cacheKey(input);

  // 1. In-memory hit
  const memHit = ctx.carrierCache.get(key);
  if (memHit && Date.now() - new Date(memHit.checked_at).getTime() < ctx.cacheTtlHours * 3_600_000) return memHit;

  // 2. DB hit (fresh within TTL)
  const dbHit = await findFreshLookup(input, ctx.cacheTtlHours);
  if (dbHit) {
    ctx.carrierCache.set(key, dbHit);
    return dbHit;
  }

  // 3. Provider call
  const result = await provider.lookup(input, ctx);
  await insertLookup(result);
  ctx.carrierCache.set(key, result);
  return result;
}
