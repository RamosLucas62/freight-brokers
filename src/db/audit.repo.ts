import { TenantId, assertTenantActive } from './tenants.repo.js';
import { getSupabaseClient } from '../config/supabase.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { RuleException } from '../types/rule.types.js';
import type { AuditReport } from '../types/report.types.js';

export interface AuditStore {
  assertActive(): Promise<void>;
  history(): Promise<InvoiceRecord[]>;
  commit(invoices: InvoiceRecord[], exceptions: RuleException[], report: AuditReport, historyIds: string[]): Promise<void>;
}
export function createAuditStore(tenantId: string): AuditStore {
  TenantId.parse(tenantId);
  return {
  assertActive: () => assertTenantActive(tenantId),
  async history() {
    const rows: InvoiceRecord[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await getSupabaseClient().from('invoices').select('*').eq('tenant_id', tenantId).order('id').range(from, from + 999);
      if (error) throw new Error(`Failed to load invoice history: ${error.message}`);
      rows.push(...(data ?? []) as InvoiceRecord[]);
      if (!data || data.length < 1000) return rows;
    }
  },
  async commit(invoices, exceptions, report, historyIds) {
    if (invoices.some(i => i.tenant_id !== tenantId) || report.tenant_id !== tenantId) throw new Error('Cross-account audit rejected.');
    const { error } = await getSupabaseClient().rpc('commit_audit', {
      p_tenant_id: tenantId, p_invoices: invoices, p_exceptions: exceptions, p_report: report, p_history_ids: historyIds,
    });
    if (error) throw new Error(`Audit was not saved: ${error.message}`);
  },
};

}
