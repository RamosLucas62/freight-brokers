import {afterEach,describe,expect,it,vi} from 'vitest';
import {notifyLeadFunnel,notifyOperationalError} from '../../src/notifications/google-chat.sender.js';

describe('Google Chat notifications',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('formats lead funnel stages with the audit id and follow-up detail',async()=>{
  vi.stubEnv('GOOGLE_CHAT_LEADS_WEBHOOK_URL','https://chat.example/leads');
  const request=vi.fn(async()=>new Response('{}',{status:200}));
 await notifyLeadFunnel({stage:'followup_sent',requestId:'audit-1',email:'lead@example.com',company:'Acme',follow:30},request as typeof fetch);
 expect(request).toHaveBeenCalledWith('https://chat.example/leads',expect.objectContaining({method:'POST'}));
 const payload=JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(payload.text).toContain('Follow-up D+30 enviado');
  expect(payload.text).toContain('lead@example.com acaba de receber o follow-up D+30.');
  expect(payload.text).toContain('*Empresa:* Acme');
  expect(payload.text).toContain('ID interno: audit-1');
 });
 it('formats a new lead without exposing raw metadata',async()=>{
  vi.stubEnv('GOOGLE_CHAT_LEADS_WEBHOOK_URL','https://chat.example/leads');
  const request=vi.fn(async()=>new Response('{}',{status:200}));
  await notifyLeadFunnel({stage:'audit_requested',requestId:'audit-new',name:'Ana',email:'ana@example.com',company:'Carrier Co',metadata:{loads_per_month:'500-1,500/month',utm_source:'google',utm_medium:'cpc',utm_campaign:'audit'}},request as typeof fetch);
  const payload=JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(payload.text).toContain('Opa, novo lead!');
  expect(payload.text).toContain('*Nome:* Ana');
  expect(payload.text).toContain('*Etapa:* Auditoria gratuita solicitada');
  expect(payload.text).toContain('*Origem:* google / cpc / audit');
  expect(payload.text).not.toContain('"utm_source"');
 });
 it('formats cancellation and plan-change stages',async()=>{
  vi.stubEnv('GOOGLE_CHAT_LEADS_WEBHOOK_URL','https://chat.example/leads');
  const request=vi.fn(async()=>new Response('{}',{status:200}));
  await notifyLeadFunnel({stage:'cancel_requested',requestId:'tenant-1',email:'owner@example.com'},request as typeof fetch);
  await notifyLeadFunnel({stage:'plan_changed',requestId:'sub-1',metadata:{plan:'scale',period:'annual'}},request as typeof fetch);
  const cancelPayload=JSON.parse(String(request.mock.calls[0][1]?.body));
  const planPayload=JSON.parse(String(request.mock.calls[1][1]?.body));
  expect(cancelPayload.text).toContain('*Etapa:* Cliente solicitou cancelamento');
  expect(planPayload.text).toContain('*Etapa:* Cliente alterou o plano');
  expect(planPayload.text).toContain('*Plano:* Scale');
  expect(planPayload.text).toContain('*Período:* Anual');
 });
 it('formats error alerts with id, error and timestamp',async()=>{
  vi.stubEnv('GOOGLE_CHAT_ERRORS_WEBHOOK_URL','https://chat.example/errors');
  const request=vi.fn(async()=>new Response('{}',{status:200}));
  await notifyOperationalError({timestamp:'2026-09-11T10:00:00.000Z',event:'free_audit.worker.failed',audit_request_id:'audit-2',error_code:'NO_FREE_AUDIT_ATTACHMENTS'},request as typeof fetch);
  const payload=JSON.parse(String(request.mock.calls[0][1]?.body));
  expect(payload.text).toContain('Erro no Freight Audit');
  expect(payload.text).toContain('*Onde aconteceu:* Processamento da auditoria gratuita');
  expect(payload.text).toContain('*Código:* NO_FREE_AUDIT_ATTACHMENTS');
  expect(payload.text).toContain('*Referência:* audit-2');
  expect(payload.text).toContain('*Horário:* 2026-09-11T10:00:00.000Z');
 });
 it('retries temporary webhook failures',async()=>{
  vi.stubEnv('GOOGLE_CHAT_LEADS_WEBHOOK_URL','https://chat.example/leads');
  const request=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response('{}',{status:200}));
  await notifyLeadFunnel({stage:'audit_requested',requestId:'audit-3'},request as typeof fetch);
  expect(request).toHaveBeenCalledTimes(2);
 });
 it('does not silently accept a missing lead webhook',async()=>{
  vi.stubEnv('GOOGLE_CHAT_LEADS_WEBHOOK_URL','');
  await expect(notifyLeadFunnel({stage:'audit_requested',requestId:'audit-4'})).rejects.toThrow('GOOGLE_CHAT_WEBHOOK_MISSING');
 });
});
