import {describe,expect,it} from 'vitest';
import {buildCrmFunnel,type CrmBillingRow,type CrmFollowupRow,type CrmLeadRow} from '../../src/dashboard/crm.js';

const lead=(overrides:Partial<CrmLeadRow>={}):CrmLeadRow=>({
 id:'lead-1',email:'lead@example.com',contact_name:'Jordan Lee',company_name:'Northstar Freight',phone:'+1 555 0100',loads_per_month:'501-1500',
 status:'completed',created_at:'2026-09-01T12:00:00.000Z',updated_at:'2026-09-01T13:00:00.000Z',completed_at:'2026-09-01T13:00:00.000Z',
 result:{total_invoices_processed:8},utm_source:'google',utm_medium:'cpc',utm_campaign:'freight-audit',utm_term:'invoice audit',utm_content:'hero',...overrides,
});
const followup=(day_offset:number,status='sent'):CrmFollowupRow=>({request_id:'lead-1',day_offset,status,sent_at:status==='sent'?`2026-09-${String(day_offset+1).padStart(2,'0')}T12:00:00.000Z`:null});
const billing=(status:string,overrides:Partial<CrmBillingRow>={}):CrmBillingRow=>({billing_email:'lead@example.com',status,trial_ends_at:null,canceled_at:null,plan_code:'growth',billing_period:'semiannual',last_paid_amount_cents:null,last_paid_currency:null,last_paid_at:null,updated_at:'2026-09-10T12:00:00.000Z',...overrides});

describe('admin CRM funnel',()=>{
 it('moves a free-audit lead to the latest follow-up that was actually sent',()=>{
  expect(buildCrmFunnel([lead()],[],[]).rows[0].stage).toBe('free_audit');
  const result=buildCrmFunnel([lead()],[followup(1),followup(3),followup(5,'pending')],[]);
  expect(result.rows[0].stage).toBe('followup_3');
  expect(result.stages.find(stage=>stage.id==='followup_3')?.count).toBe(1);
 });

 it('lets subscription lifecycle override follow-up progress',()=>{
  const sent=[followup(1),followup(30)];
  expect(buildCrmFunnel([lead()],sent,[billing('trialing')]).rows[0].stage).toBe('trial');
  expect(buildCrmFunnel([lead()],sent,[billing('active')]).rows[0].stage).toBe('active');
  expect(buildCrmFunnel([lead()],sent,[billing('canceled',{canceled_at:'2026-09-11T12:00:00.000Z'})]).rows[0].stage).toBe('churn');
 });

 it('uses the newest subscription and keeps lead, audit and attribution details',()=>{
  const older=billing('canceled',{updated_at:'2026-09-08T12:00:00.000Z'});
  const newer=billing('active',{updated_at:'2026-09-12T12:00:00.000Z',plan_code:'scale',last_paid_amount_cents:808200,last_paid_currency:'usd',last_paid_at:'2026-09-12T11:59:00.000Z'});
  const result=buildCrmFunnel([lead()],[followup(1)],[older,newer]).rows[0];
  expect(result).toMatchObject({stage:'active',contact_name:'Jordan Lee',phone:'+1 555 0100',loads_per_month:'501-1500',invoice_count:8,utm_source:'google',utm_campaign:'freight-audit'});
  expect(result.subscription).toMatchObject({status:'active',plan_code:'scale',last_paid_amount_cents:808200,last_paid_currency:'usd',last_paid_at:'2026-09-12T11:59:00.000Z'});
  expect(result.last_activity_at).toBe('2026-09-12T12:00:00.000Z');
 });
});
