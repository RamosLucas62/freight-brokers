import type { ICarrierLookupProvider, CarrierLookupInput, CarrierLookupResult, AuditContext } from '../types/carrier.types.js';

export class StubCarrierProvider implements ICarrierLookupProvider {
  constructor(private readonly overrides: Partial<CarrierLookupResult> = {}) {}

  async lookup(input: CarrierLookupInput, _ctx: AuditContext): Promise<CarrierLookupResult> {
    return {
      dot:               input.dot ?? null,
      mc:                input.mc  ?? null,
      legal_name:        'SWIFT TRANSPORT LLC',
      authority_status:  'ACTIVE',
      broker_authority:  false,
      carrier_authority: true,
      checked_at:        new Date().toISOString(),
      ...this.overrides,
    };
  }
}
