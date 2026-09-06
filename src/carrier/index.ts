import { FmcsaCarrierProvider } from './fmcsa.carrier.js';
import type { CarrierLookupInput, CarrierLookupResult, AuditContext, ICarrierLookupProvider } from '../types/carrier.types.js';
import { StubCarrierProvider } from './stub.carrier.js';
import { cachedCarrierLookup } from './cache.js';

function createProvider(): ICarrierLookupProvider {
  const provider = process.env.CARRIER_PROVIDER ?? 'stub';

  switch (provider) {
    case 'stub':
      return new StubCarrierProvider();
    case 'fmcsa':
      return new FmcsaCarrierProvider();
    default:
      throw new Error(`Unknown CARRIER_PROVIDER: "${provider}". Supported: stub, fmcsa`);
  }
}

const provider: ICarrierLookupProvider = createProvider();

/**
 * Public getCarrier function — transparent caching, injectable provider.
 * Matches the GetCarrierFn signature used by rules.
 */
export async function getCarrier(
  input: CarrierLookupInput,
  ctx: AuditContext
): Promise<CarrierLookupResult> {
  // Simulated data must never contaminate the persistent FMCSA cache.
  if (provider instanceof StubCarrierProvider) return provider.lookup(input, ctx);
  return cachedCarrierLookup(input, ctx, provider);
}

export type { ICarrierLookupProvider };
