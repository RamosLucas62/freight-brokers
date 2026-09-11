export const RULE_LABELS: Readonly<Record<string, string>> = {
  LOW_CONFIDENCE: 'Low Extraction Confidence',
  DUPLICATE_EXACT: 'Exact Duplicate Invoice',
  DUPLICATE_PROBABLE: 'Probable Duplicate Invoice',
  BANKING_CHANGE: 'Banking Information Changed',
  MC_DIVERGENCE: 'MC# Name Mismatch (FMCSA)',
  AUTHORITY_INACTIVE: 'Carrier Authority Inactive',
  CARRIER_VERIFICATION_REQUIRED: 'Carrier Identification Needs Review',
  RATE_CONFIRMATION_MISMATCH: 'Rate Confirmation Mismatch',
  UNSUPPORTED_ACCESSORIAL: 'Unsupported Accessorial Charge',
  UNBILLED_ACCESSORIAL: 'Potential Unbilled Accessorial Revenue',
};

export function ruleLabel(code: string | null | undefined): string {
  if (!code) return 'Invoice Risk';
  return RULE_LABELS[code] ?? code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
