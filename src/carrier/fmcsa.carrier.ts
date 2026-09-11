import type { ICarrierLookupProvider, CarrierLookupInput, CarrierLookupResult, AuditContext } from '../types/carrier.types.js';
import {readResponseBody} from '../security/http.js';

export function mapFmcsaResponse(data: unknown, input: CarrierLookupInput): CarrierLookupResult {
  const content = (data as { content?: unknown })?.content;
  const entries = Array.isArray(content) ? content : content ? [content] : [];
  const unverifiable=(reason:NonNullable<CarrierLookupResult['verification_reason']>):CarrierLookupResult=>({
    dot:input.dot??null,mc:input.mc??null,legal_name:null,authority_status:'UNVERIFIABLE',
    broker_authority:false,carrier_authority:false,checked_at:new Date().toISOString(),verification_reason:reason,
  });
  if (entries.length !== 1) return unverifiable('NO_UNIQUE_CARRIER');
  const carrier = (entries[0] as { carrier?: Record<string, unknown> }).carrier;
  if (!carrier || !carrier.dotNumber || typeof carrier.legalName !== 'string') return unverifiable('INVALID_RESPONSE');
  if (input.dot && String(carrier.dotNumber) !== input.dot) return unverifiable('IDENTIFIER_MISMATCH');
  const validAuthorityCode=(code:unknown):code is string=>typeof code==='string'&&['A','I','N'].includes(code);
  const carrierCodes=[carrier.commonAuthorityStatus,carrier.contractAuthorityStatus];
  // Broker authority is independent from motor-carrier authority and is often
  // absent from otherwise valid carrier records.
  if (carrierCodes.some(code=>!validAuthorityCode(code))) {
    return unverifiable('AUTHORITY_UNAVAILABLE');
  }
  const carrierAuthority = carrierCodes.some(code=>code==='A');
  return {
    dot: String(carrier.dotNumber), mc: input.mc ?? null, legal_name: carrier.legalName,
    authority_status: carrierAuthority ? 'ACTIVE' : 'INACTIVE',
    broker_authority: carrier.brokerAuthorityStatus === 'A', carrier_authority: carrierAuthority, checked_at: new Date().toISOString(),
  };
}

export class FmcsaCarrierProvider implements ICarrierLookupProvider {
  constructor(private readonly request: typeof fetch = fetch) {}
  async lookup(input: CarrierLookupInput, _ctx: AuditContext): Promise<CarrierLookupResult> {
    const key = process.env.FMCSA_API_KEY;
    if (!key) throw new Error('FMCSA_API_KEY is required for live lookups.');
    const identifier = input.dot ?? input.mc;
    if (!identifier || !/^\d+$/.test(identifier)) throw new Error('A numeric MC or DOT identifier is required.');
    const base = process.env.FMCSA_BASE_URL ?? 'https://mobile.fmcsa.dot.gov/qc/services';
    const path = input.dot ? `/carriers/${identifier}` : `/carriers/docket-number/${identifier}`;
    const url = new URL(base.replace(/\/$/, '') + path);
    if (url.protocol !== 'https:') throw new Error('FMCSA endpoint must use HTTPS.');
    url.searchParams.set('webKey', key);
    let response: Response;
    try {
      response = await this.request(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    } catch { throw new Error('FMCSA request failed or timed out.'); }
    if (!response.ok) throw new Error(`FMCSA lookup failed (HTTP ${response.status}).`);
    try{return mapFmcsaResponse(JSON.parse((await readResponseBody(response,2*1024*1024)).toString('utf8')), input);}
    catch{throw new Error('FMCSA returned an invalid response.');}
  }
}
