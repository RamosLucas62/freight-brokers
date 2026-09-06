import type { InvoiceFields } from '../types/invoice.types.js';

/**
 * Normalizes extracted invoice fields:
 * - MC/DOT: digits only
 * - Dates: YYYY-MM-DD (pass-through if already ISO, null if invalid)
 * - valor_total: number (pass-through; extraction already returns number)
 * - carrier_name: trim + uppercase
 */
export function normalizeFields(fields: InvoiceFields): InvoiceFields {
  return {
    ...fields,
    mc_number:    fields.mc_number    != null ? (fields.mc_number.replace(/\D/g, '') || null)    : null,
    dot_number:   fields.dot_number   != null ? (fields.dot_number.replace(/\D/g, '') || null)   : null,
    data_carga:   normalizeDate(fields.data_carga),
    data_fatura:  normalizeDate(fields.data_fatura),
    carrier_name: fields.carrier_name != null ? fields.carrier_name.trim().toUpperCase() : null,
  };
}

export function normalizeDate(value: string | null): string | null {
  if (!value?.trim()) return null;
  const iso = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null; // Ambiguous regional dates need review, not guessing.
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
