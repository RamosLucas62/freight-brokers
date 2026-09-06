import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export const duplicateProbableRule: IRule = {
  name: 'DUPLICATE_PROBABLE',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    _ctx: AuditContext
  ): Promise<RuleException[]> {
    const exceptions: RuleException[] = [];
    const flagged = new Set<string>();

    for (let i = 0; i < invoices.length; i++) {
      for (let j = i + 1; j < invoices.length; j++) {
        const a = invoices[i];
        const b = invoices[j];

        // Different invoice numbers (exact duplicates handled by other rule)
        if (a.numero_fatura.trim().toLowerCase() === b.numero_fatura.trim().toLowerCase()) continue;

        // Same carrier
        if (!a.carrier_name || !b.carrier_name) continue;
        if (a.carrier_name.toUpperCase() !== b.carrier_name.toUpperCase()) continue;

        // Same valor_total
        if (a.valor_total == null || b.valor_total == null) continue;
        if (a.valor_total !== b.valor_total) continue;

        // data_fatura within 7 days
        if (!a.data_fatura || !b.data_fatura) continue;
        const dateA = new Date(a.data_fatura).getTime();
        const dateB = new Date(b.data_fatura).getTime();
        if (isNaN(dateA) || isNaN(dateB)) continue;
        if (Math.abs(dateA - dateB) > WINDOW_DAYS * MS_PER_DAY) continue;

        // Flag both
        const pairKey = [a.id, b.id].sort().join('|');
        if (flagged.has(pairKey)) continue;
        flagged.add(pairKey);

        for (const inv of [a, b]) {
          exceptions.push({
            invoice_id:      inv.id,
            tipo_regra:      'DUPLICATE_PROBABLE',
            valor_envolvido: inv.valor_total,
            descricao:       `Probable duplicate: same carrier "${inv.carrier_name}", amount $${inv.valor_total}, within ${WINDOW_DAYS} days`,
            source_file:     inv.source_file,
            source_page:     null,
            metadata:        {
              carrier_name:    inv.carrier_name,
              valor_total:     inv.valor_total,
              partner_invoice: inv.id === a.id ? b.id : a.id,
              partner_numero:  inv.id === a.id ? b.numero_fatura : a.numero_fatura,
              date_diff_days:  Math.abs(dateA - dateB) / MS_PER_DAY,
            },
          });
        }
      }
    }

    return exceptions;
  },
};
