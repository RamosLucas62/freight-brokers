import { describe, it, expect } from 'vitest';
import { lowConfidenceRule } from '../../src/rules/low-confidence.rule.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const noopGetCarrier = async () => makeCarrierResult();
const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

describe('LOW_CONFIDENCE rule', () => {
  it('returns no exceptions when all critical fields are above threshold', async () => {
    const inv = makeInvoice({
      confidence_scores: {
        numero_fatura:   0.98,
        valor_total:     0.95,
        mc_number:       0.99,
        dados_bancarios: 0.90,
      },
    });
    const result = await lowConfidenceRule.evaluate([inv], noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('flags invoice when numero_fatura confidence is below threshold', async () => {
    const inv = makeInvoice({
      confidence_scores: {
        numero_fatura:   0.70,
        valor_total:     0.95,
        mc_number:       0.99,
        dados_bancarios: 0.90,
      },
    });
    const result = await lowConfidenceRule.evaluate([inv], noopGetCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].tipo_regra).toBe('LOW_CONFIDENCE');
    expect(result[0].invoice_id).toBe(inv.id);
    expect(result[0].descricao).toContain('numero_fatura');
  });

  it('flags invoice when multiple critical fields are below threshold', async () => {
    const inv = makeInvoice({
      confidence_scores: {
        numero_fatura:   0.60,
        valor_total:     0.70,
        mc_number:       0.80,
        dados_bancarios: 0.75,
      },
    });
    const result = await lowConfidenceRule.evaluate([inv], noopGetCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.low_fields).toHaveLength(4);
  });

  it('uses invoice valor_total as valor_envolvido', async () => {
    const inv = makeInvoice({
      valor_total: 9999.99,
      confidence_scores: { numero_fatura: 0.50 },
    });
    const result = await lowConfidenceRule.evaluate([inv], noopGetCarrier, ctx);
    expect(result[0].valor_envolvido).toBe(9999.99);
  });

  it('flags each invoice independently', async () => {
    const inv1 = makeInvoice({ confidence_scores: { numero_fatura: 0.50 } });
    const inv2 = makeInvoice({ confidence_scores: { valor_total: 0.60 } });
    const inv3 = makeInvoice();

    const result = await lowConfidenceRule.evaluate([inv1, inv2, inv3], noopGetCarrier, ctx);
    expect(result).toHaveLength(2);
  });
});
