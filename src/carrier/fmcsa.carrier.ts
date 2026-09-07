import type { ICarrierLookupProvider, CarrierLookupInput, CarrierLookupResult, AuditContext } from '../types/carrier.types.js';
import {readResponseBody} from '../security/http.js';

export function mapFmcsaResponse(data: unknown, input: CarrierLookupInput): CarrierLookupResult {
  const content = (data as { content?: unknown })?.content;
  const entries = Array.isArray(content) ? content : content ? [content] : [];
  if (entries.length !== 1) throw new Error('FMCSA lookup returned no unique carrier; manual verification required.');
  const carrier = (entries[0] as { carrier?: Record<string, unknown> }).carrier;
  if (!carrier || !carrier.dotNumber || typeof carrier.legalName !== 'string') throw new Error('Invalid FMCSA carrier response.');
  if (input.dot && String(carrier.dotNumber) !== input.dot) throw new Error('FMCSA returned a different DOT number.');
  const codes = [carrier.commonAuthorityStatus, carrier.contractAuthorityStatus, carrier.brokerAuthorityStatus];
  if (codes.some(code => typeof code !== 'string' || !['A', 'I', 'N'].includes(code))) {
    throw new Error('FMCSA authority fields unavailable or unrecognized; no status inferred.');
  }
  const carrierAuthority = codes[0] === 'A' || codes[1] === 'A';
  return {
    dot: String(carrier.dotNumber), mc: input.mc ?? null, legal_name: carrier.legalName,
    authority_status: carrierAuthority ? 'ACTIVE' : 'INACTIVE',
    broker_authority: codes[2] === 'A', carrier_authority: carrierAuthority, checked_at: new Date().toISOString(),
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
    return mapFmcsaResponse(JSON.parse((await readResponseBody(response,2*1024*1024)).toString('utf8')), input);
  }
}
