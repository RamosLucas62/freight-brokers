import type { InvoiceRecord } from './invoice.types.js';
import type { AuditContext, CarrierLookupResult } from './carrier.types.js';

export type RuleName =
  | 'LOW_CONFIDENCE'
  | 'DUPLICATE_EXACT'
  | 'DUPLICATE_PROBABLE'
  | 'BANKING_CHANGE'
  | 'MC_DIVERGENCE'
  | 'AUTHORITY_INACTIVE'
  | 'CARRIER_VERIFICATION_REQUIRED'
  | 'RATE_CONFIRMATION_MISMATCH'
  | 'UNSUPPORTED_ACCESSORIAL'
  | 'UNBILLED_ACCESSORIAL';

export interface RuleException {
  invoice_id:      string;
  tipo_regra:      RuleName;
  valor_envolvido: number | null;
  descricao:       string;
  source_file:     string;
  source_page:     number | null;
  metadata:        Record<string, unknown>;
}

export type GetCarrierFn = (
  input: { dot?: string; mc?: string },
  ctx: AuditContext
) => Promise<CarrierLookupResult>;

export interface IRule {
  name: RuleName;
  evaluate(
    invoices: InvoiceRecord[],
    getCarrier: GetCarrierFn,
    ctx: AuditContext
  ): Promise<RuleException[]>;
}
