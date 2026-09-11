import {afterEach,describe,expect,it,vi} from 'vitest';
import {confidenceSummary,verifyInvoice} from '../../src/confidence/engine.js';
import {makeExtractionResult,makeInvoice} from '../fixtures/invoice.fixture.js';

const evidence=(result=makeExtractionResult())=>Object.fromEntries(Object.entries(result.fields).map(([field,value])=>[field,value==null?{page:null,text:null}:{page:1,text:typeof value==='object'?`${value.account_number} ${value.routing_number}`:field==='valor_total'?'2,500.00':String(value)}]));

afterEach(()=>vi.unstubAllEnvs());
describe('verifiable confidence engine',()=>{
 it('verifies a structured invoice when source evidence supports every required value',()=>{vi.stubEnv('CONFIDENCE_QA_SAMPLE_RATE','0');const result=makeExtractionResult();const verification=verifyInvoice({fields:result.fields,evidence:evidence(result),tenantId:'t1',sourceId:'doc1'});expect(verification.status).toBe('verified');expect(verification.fields.numero_fatura).toMatchObject({status:'verified',confidence:0.94});expect(verification.reasons).toEqual([]);});
 it('treats absent banking details as optional, not an automatic failure',()=>{vi.stubEnv('CONFIDENCE_QA_SAMPLE_RATE','0');const result=makeExtractionResult();result.fields.dados_bancarios=null;const verification=verifyInvoice({fields:result.fields,evidence:evidence(result),tenantId:'t1',sourceId:'doc2'});expect(verification.fields.dados_bancarios.status).toBe('unverifiable');expect(verification.reasons).not.toContain(expect.stringContaining('dados_bancarios'));expect(verification.status).toBe('verified');});
 it('sends invalid and unsupported critical values to review without inventing confidence',()=>{const result=makeExtractionResult();result.fields.mc_number='not-an-mc';result.fields.dot_number=null;const verification=verifyInvoice({fields:result.fields,evidence:evidence(result),tenantId:'t1',sourceId:'doc3'});expect(verification.status).toBe('review');expect(verification.fields.mc_number).toMatchObject({status:'review',confidence:0.2});});
 it('keeps missing required evidence unverifiable',()=>{const result=makeExtractionResult();const verification=verifyInvoice({fields:result.fields,evidence:{},tenantId:'t1',sourceId:'doc4'});expect(verification.status).toBe('review');expect(verification.fields.numero_fatura.status).toBe('review');});
 it('produces automation and field metrics',()=>{vi.stubEnv('CONFIDENCE_QA_SAMPLE_RATE','0');const result=makeExtractionResult();const verified=verifyInvoice({fields:result.fields,evidence:evidence(result),tenantId:'t1',sourceId:'doc5'});const invoices=[makeInvoice({verification:verified}),makeInvoice({verification:{...verified,status:'review'}})];expect(confidenceSummary(invoices)).toMatchObject({verified:1,review:1,automation_rate:0.5});});
});
