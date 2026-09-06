export interface CarrierLookupInput {
  dot?: string;
  mc?:  string;
}

export interface CarrierLookupResult {
  dot:               string | null;
  mc:                string | null;
  legal_name:        string | null;
  authority_status:  'ACTIVE' | 'INACTIVE' | 'REVOKED';
  broker_authority:  boolean;
  carrier_authority: boolean;
  checked_at:        string;  // ISO 8601
}

export interface AuditContext {
  run_id:        string;
  carrierCache:  Map<string, CarrierLookupResult>; // keyed: "mc:123456" | "dot:9876543"
  cacheTtlHours: number;
}

export interface ICarrierLookupProvider {
  lookup(input: CarrierLookupInput, ctx: AuditContext): Promise<CarrierLookupResult>;
}
