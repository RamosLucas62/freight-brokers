import { carrierKey } from './carrier-key.js';
import { createHash } from 'node:crypto';
import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord, DadosBancarios } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

function bankingKey(d: DadosBancarios | null): string {
  if (!d) return '__no_banking__';
  return [
    d.bank_name      ?? '',
    d.account_number ?? '',
    d.routing_number ?? '',
    d.account_type   ?? '',
    d.payee_name     ?? '',
  ].map(v => v.trim().toLowerCase()).join('|');
}

export const bankingChangeRule: IRule = {
  name: 'BANKING_CHANGE',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    _ctx: AuditContext
  ): Promise<RuleException[]> {
    // Group invoices by carrier_name
    const byCarrier = new Map<string, InvoiceRecord[]>();

    for (const inv of invoices) {
      const key = carrierKey(inv);
      if (!key || !inv.dados_bancarios?.account_number?.trim() || !inv.dados_bancarios?.routing_number?.trim()) continue;
      const group = byCarrier.get(key) ?? [];
      group.push(inv);
      byCarrier.set(key, group);
    }

    const exceptions: RuleException[] = [];

    for (const [carrier, group] of byCarrier.entries()) {
      if (group.length < 2) continue;

      // Find all distinct banking fingerprints
      const fingerprintMap = new Map<string, InvoiceRecord>();
      for (const inv of group) {
        const fp = bankingKey(inv.dados_bancarios);
        fingerprintMap.set(fp, inv);
      }

      if (fingerprintMap.size <= 1) continue;

      // Multiple distinct banking details for same carrier
      for (const inv of group) {
        const fp = bankingKey(inv.dados_bancarios);
        exceptions.push({
          invoice_id:      inv.id,
          tipo_regra:      'BANKING_CHANGE',
          valor_envolvido: inv.valor_total,
          descricao:       `Banking details changed for carrier "${carrier}" — ${fingerprintMap.size} distinct accounts detected`,
          source_file:     inv.source_file,
          source_page:     null,
          metadata:        {
            carrier_name:         carrier,
            distinct_bank_accounts: fingerprintMap.size,
            this_fingerprint:     createHash('sha256').update(fp).digest('hex'),
          },
        });
      }
    }

    return exceptions;
  },
};
