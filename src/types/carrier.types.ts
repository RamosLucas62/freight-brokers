export interface CarrierLookupInput {
  dot?: string;
  mc?:  string;
}

export interface CarrierLookupResult {
  dot:               string | null;
  mc:                string | null;
  legal_name:        string | null;
  authority_status:  'ACTIVE' | 'INACTIVE' | 'REVOKED' | 'UNVERIFIABLE';
  verification_reason?: 'NO_UNIQUE_CARRIER' | 'INVALID_RESPONSE' | 'IDENTIFIER_MISMATCH' | 'AUTHORITY_UNAVAILABLE';
  broker_authority:  boolean;
  carrier_authority: boolean;
  checked_at:        string;  // ISO 8601
}

export interface AuditContext {
  run_id:        string;
  carrierCache:  Map<string, CarrierLookupResult>; // keyed: "mc:123456" | "dot:9876543"
  cacheTtlHours: number;
  /** Invoice ids created by the current run. Rules use this to distinguish new evidence from history. */
  currentInvoiceIds?: Set<string>;
}

export interface ICarrierLookupProvider {
  lookup(input: CarrierLookupInput, ctx: AuditContext): Promise<CarrierLookupResult>;
}
