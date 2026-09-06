import { describe, it, expect } from 'vitest';
import { StubCarrierProvider } from '../../src/carrier/stub.carrier.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

describe('StubCarrierProvider', () => {
  it('returns a CarrierLookupResult with ACTIVE status', async () => {
    const provider = new StubCarrierProvider();
    const result = await provider.lookup({ mc: '123456' }, ctx);
    expect(result.authority_status).toBe('ACTIVE');
    expect(result.carrier_authority).toBe(true);
  });

  it('echoes mc input', async () => {
    const provider = new StubCarrierProvider();
    const result = await provider.lookup({ mc: '654321' }, ctx);
    expect(result.mc).toBe('654321');
  });

  it('echoes dot input', async () => {
    const provider = new StubCarrierProvider();
    const result = await provider.lookup({ dot: '1234567' }, ctx);
    expect(result.dot).toBe('1234567');
  });

  it('returns a valid ISO 8601 checked_at timestamp', async () => {
    const provider = new StubCarrierProvider();
    const result = await provider.lookup({ mc: '123456' }, ctx);
    expect(() => new Date(result.checked_at)).not.toThrow();
    expect(new Date(result.checked_at).toISOString()).toBe(result.checked_at);
  });

  it('accepts overrides for authority_status', async () => {
    const provider = new StubCarrierProvider({ authority_status: 'INACTIVE' });
    const result = await provider.lookup({ mc: '123456' }, ctx);
    expect(result.authority_status).toBe('INACTIVE');
  });

  it('accepts overrides for legal_name', async () => {
    const provider = new StubCarrierProvider({ legal_name: 'CUSTOM TRUCKING LLC' });
    const result = await provider.lookup({ mc: '123456' }, ctx);
    expect(result.legal_name).toBe('CUSTOM TRUCKING LLC');
  });
});
