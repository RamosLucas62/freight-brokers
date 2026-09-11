import { describe, it, expect } from 'vitest';
import { bankingChangeRule } from '../../src/rules/banking-change.rule.js';
import { makeInvoice } from '../fixtures/invoice.fixture.js';
import { makeCarrierResult } from '../fixtures/carrier.fixture.js';
import type { AuditContext } from '../../src/types/carrier.types.js';

const noopGetCarrier = async () => makeCarrierResult();
const ctx: AuditContext = {
  run_id:       'test-run',
  carrierCache: new Map(),
  cacheTtlHours: 4,
};

const bankingA = {
  bank_name:      'First National Bank',
  account_number: '111111111',
  routing_number: '021000021',
  account_type:   'checking' as const,
  payee_name:     'ACME LLC',
};

const bankingB = {
  bank_name:      'Chase Bank',
  account_number: '999999999',
  routing_number: '021000089',
  account_type:   'checking' as const,
  payee_name:     'ACME LLC',
};

describe('BANKING_CHANGE rule', () => {
  it('returns no exceptions when carrier has consistent banking', async () => {
    const invoices = [
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingA }),
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingA }),
    ];
    const result = await bankingChangeRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('emits one alert when a current batch has a new banking account', async () => {
    const invoices = [
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingA }),
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingB }),
    ];
    const result = await bankingChangeRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(1);
    expect(result.every(e => e.tipo_regra === 'BANKING_CHANGE')).toBe(true);
  });

  it('does not cross-contaminate different carriers', async () => {
    const invoices = [
      makeInvoice({ carrier_name: 'CARRIER A', dados_bancarios: bankingA }),
      makeInvoice({ carrier_name: 'CARRIER B', mc_number: '888888', dados_bancarios: bankingB }),
    ];
    const result = await bankingChangeRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });

  it('reports correct distinct_bank_accounts count in metadata', async () => {
    const bankingC = { ...bankingA, account_number: '777777777' };
    const invoices = [
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingA }),
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingB }),
      makeInvoice({ carrier_name: 'ACME LLC', dados_bancarios: bankingC }),
    ];
    const result = await bankingChangeRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(2);
    expect(result[0].metadata.distinct_bank_accounts).toBe(3);
  });

  it('compares current invoices with the latest historical account',async()=>{
    const historical=makeInvoice({id:'history',carrier_name:'ACME LLC',dados_bancarios:bankingA,created_at:'2024-01-01T00:00:00Z'});
    const current=makeInvoice({id:'current',carrier_name:'ACME LLC',dados_bancarios:bankingB,created_at:'2024-02-01T00:00:00Z'});
    const result=await bankingChangeRule.evaluate([historical,current],noopGetCarrier,{...ctx,currentInvoiceIds:new Set(['current'])});
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({invoice_id:'current',metadata:{baseline_source:'verified_history'}});
  });

  it('does not repeatedly alert when the current account matches latest history',async()=>{
    const historical=makeInvoice({id:'history',carrier_name:'ACME LLC',dados_bancarios:bankingB,created_at:'2024-01-01T00:00:00Z'});
    const current=makeInvoice({id:'current',carrier_name:'ACME LLC',dados_bancarios:bankingB,created_at:'2024-02-01T00:00:00Z'});
    expect(await bankingChangeRule.evaluate([historical,current],noopGetCarrier,{...ctx,currentInvoiceIds:new Set(['current'])})).toHaveLength(0);
  });

  it('skips invoices with no carrier_name', async () => {
    const invoices = [
      makeInvoice({ mc_number: null, dot_number: null, carrier_name: null, dados_bancarios: bankingA }),
      makeInvoice({ mc_number: null, dot_number: null, carrier_name: null, dados_bancarios: bankingB }),
    ];
    const result = await bankingChangeRule.evaluate(invoices, noopGetCarrier, ctx);
    expect(result).toHaveLength(0);
  });
});
