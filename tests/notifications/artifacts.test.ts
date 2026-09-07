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
 it('creates usable PDF and spreadsheet attachments',()=>{expect(createPdf(data()).subarray(0,8).toString()).toBe('%PDF-1.4');expect(createCsv(data()).toString()).toContain('amount_involved');});
 it('counts only confirmed avoided amounts in monthly impact',()=>{const value=data('monthly');value.avoided=[{id:'e1',invoice_id:'i1',tipo_regra:'DUPLICATE_EXACT',valor_envolvido:900,descricao:'Duplicate',source_file:'a.pdf',source_page:1,created_at:'2026-09-01T00:00:00Z',resolution_status:'avoided',avoided_amount:750,resolved_at:'2026-09-02T00:00:00Z'}];expect(composeEmail(value,'https://portal.example.com').html).toContain('$750.00');});
});
