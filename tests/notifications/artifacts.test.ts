import {describe,it,expect} from 'vitest';
import {composeEmail,createCsv,createPdf} from '../../src/notifications/artifacts.js';
import type {NotificationData} from '../../src/notifications/types.js';

function data(kind:'daily'|'monthly'|'immediate'='daily'):NotificationData{return {
 delivery:{id:'d1',tenant_id:'t1',kind,period_key:'daily:2026-09-05',period_start:'2026-09-05T04:00:00Z',period_end:'2026-09-06T04:00:00Z',exception_id:null,attempts:1},
 companyName:'Acme & Co',timezone:'America/New_York',recipients:['ops@example.com'],risks:[],avoided:[],
};}

describe('notification artifacts',()=>{
 it('sends the no-occurrence daily confirmation',()=>{const email=composeEmail(data(),'https://portal.example.com');expect(email.subject).toContain('Daily');expect(email.html).toContain('No risks were detected');expect(email.html).toContain('Acme &amp; Co');});
 it('renders period boundaries in the customer time zone',()=>{expect(composeEmail(data(),'https://portal.example.com').html).toContain('Sep 5, 2026 – Sep 5, 2026');});
 it('creates usable visual PDF and customer-readable spreadsheet attachments',()=>{
  const pdf=createPdf(data()).toString();const spreadsheet=createCsv(data()).toString();
  expect(pdf.slice(0,8)).toBe('%PDF-1.4');expect(pdf).toContain('Daily invoice risk summary');expect(pdf).toContain('AMOUNT UNDER REVIEW');
  expect(spreadsheet).toContain('Amount under review (USD)');expect(spreadsheet).toContain('Review status');expect(spreadsheet).not.toContain('amount_involved');
 });
 it('counts only confirmed avoided amounts in monthly impact',()=>{const value=data('monthly');value.avoided=[{id:'e1',invoice_id:'i1',tipo_regra:'DUPLICATE_EXACT',valor_envolvido:900,descricao:'Duplicate',source_file:'a.pdf',source_page:1,created_at:'2026-09-01T00:00:00Z',resolution_status:'avoided',avoided_amount:750,resolved_at:'2026-09-02T00:00:00Z'}];expect(composeEmail(value,'https://portal.example.com').html).toContain('$750.00');});
 it('uses friendly risk names in the email and attachments',()=>{const value=data('immediate');value.risks=[{id:'e1',invoice_id:'i1',tipo_regra:'DUPLICATE_EXACT',valor_envolvido:1935,descricao:'Duplicate',source_file:'a.pdf',source_page:1,created_at:'2026-09-01T00:00:00Z',resolution_status:'pending',avoided_amount:null,resolved_at:null}];const email=composeEmail(value,'https://portal.example.com');const csv=createCsv(value).toString();const pdf=createPdf(value).toString();for(const artifact of [email.subject,email.html,csv,pdf]){expect(artifact).toContain('Exact Duplicate Invoice');expect(artifact).not.toContain('DUPLICATE_EXACT');}});
 it('uses friendly workflow labels and localized dates in the spreadsheet',()=>{const value=data();value.risks=[{id:'e1',invoice_id:'i1',tipo_regra:'DUPLICATE_EXACT',valor_envolvido:1935,descricao:'Duplicate',source_file:'a.pdf',source_page:1,created_at:'2026-09-05T12:00:00Z',resolution_status:'pending',avoided_amount:null,resolved_at:null}];const spreadsheet=createCsv(value).toString();expect(spreadsheet).toContain('Pending review');expect(spreadsheet).not.toContain('"pending"');expect(spreadsheet).toContain('Sep 5, 2026');});
});
