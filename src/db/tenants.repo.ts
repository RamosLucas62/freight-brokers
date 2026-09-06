import { z } from 'zod';
import { getSupabaseClient } from '../config/supabase.js';

export const TenantId = z.string().uuid();
export const AccountStatus = z.enum(['active', 'inactive', 'paused']);
export type AccountStatus = z.infer<typeof AccountStatus>;
export const AUDIT_DOMAIN = 'audit.aiolympian.com';
const Alias = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63);

export function parseAuditRecipient(address: string): string {
  const parts = address.trim().toLowerCase().split('@');
  if (parts.length !== 2 || parts[1] !== AUDIT_DOMAIN) throw new Error('Invalid audit recipient domain.');
  return Alias.parse(parts[0]);
}
export async function resolveAuditRecipient(address: string) {
  const alias = parseAuditRecipient(address);
  const { data, error } = await getSupabaseClient().from('audit_tenants').select('id,name,alias,status,is_test').eq('alias', alias).maybeSingle();
  if (error) throw new Error('Could not resolve audit recipient.');
  if (!data) throw new Error('Unknown audit recipient.');
  return data;
}
export async function assertTenantActive(tenantId: string) {
  TenantId.parse(tenantId);
  const { data, error } = await getSupabaseClient().from('audit_tenants').select('status').eq('id', tenantId).maybeSingle();
  if (error || !data) throw new Error('Audit account unavailable.');
  if (data.status !== 'active') throw new Error('Audit account is not active.');
}
// Backend administration only. Public requests must derive tenant identity from authenticated membership.
export async function createTenant(name: string, alias: string) {
  const { data, error } = await getSupabaseClient().from('audit_tenants').insert({
    name: z.string().trim().min(1).max(200).parse(name), alias: Alias.parse(alias), status: 'inactive',
  }).select('id,name,alias,status').single();
  if (error) throw new Error('Could not create account; alias may already be reserved.');
  return data;
}
export async function setTenantStatus(tenantId: string, status: AccountStatus) {
  const { data, error } = await getSupabaseClient().from('audit_tenants').update({ status: AccountStatus.parse(status) })
    .eq('id', TenantId.parse(tenantId)).select('id,status').single();
  if (error) throw new Error('Could not update account status.');
  return data;
}
export async function addReportContact(tenantId: string, email: string) {
  const { error } = await getSupabaseClient().from('audit_report_contacts').insert({
    tenant_id: TenantId.parse(tenantId), email: z.string().trim().email().toLowerCase().parse(email),
  });
  if (error) throw new Error('Could not add report contact.');
}
export async function listReportRecipients(tenantId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient().from('audit_report_contacts').select('email')
    .eq('tenant_id', TenantId.parse(tenantId)).eq('enabled', true).not('verified_at', 'is', null);
  if (error) throw new Error('Could not load report recipients.');
  return (data ?? []).map(row => row.email);
}
