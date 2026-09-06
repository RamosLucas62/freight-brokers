import type { IRule, RuleException } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';
import type { GetCarrierFn } from '../types/rule.types.js';
import { CRITICAL_FIELDS } from '../types/invoice.types.js';



export const lowConfidenceRule: IRule = {
  name: 'LOW_CONFIDENCE',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    _ctx: AuditContext
  ): Promise<RuleException[]> {
    const THRESHOLD = Number(process.env.LOW_CONFIDENCE_THRESHOLD ?? '0.85');
    if (!Number.isFinite(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1) throw new Error('LOW_CONFIDENCE_THRESHOLD must be between 0 and 1');
    const exceptions: RuleException[] = [];

    for (const inv of invoices) {
      const lowFields: string[] = [];

      for (const field of CRITICAL_FIELDS) {
        const score = inv.confidence_scores[field];
        const value = inv[field];
        const missing = value == null || (typeof value === 'string' && !value.trim()) ||
          (field === 'dados_bancarios' && (!inv.dados_bancarios?.account_number?.trim() || !inv.dados_bancarios?.routing_number?.trim()));
        if (missing || score == null || !Number.isFinite(score) || score < 0 || score > 1) {
          lowFields.push(`${field}=missing_or_invalid`);
        } else if (score < THRESHOLD) {
          lowFields.push(`${field}=${score.toFixed(2)}`);
        }
      }

      for (const field of ['data_carga', 'data_fatura']) {
        if (inv.confidence_scores[field] === 0) lowFields.push(`${field}=invalid_date`);
      }

      if (lowFields.length > 0) {
        exceptions.push({
          invoice_id:      inv.id,
          tipo_regra:      'LOW_CONFIDENCE',
          valor_envolvido: inv.valor_total,
          descricao:       `Low confidence on critical fields: ${lowFields.join(', ')}`,
          source_file:     inv.source_file,
          source_page:     null,
          metadata:        { low_fields: lowFields, threshold: THRESHOLD },
        });
      }
    }

    return exceptions;
  },
};
