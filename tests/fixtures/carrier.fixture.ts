import type { CarrierLookupResult } from '../../src/types/carrier.types.js';

export function makeCarrierResult(overrides: Partial<CarrierLookupResult> = {}): CarrierLookupResult {
  return {
    dot:               '9876543',
    mc:                '123456',
    legal_name:        'SWIFT TRANSPORT LLC',
    authority_status:  'ACTIVE',
    broker_authority:  false,
    carrier_authority: true,
    checked_at:        new Date().toISOString(),
    ...overrides,
  };
}
