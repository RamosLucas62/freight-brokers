import { createClient, SupabaseClient } from '@supabase/supabase-js';
export const timedFetch:typeof fetch=(input,init={})=>fetch(input,{...init,signal:init.signal??AbortSignal.timeout(10000)});

export function operationalDatabaseError(code:string,source:unknown):Error{
  const detail=typeof source==='object'&&source!==null?source as {code?:unknown;message?:unknown}:{};
  const message=typeof detail.message==='string'?detail.message.toLowerCase():'';
  const providerReason=/(timeout|timed out|abort)/.test(message)
    ?'SUPABASE_TIMEOUT'
    :/(fetch|network|dns|connect|socket)/.test(message)?'SUPABASE_NETWORK_ERROR':'SUPABASE_QUERY_ERROR';
  return Object.assign(new Error(code),{
    providerReason,
    ...(typeof detail.code==='string'&&/^[A-Za-z0-9_-]{2,40}$/.test(detail.code)?{providerCode:detail.code}:{}),
  });
}

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
