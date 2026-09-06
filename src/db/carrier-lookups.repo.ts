import { getSupabaseClient } from '../config/supabase.js';
import type { CarrierLookupInput, CarrierLookupResult } from '../types/carrier.types.js';

export async function findFreshLookup(
  input: CarrierLookupInput,
  ttlHours: number
): Promise<CarrierLookupResult | null> {
  const client = getSupabaseClient();

  const cutoff = new Date(Date.now() - ttlHours * 3_600_000).toISOString();

  let query = client
    .from('carrier_lookups')
    .select('*')
    .eq('provider', 'fmcsa')
    .gt('checked_at', cutoff)
    .order('checked_at', { ascending: false })
    .limit(1);

  if (input.mc) {
    query = query.eq('mc_number', input.mc);
  } else if (input.dot) {
    query = query.eq('dot_number', input.dot);
  } else {
    return null;
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to query carrier_lookups: ${error.message}`);
  if (!data || data.length === 0) return null;

  const row = data[0];
  return {
    dot:               row.dot_number,
    mc:                row.mc_number,
    legal_name:        row.legal_name,
    authority_status:  row.authority_status as 'ACTIVE' | 'INACTIVE' | 'REVOKED',
    broker_authority:  row.broker_authority,
    carrier_authority: row.carrier_authority,
    checked_at:        row.checked_at,
  };
}

export async function insertLookup(result: CarrierLookupResult): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client.from('carrier_lookups').insert({
    provider:          'fmcsa',
    dot_number:        result.dot,
    mc_number:         result.mc,
    legal_name:        result.legal_name,
    authority_status:  result.authority_status,
    broker_authority:  result.broker_authority,
    carrier_authority: result.carrier_authority,
    raw_response:      null,
    checked_at:        result.checked_at,
  });

  if (error) throw new Error(`Failed to insert carrier lookup: ${error.message}`);
}
