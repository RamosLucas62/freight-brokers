import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';
import { normalizeCompanyName } from '../normalization/index.js';

export const mcDivergenceRule: IRule = {
  name: 'MC_DIVERGENCE',

  async evaluate(
    invoices: InvoiceRecord[],
    getCarrier: GetCarrierFn,
    ctx: AuditContext
  ): Promise<RuleException[]> {
    const exceptions: RuleException[] = [];

    // Deduplicate MC lookups across invoices
    const mcLookupCache = new Map<string, Awaited<ReturnType<GetCarrierFn>>>();

    for (const inv of invoices) {
      if (!inv.mc_number) continue;
      if (!inv.carrier_name) continue;

      let carrierData = mcLookupCache.get(inv.mc_number);
      if (!carrierData) {
        carrierData = await getCarrier({ mc: inv.mc_number }, ctx);
        mcLookupCache.set(inv.mc_number, carrierData);
      }

      if (!carrierData.legal_name) continue;

      const fmcsaName = normalizeCompanyName(carrierData.legal_name);
      const invoiceName = normalizeCompanyName(inv.carrier_name);

      // A punctuation-only extraction is uncertainty, not evidence of a mismatch.
      if (!fmcsaName || !invoiceName) continue;

      if (fmcsaName !== invoiceName) {
        exceptions.push({
          invoice_id:      inv.id,
          tipo_regra:      'MC_DIVERGENCE',
          valor_envolvido: inv.valor_total,
          descricao:       `MC# ${inv.mc_number}: FMCSA name "${carrierData.legal_name}" ≠ invoice name "${inv.carrier_name}"`,
          source_file:     inv.source_file,
          source_page:     null,
          metadata:        {
            mc_number:      inv.mc_number,
            fmcsa_name:     carrierData.legal_name,
            invoice_name:   inv.carrier_name,
          },
        });
      }
    }

    return exceptions;
  },
};
