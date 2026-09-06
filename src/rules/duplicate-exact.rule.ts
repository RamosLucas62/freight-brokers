import { carrierKey } from './carrier-key.js';
import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

export const duplicateExactRule: IRule = {
  name: 'DUPLICATE_EXACT',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    _ctx: AuditContext
  ): Promise<RuleException[]> {
    const byNumber = new Map<string, InvoiceRecord[]>();

    for (const inv of invoices) {
      const carrier = carrierKey(inv);
      const number = inv.numero_fatura.trim().toLowerCase();
      if (!carrier || !number) continue;
      const key = JSON.stringify([carrier, number]);
      const group = byNumber.get(key) ?? [];
      group.push(inv);
      byNumber.set(key, group);
    }

    const exceptions: RuleException[] = [];

    for (const [numero, group] of byNumber.entries()) {
      if (group.length > 1) {
        for (const inv of group) {
          exceptions.push({
            invoice_id:      inv.id,
            tipo_regra:      'DUPLICATE_EXACT',
            valor_envolvido: inv.valor_total,
            descricao:       `Invoice number "${inv.numero_fatura}" appears ${group.length} times`,
            source_file:     inv.source_file,
            source_page:     null,
            metadata:        {
              numero_fatura:  inv.numero_fatura.trim().toLowerCase(),
              duplicate_count: group.length,
              duplicate_ids:  group.map(i => i.id),
            },
          });
        }
      }
    }

    return exceptions;
  },
};
