import type { InvoiceRecord } from '../types/invoice.types.js';
import type { RuleException } from '../types/rule.types.js';
import type { AuditContext } from '../types/carrier.types.js';
import type { AuditReport, ReportException } from '../types/report.types.js';

const RULE_LABELS: Record<string, string> = {
  LOW_CONFIDENCE:     'Low Extraction Confidence',
  DUPLICATE_EXACT:    'Exact Duplicate Invoice',
  DUPLICATE_PROBABLE: 'Probable Duplicate Invoice',
  BANKING_CHANGE:     'Banking Information Changed',
  MC_DIVERGENCE:      'MC# Name Mismatch (FMCSA)',
  AUTHORITY_INACTIVE: 'Carrier Authority Inactive',
};

export function buildReport(
  invoices: InvoiceRecord[],
  exceptions: RuleException[],
  ctx: AuditContext
): AuditReport {
  const invoiceIdsWithExceptions = new Set(exceptions.map(e => e.invoice_id));

  const valor_total_under_review = invoices
    .filter(inv => invoiceIdsWithExceptions.has(inv.id))
    .reduce((sum, inv) => sum + (inv.valor_total ?? 0), 0);

  const reportExceptions: ReportException[] = exceptions.map(ex => ({
    invoice_id:      ex.invoice_id,
    tipo_regra:      ex.tipo_regra,
    rule_label:      RULE_LABELS[ex.tipo_regra] ?? ex.tipo_regra,
    valor_envolvido: ex.valor_envolvido,
    descricao:       ex.descricao,
    source_reference: {
      file: ex.source_file,
      page: ex.source_page,
    },
    metadata: ex.metadata,
  }));

  return {
    run_id:                   ctx.run_id,
    generated_at:             new Date().toISOString(),
    total_invoices_processed: invoices.length,
    total_exceptions:         exceptions.length,
    valor_total_under_review,
    exceptions:               reportExceptions,
  };
}
