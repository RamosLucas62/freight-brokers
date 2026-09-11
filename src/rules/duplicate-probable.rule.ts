import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

const WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const normalized=(value:string|null)=>value?.trim().toUpperCase().replace(/[^A-Z0-9]/g,'')??'';

function hasStrongShipmentLink(a:InvoiceRecord,b:InvoiceRecord):boolean{
  const loadA=normalized(a.numero_carga),loadB=normalized(b.numero_carga);
  if(loadA&&loadB)return loadA===loadB;
  const originA=normalized(a.origem),originB=normalized(b.origem);
  const destinationA=normalized(a.destino),destinationB=normalized(b.destino);
  const routeMatches=Boolean(originA&&originB&&destinationA&&destinationB&&originA===originB&&destinationA===destinationB);
  if(!routeMatches)return false;
  // If load identifiers are incomplete, require a matching service date as a
  // second independent signal before calling two invoices probable duplicates.
  return Boolean(a.data_carga&&b.data_carga&&a.data_carga===b.data_carga);
}

export const duplicateProbableRule: IRule = {
  name: 'DUPLICATE_PROBABLE',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    _ctx: AuditContext
  ): Promise<RuleException[]> {
    const exceptions: RuleException[] = [];
    const flagged = new Set<string>();

    for (let i = 0; i < invoices.length; i++) {
      for (let j = i + 1; j < invoices.length; j++) {
        const a = invoices[i];
        const b = invoices[j];

        // Different invoice numbers (exact duplicates handled by other rule)
        if (a.numero_fatura.trim().toLowerCase() === b.numero_fatura.trim().toLowerCase()) continue;

        // Same carrier
        if (!a.carrier_name || !b.carrier_name) continue;
        if (a.carrier_name.toUpperCase() !== b.carrier_name.toUpperCase()) continue;

        // Same valor_total
        if (a.valor_total == null || b.valor_total == null) continue;
        if (a.valor_total !== b.valor_total) continue;

        // data_fatura within 7 days
        if (!a.data_fatura || !b.data_fatura) continue;
        const dateA = new Date(a.data_fatura).getTime();
        const dateB = new Date(b.data_fatura).getTime();
        if (isNaN(dateA) || isNaN(dateB)) continue;
        if (Math.abs(dateA - dateB) > WINDOW_DAYS * MS_PER_DAY) continue;

        // Amount, carrier and a nearby date are common in recurring freight.
        // Require a shared shipment signal to avoid flagging unrelated loads.
        if(!hasStrongShipmentLink(a,b))continue;

        // Flag both
        const pairKey = [a.id, b.id].sort().join('|');
        if (flagged.has(pairKey)) continue;
        flagged.add(pairKey);

        for (const inv of [a, b]) {
          exceptions.push({
            invoice_id:      inv.id,
            tipo_regra:      'DUPLICATE_PROBABLE',
            valor_envolvido: inv.valor_total,
            descricao:       `Probable duplicate: same carrier "${inv.carrier_name}", amount $${inv.valor_total}, within ${WINDOW_DAYS} days`,
            source_file:     inv.source_file,
            source_page:     null,
            metadata:        {
              carrier_name:    inv.carrier_name,
              valor_total:     inv.valor_total,
              partner_invoice: inv.id === a.id ? b.id : a.id,
              partner_numero:  inv.id === a.id ? b.numero_fatura : a.numero_fatura,
              date_diff_days:  Math.abs(dateA - dateB) / MS_PER_DAY,
              matching_load_number: Boolean(normalized(a.numero_carga)&&normalized(a.numero_carga)===normalized(b.numero_carga)),
              matching_route_and_service_date: Boolean(normalized(a.origem)&&normalized(a.origem)===normalized(b.origem)&&normalized(a.destino)&&normalized(a.destino)===normalized(b.destino)&&a.data_carga&&a.data_carga===b.data_carga),
            },
          });
        }
      }
    }

    return exceptions;
  },
};
