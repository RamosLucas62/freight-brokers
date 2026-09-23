export interface DadosBancarios {
  bank_name?:      string | null;
  account_number?: string | null;
  routing_number?: string | null;
  account_type?:   'checking' | 'savings' | null;
  payee_name?:     string | null;
}

export interface AccessorialLineItem {
  evidence?: FieldEvidence | null;
  tipo:       string;   // FUEL_SURCHARGE | DETENTION | LAYOVER | LIFTGATE | TONU | OTHER
  descricao:  string;
  valor:      number;
  confidence: number;
  pagina:     number;
  posicao:    { x: number; y: number; width: number; height: number } | null;
}

export type ConfidenceScores = Record<string, number>;

export type VerificationStatus = 'verified' | 'unverifiable' | 'review';

export interface FieldEvidence {
  page: number | null;
  text: string | null;
}

export interface FieldVerification {
  status: VerificationStatus;
  confidence: number;
  signals: string[];
  evidence: FieldEvidence | null;
}

export interface InvoiceVerification {
  status: VerificationStatus;
  confidence: number;
  reasons: string[];
  sampled_for_quality_control: boolean;
  fields: Record<string, FieldVerification>;
}

export interface InvoiceFields {
  currency?: 'USD' | 'CAD' | null;
  numero_fatura:   string | null;
  numero_carga:    string | null;
  carrier_name:    string | null;
  mc_number:       string | null;
  dot_number:      string | null;
  data_carga:      string | null;   // YYYY-MM-DD
  data_fatura:     string | null;   // YYYY-MM-DD
  valor_total:     number | null;
  origem:          string | null;
  destino:         string | null;
  dados_bancarios: DadosBancarios | null;
}

export interface InvoiceExtractionResult {
  source_file:       string;
  fields:            InvoiceFields;
  confidence_scores: ConfidenceScores;
  field_evidence?:    Record<string, FieldEvidence | null>;
  accessorials:      AccessorialLineItem[];
  extraction_raw:    Record<string, unknown>;
}

export interface InvoiceRecord {
  currency?: 'USD' | 'CAD' | null;
  tenant_id?: string;
  document_hash?: string;
  id:               string;
  source_file:      string;
  numero_fatura:    string;
  numero_carga:     string | null;
  carrier_name:     string | null;
  mc_number:        string | null;
  dot_number:       string | null;
  data_carga:       string | null;
  data_fatura:      string | null;
  valor_total:      number | null;
  origem:           string | null;
  destino:          string | null;
  dados_bancarios:  DadosBancarios | null;
  accessorials:     AccessorialLineItem[];
  confidence_scores: ConfidenceScores;
  verification?:     InvoiceVerification;
  extraction_raw:   Record<string, unknown>;
  created_at:       string;
}

export const CRITICAL_FIELDS = ['numero_fatura', 'valor_total', 'mc_number', 'dados_bancarios'] as const;
export type CriticalField = typeof CRITICAL_FIELDS[number];
