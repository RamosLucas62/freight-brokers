import {describe,expect,it} from 'vitest';
import {freeAuditCsv,freeAuditPdf,repeatOfferEmail,resultEmail,verificationEmail} from '../../src/free-audit/artifacts.js';
const report={run_id:'11111111-1111-4111-8111-111111111111',generated_at:new Date().toISOString(),total_invoices_processed:2,total_exceptions:1,valor_total_under_review:900,exceptions:[{invoice_id:'i1',tipo_regra:'DUPLICATE_EXACT',rule_label:'Exact Duplicate Invoice',valor_envolvido:900,descricao:'Duplicate',source_reference:{file:'invoice.pdf',page:1},metadata:{}}]};
describe('free audit email artifacts',()=>{
 it('includes confirmation and commercial calls to action',()=>{expect(verificationEmail('Alex','https://example.com/verify').html).toContain('Confirm and start');expect(repeatOfferEmail('Alex','https://example.com/plans').html).toContain('See plans');expect(resultEmail('Alex','Acme',report,'https://example.com/plans').html).toContain('Protect every invoice');});
 it('generates usable private report attachments',()=>{expect(freeAuditPdf('Acme',report).subarray(0,8).toString()).toBe('%PDF-1.4');expect(freeAuditCsv(report).toString()).toContain('Exact Duplicate Invoice');});
});
