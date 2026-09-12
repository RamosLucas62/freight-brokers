import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({claimRequest:vi.fn(),finishRequest:vi.fn(),loadAttachments:vi.fn(),saveResult:vi.fn(),issueRetry:vi.fn(),activateResult:vi.fn(),claimFollowup:vi.fn(),finishFollowup:vi.fn(),failFollowup:vi.fn()}));
vi.mock('../../src/free-audit/repository.js',()=>({...mocks,registerRequest:vi.fn(),saveAttachment:vi.fn(),clearAttachments:vi.fn(),markUploaded:vi.fn(),releaseOffer:vi.fn(),failUpload:vi.fn(),verifyRequest:vi.fn(),claimExpired:vi.fn(),expireRequest:vi.fn(),failExpiration:vi.fn(),inspectRetry:vi.fn(),beginRetry:vi.fn(),finishRetry:vi.fn(),failRetry:vi.fn()}));
import {processFreeAudit,processFreeAuditFollowup,recommendedPlan,resultAccessToken} from '../../src/free-audit/worker.js';
const report={run_id:'11111111-1111-4111-8111-111111111111',generated_at:new Date().toISOString(),total_invoices_processed:1,total_exceptions:0,valor_total_under_review:0,exceptions:[]};
const request={id:'11111111-1111-4111-8111-111111111111',email:'lead@example.com',contact_name:'Lead',company_name:'Acme',phone:null,loads_per_month:null,status:'processing',attempts:1,result:report};
beforeEach(()=>{vi.clearAllMocks();mocks.activateResult.mockResolvedValue(undefined);});
describe('free audit worker delivery',()=>{
 it('maps reported volume to the three plans and creates a stable private token',()=>{expect(recommendedPlan('101-500')).toBe('core');expect(recommendedPlan('501 - 1,500')).toBe('growth');expect(recommendedPlan('Over 1,500/month')).toBe('scale');expect(recommendedPlan('2,000+')).toBe('scale');expect(resultAccessToken(request.id,'secret')).toHaveLength(43);expect(resultAccessToken(request.id,'secret')).toBe(resultAccessToken(request.id,'secret'));});
 it('reuses a saved result and sends the report with a stable idempotency key',async()=>{
  mocks.claimRequest.mockResolvedValue(request);const sender={send:vi.fn().mockResolvedValue('email-1')};
  await expect(processFreeAudit(sender as any,'https://aiolympian.com/pricing')).resolves.toBe(true);
  expect(mocks.loadAttachments).not.toHaveBeenCalled();expect(mocks.activateResult).toHaveBeenCalledWith(request.id,expect.stringMatching(/^[a-f0-9]{64}$/),'core');expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:`free-audit-result-${request.id}`,to:['lead@example.com'],html:expect.stringContaining('/free-audit/result?token='),attachments:[]}));expect(mocks.finishRequest).toHaveBeenCalledWith(request);
 });
 it('retries only delivery when a persisted report email fails',async()=>{
  mocks.claimRequest.mockResolvedValue(request);const failure=new Error('mail offline');const sender={send:vi.fn().mockRejectedValue(failure)};
  await expect(processFreeAudit(sender as any,'https://example.com/plans')).rejects.toThrow('mail offline');expect(mocks.finishRequest).toHaveBeenCalledWith(request,failure,true);
 });
 it('notifies the customer when processing fails before a report is ready',async()=>{
  const pending={...request,result:null};mocks.claimRequest.mockResolvedValue(pending);mocks.loadAttachments.mockResolvedValue([]);const sender={send:vi.fn().mockResolvedValue('email-2')};
  await expect(processFreeAudit(sender as any,'https://example.com/audit')).rejects.toThrow('NO_FREE_AUDIT_ATTACHMENTS');
  expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:`free-audit-failure-${request.id}-1`,to:['lead@example.com'],subject:expect.stringContaining('Action needed'),attachments:[]}));
  expect(mocks.issueRetry).toHaveBeenCalledWith(request.id,expect.stringMatching(/^[a-f0-9]{64}$/));
  expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({html:expect.stringContaining('/free-audit/retry?token=')}));
  expect(mocks.finishRequest).toHaveBeenCalledWith(pending,expect.any(Error),false);
 });
 it('retries transient processing failures without asking for the same files again',async()=>{const pending={...request,result:null,attempts:1};const transient=new Error('PROVIDER_ERROR');mocks.claimRequest.mockResolvedValue(pending);mocks.loadAttachments.mockRejectedValue(transient);const sender={send:vi.fn()};await expect(processFreeAudit(sender as any,'https://example.com/audit')).rejects.toThrow('PROVIDER_ERROR');expect(sender.send).not.toHaveBeenCalled();expect(mocks.issueRetry).not.toHaveBeenCalled();expect(mocks.finishRequest).toHaveBeenCalledWith(pending,transient,false,true);});
 it('does not replace a report-delivery retry with a failure notice',async()=>{
  mocks.claimRequest.mockResolvedValue(request);const sender={send:vi.fn().mockRejectedValue(new Error('mail offline'))};
  await expect(processFreeAudit(sender as any,'https://example.com/audit')).rejects.toThrow('mail offline');expect(sender.send).toHaveBeenCalledTimes(1);
 });
 it('sends the scheduled D+30 follow-up with result and unsubscribe links',async()=>{mocks.claimFollowup.mockResolvedValue({request_id:request.id,day_offset:30,delivery_sequence:2,email:request.email,contact_name:request.contact_name,company_name:request.company_name,loads_per_month:'2000',recommended_plan:'scale',result:report});const sender={send:vi.fn().mockResolvedValue('email-30')};await expect(processFreeAuditFollowup(sender as any,'https://audit.example.com','secret')).resolves.toBe(true);expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:`free-audit-followup-${request.id}-30-2`,html:expect.stringMatching(/free-audit\/result\?token=.*free-audit\/unsubscribe\?token=/s),attachments:[]}));expect(mocks.finishFollowup).toHaveBeenCalledWith(request.id,30);});
});
