import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

export const authorityInactiveRule: IRule = {
  name: 'AUTHORITY_INACTIVE',

  async evaluate(
    invoices: InvoiceRecord[],
    getCarrier: GetCarrierFn,
    ctx: AuditContext
  ): Promise<RuleException[]> {
    const exceptions: RuleException[] = [];

    // Reuse ctx.carrierCache — MC_DIVERGENCE rule already populated it
    for (const inv of invoices) {
      if (!inv.mc_number && !inv.dot_number) continue;

      const input = inv.mc_number
        ? { mc: inv.mc_number }
        : { dot: inv.dot_number! };

      const carrierData = await getCarrier(input, ctx);

      const isInactive =
        carrierData.authority_status !== 'ACTIVE' ||
        !carrierData.carrier_authority;

      if (isInactive) {
        const status = carrierData.authority_status;
        const hasCarrierAuth = carrierData.carrier_authority;

        exceptions.push({
          invoice_id:      inv.id,
          tipo_regra:      'AUTHORITY_INACTIVE',
          valor_envolvido: inv.valor_total,
          descricao:       `Carrier authority issue at lookup time ${carrierData.checked_at} (historical load-date status not verified): status="${status}", carrier_authority=${hasCarrierAuth}`,
          source_file:     inv.source_file,
          source_page:     null,
          metadata:        {
            mc_number:         inv.mc_number,
            dot_number:        inv.dot_number,
            authority_status:  status,
            carrier_authority: hasCarrierAuth,
            broker_authority:  carrierData.broker_authority,
            data_carga:        inv.data_carga,
            checked_at:        carrierData.checked_at,
            historical_status_verified: false,
          },
        });
      }
    }

    return exceptions;
  },
};
