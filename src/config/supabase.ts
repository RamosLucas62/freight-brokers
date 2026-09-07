import { createClient, SupabaseClient } from '@supabase/supabase-js';
export const timedFetch:typeof fetch=(input,init={})=>fetch(input,{...init,signal:init.signal??AbortSignal.timeout(10000)});

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables');
  }

  _client = createClient(url, key,{global:{fetch:timedFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return _client;
}
