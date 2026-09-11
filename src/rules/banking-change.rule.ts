import { carrierKey } from './carrier-key.js';
import { createHash } from 'node:crypto';
import type { IRule, RuleException, GetCarrierFn } from '../types/rule.types.js';
import type { InvoiceRecord, DadosBancarios } from '../types/invoice.types.js';
import type { AuditContext } from '../types/carrier.types.js';

function bankingKey(d: DadosBancarios | null): string {
  if (!d) return '__no_banking__';
  return [
    d.bank_name      ?? '',
    d.account_number ?? '',
    d.routing_number ?? '',
    d.account_type   ?? '',
    d.payee_name     ?? '',
  ].map(v => v.trim().toLowerCase()).join('|');
}

export const bankingChangeRule: IRule = {
  name: 'BANKING_CHANGE',

  async evaluate(
    invoices: InvoiceRecord[],
    _getCarrier: GetCarrierFn,
    ctx: AuditContext
  ): Promise<RuleException[]> {
    // Group invoices by carrier_name
    const byCarrier = new Map<string, InvoiceRecord[]>();

    for (const inv of invoices) {
      const key = carrierKey(inv);
      if (!key || !inv.dados_bancarios?.account_number?.trim() || !inv.dados_bancarios?.routing_number?.trim()) continue;
      const group = byCarrier.get(key) ?? [];
      group.push(inv);
      byCarrier.set(key, group);
    }

    const exceptions: RuleException[] = [];

    for (const [carrier, group] of byCarrier.entries()) {
      if (group.length < 2) continue;

      const currentIds=ctx.currentInvoiceIds;
      const current=currentIds?group.filter(inv=>currentIds.has(inv.id)):group;
      const history=currentIds?group.filter(inv=>!currentIds.has(inv.id)):[];
      if(!current.length)continue;
      const byCreated=(a:InvoiceRecord,b:InvoiceRecord)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
      const latestHistorical=[...history].sort(byCreated).at(-1);
      const orderedCurrent=[...current].sort(byCreated);
      const baselineFingerprint=bankingKey((latestHistorical??orderedCurrent[0]).dados_bancarios);
      const distinctFingerprints=new Set(group.map(inv=>bankingKey(inv.dados_bancarios)));
      if(distinctFingerprints.size<=1)continue;

      // Emit one finding for each newly observed account, not one finding for
      // every invoice in the comparison set. This prevents duplicate alerts.
      const representatives=new Map<string,InvoiceRecord>();
      for(const inv of orderedCurrent){const fp=bankingKey(inv.dados_bancarios);if(fp!==baselineFingerprint&&!representatives.has(fp))representatives.set(fp,inv);}
      for (const [fp,inv] of representatives) {
        exceptions.push({
          invoice_id:      inv.id,
          tipo_regra:      'BANKING_CHANGE',
          valor_envolvido: inv.valor_total,
          descricao:       `Banking details changed for carrier "${carrier}" — ${distinctFingerprints.size} distinct accounts detected`,
          source_file:     inv.source_file,
          source_page:     null,
          metadata:        {
            carrier_name:         carrier,
            distinct_bank_accounts: distinctFingerprints.size,
            this_fingerprint:     createHash('sha256').update(fp).digest('hex'),
            baseline_source:latestHistorical?'verified_history':'current_batch',
          },
        });
      }
    }

    return exceptions;
  },
};
