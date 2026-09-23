export interface ReportException {
  invoice_id:      string;
  tipo_regra:      string;
  rule_label:      string;
  valor_envolvido: number | null;
  descricao:       string;
  source_reference: { file: string; page: number | null };
  metadata:        Record<string, unknown>;
}

export interface AuditReport {
  accessorial_checks?:Array<import('../accessorial/verify.js').AccessorialCheck&{invoice_id:string}>;
  document_coverage?:{validated_invoices:number;checks:string[];scope:'basic_freight_evidence'};
  tenant_id?: string;
  skipped_files?: string[];
  warnings?: string[];
  run_id:                   string;
  generated_at:             string;
  total_invoices_processed: number;
  total_exceptions:         number;
  valor_total_under_review: number;
  exceptions:               ReportException[];
  reconciliation?: {matched:number;divergent:number;unverifiable:number;unbilled_revenue:number;supporting_documents:number};
  confidence?: {
    verified:number;review:number;unverifiable:number;quality_control_samples:number;automation_rate:number;
    field_statuses:{verified:number;review:number;unverifiable:number};
  };
}
