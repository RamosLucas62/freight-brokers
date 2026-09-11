import { describe, it, expect, vi, afterEach } from 'vitest';
import { FmcsaCarrierProvider, mapFmcsaResponse } from '../../src/carrier/fmcsa.carrier.js';
const carrier = { dotNumber: 123456, legalName: 'Acme', commonAuthorityStatus: 'A', contractAuthorityStatus: 'N', brokerAuthorityStatus: 'N' };
const ctx = { run_id: 'test', carrierCache: new Map(), cacheTtlHours: 4 };
afterEach(() => vi.unstubAllEnvs());
describe('FMCSA adapter', () => {
  it('maps active carrier authority', () => expect(mapFmcsaResponse({ content: { carrier } }, { dot: '123456' }).authority_status).toBe('ACTIVE'));
  it('does not infer active status from missing authority fields', () => expect(mapFmcsaResponse({ content: { carrier: { dotNumber: 123456, legalName: 'Acme' } } }, {}).authority_status).toBe('UNVERIFIABLE'));
  it('maps carrier authority even when independent broker authority is absent',()=>expect(mapFmcsaResponse({content:{carrier:{dotNumber:123456,legalName:'Acme',commonAuthorityStatus:'I',contractAuthorityStatus:'N'}}},{dot:'123456'})).toMatchObject({authority_status:'INACTIVE',carrier_authority:false,broker_authority:false}));
  it('turns an ambiguous carrier response into reviewable evidence', () => expect(mapFmcsaResponse({ content: [{ carrier }, { carrier }] }, {mc:'777777'})).toMatchObject({authority_status:'UNVERIFIABLE',verification_reason:'NO_UNIQUE_CARRIER',mc:'777777'}));
  it('uses the documented MC endpoint', async () => {
    vi.stubEnv('FMCSA_API_KEY', 'test');
    const request = vi.fn().mockResolvedValue(Response.json({ content: [{ carrier }] }));
    await new FmcsaCarrierProvider(request).lookup({ mc: '777777' }, ctx);
    expect(String(request.mock.calls[0][0])).toContain('/carriers/docket-number/777777?');
  });
  it('does not turn service failure into an inactive-carrier alert', async () => {
    vi.stubEnv('FMCSA_API_KEY', 'test');
    await expect(new FmcsaCarrierProvider(vi.fn().mockResolvedValue(new Response(null, { status: 503 }))).lookup({ mc: '777777' }, ctx)).rejects.toThrow('HTTP 503');
  });
});
