import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({claimRequest:vi.fn(),finishRequest:vi.fn(),loadAttachments:vi.fn(),saveResult:vi.fn(),issueRetry:vi.fn()}));
vi.mock('../../src/free-audit/repository.js',()=>({...mocks,registerRequest:vi.fn(),saveAttachment:vi.fn(),clearAttachments:vi.fn(),markUploaded:vi.fn(),releaseOffer:vi.fn(),failUpload:vi.fn(),verifyRequest:vi.fn(),claimExpired:vi.fn(),expireRequest:vi.fn(),failExpiration:vi.fn(),inspectRetry:vi.fn(),beginRetry:vi.fn(),finishRetry:vi.fn(),failRetry:vi.fn()}));
import {processFreeAudit} from '../../src/free-audit/worker.js';
const report={run_id:'11111111-1111-4111-8111-111111111111',generated_at:new Date().toISOString(),total_invoices_processed:1,total_exceptions:0,valor_total_under_review:0,exceptions:[]};
const request={id:'11111111-1111-4111-8111-111111111111',email:'lead@example.com',contact_name:'Lead',company_name:'Acme',phone:null,loads_per_month:null,status:'processing',attempts:1,result:report};
beforeEach(()=>vi.clearAllMocks());
describe('free audit worker delivery',()=>{
 it('reuses a saved result and sends the report with a stable idempotency key',async()=>{
  mocks.claimRequest.mockResolvedValue(request);const sender={send:vi.fn().mockResolvedValue('email-1')};
  await expect(processFreeAudit(sender as any,'https://aiolympian.com/pricing')).resolves.toBe(true);
  expect(mocks.loadAttachments).not.toHaveBeenCalled();expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:`free-audit-result-${request.id}`,to:['lead@example.com'],html:expect.stringContaining('https://aiolympian.com/pricing'),attachments:expect.arrayContaining([expect.objectContaining({filename:'olympian-free-audit.pdf'})])}));expect(mocks.finishRequest).toHaveBeenCalledWith(request);
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
 it('does not replace a report-delivery retry with a failure notice',async()=>{
  mocks.claimRequest.mockResolvedValue(request);const sender={send:vi.fn().mockRejectedValue(new Error('mail offline'))};
  await expect(processFreeAudit(sender as any,'https://example.com/audit')).rejects.toThrow('mail offline');expect(sender.send).toHaveBeenCalledTimes(1);
 });
});
