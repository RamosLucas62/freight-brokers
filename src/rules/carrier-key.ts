import type { InvoiceRecord } from '../types/invoice.types.js';
export function carrierKey(inv: InvoiceRecord): string | null {
  if (inv.mc_number?.trim()) return `mc:${inv.mc_number.trim()}`;
  if (inv.dot_number?.trim()) return `dot:${inv.dot_number.trim()}`;
  const name = inv.carrier_name?.trim().replace(/\s+/g, ' ').toUpperCase();
  return name ? `name:${name}` : null;
}
