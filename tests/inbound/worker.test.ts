import {IncompleteTmsEvidence} from '../../src/reconciliation/evidence.js';
import {describe,it,expect,vi,beforeEach} from 'vitest';
const documentMocks=vi.hoisted(()=>({classify:vi.fn(),extractPod:vi.fn(),extractRate:vi.fn()}));
vi.mock('../../src/inbound/repository.js',()=>({recordEvidenceIssues:vi.fn(),validateTmsIntake:vi.fn(),assertEmailIntakeEnabled:vi.fn(),savedReport:vi.fn(),finish:vi.fn(),scheduleRetry:vi.fn(),saveAttachment:vi.fn(),storedDocuments:vi.fn(),setDocumentType:vi.fn(),cacheExtraction:vi.fn(),cacheSupportingExtraction:vi.fn(),recordBillableInvoice:vi.fn()}));
vi.mock('../../src/db/audit.repo.js',()=>({createAuditStore:vi.fn()}));
vi.mock('../../src/pipeline/audit.pipeline.js',()=>({runAuditPipeline:vi.fn()}));
vi.mock('../../src/extraction/index.js',()=>({extractor:{extract:vi.fn()}}));
vi.mock('../../src/carrier/index.js',()=>({getCarrier:vi.fn()}));
vi.mock('../../src/documents/classifier.js',()=>({OpenRouterDocumentClassifier:class{classify=documentMocks.classify;}}));
vi.mock('../../src/pod/openrouter.extractor.js',()=>({OpenRouterPodExtractor:class{extract=documentMocks.extractPod;}}));
vi.mock('../../src/rate-confirmation/openrouter.extractor.js',()=>({OpenRouterRateConfirmationExtractor:class{extract=documentMocks.extractRate;}}));
import * as repo from '../../src/inbound/repository.js';
import {createAuditStore} from '../../src/db/audit.repo.js';
import {runAuditPipeline} from '../../src/pipeline/audit.pipeline.js';
import {processJob} from '../../src/inbound/worker.js';
const job={id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',email_id:'33333333-3333-4333-8333-333333333333',attempts:1};
let active=vi.fn();let client:any;
beforeEach(()=>{
 vi.resetAllMocks();documentMocks.classify.mockResolvedValue('invoice');active=vi.fn().mockResolvedValue(undefined);vi.mocked(createAuditStore).mockReturnValue({assertActive:active} as any);
 vi.mocked(repo.storedDocuments).mockResolvedValue(new Map());
 client={isAutomatic:vi.fn().mockResolvedValue(false),attachments:vi.fn().mockResolvedValue([{id:job.id,filename:'../../evil.pdf',size:10,content_type:'application/pdf'}]),download:vi.fn().mockResolvedValue(Buffer.from('%PDF-test'))};
 vi.mocked(runAuditPipeline).mockResolvedValue({run_id:job.id,tenant_id:job.tenant_id,warnings:[]} as any);
});
describe('inbound worker',()=>{
 it('reuses committed report after an interrupted status update',async()=>{
  vi.mocked(repo.savedReport).mockResolvedValue({run_id:job.id} as any);await processJob(job,client);expect(client.attachments).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(job,'completed',{run_id:job.id},null);
 });
 it('blocks inactive accounts before downloading or extracting',async()=>{
  active.mockRejectedValue(new Error('paused'));await processJob(job,client);expect(client.isAutomatic).not.toHaveBeenCalled();expect(runAuditPipeline).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(job,'blocked',null,'ACCOUNT_UNAVAILABLE');
 });
 it('stores PDF before invoking tenant-scoped pipeline and uses safe paths',async()=>{
  await processJob(job,client);expect(repo.saveAttachment).toHaveBeenCalledOnce();
  const options=vi.mocked(runAuditPipeline).mock.calls[0][0];expect(options.tenantId).toBe(job.tenant_id);expect(options.filePaths[0]).not.toContain('evil');expect(options.ctx.run_id).toBe(job.id);
  expect(repo.finish).toHaveBeenCalledWith(job,'completed',expect.anything(),null);
 });
 it('automatically schedules a cached retry for a temporary provider failure',async()=>{
  vi.mocked(runAuditPipeline).mockRejectedValue(new Error('OpenRouter request failed or timed out. No extraction returned.'));await processJob(job,client);expect(runAuditPipeline).toHaveBeenCalledOnce();
  expect(repo.scheduleRetry).toHaveBeenCalledWith(job,'OPENROUTER_TIMEOUT_OR_NETWORK',60);expect(repo.finish).not.toHaveBeenCalledWith(job,'needs_review',expect.anything(),expect.anything());
 });
 it('moves a permanent processing failure to review without retrying',async()=>{
  vi.mocked(runAuditPipeline).mockRejectedValue(new Error('Expected exactly one invoice per PDF; split the document and retry.'));await processJob(job,client);
  expect(repo.scheduleRetry).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(job,'needs_review',null,'PDF_INVOICE_COUNT_INVALID');
 });
 it('stops automatic retries after the configured backoff sequence',async()=>{
  const exhausted={...job,attempts:4};vi.mocked(runAuditPipeline).mockRejectedValue(new Error('FMCSA request failed or timed out.'));await processJob(exhausted,client);
  expect(repo.scheduleRetry).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(exhausted,'needs_review',null,'FMCSA_TIMEOUT_OR_NETWORK');
 });
 it('classifies and passes POD and rate confirmation evidence to the audit pipeline',async()=>{
  const ids=['11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
  client.attachments.mockResolvedValue(ids.map((id,index)=>({id,filename:['invoice.pdf','pod.pdf','rate-confirmation.pdf'][index],size:10,content_type:'application/pdf'})));
  documentMocks.classify.mockImplementation(async(_path:string,name:string)=>name==='pod.pdf'?'pod':name==='rate-confirmation.pdf'?'rate_confirmation':'invoice');
  const pod={source_file:'pod.pdf',source_kind:'ocr',fields:{},quality:{},requires_human_review:false,raw:{}};const rate={source_file:'rate.pdf',fields:{},requires_human_review:false,raw:{}};
  documentMocks.extractPod.mockResolvedValue(pod);documentMocks.extractRate.mockResolvedValue(rate);await processJob(job,client);
  const options=vi.mocked(runAuditPipeline).mock.calls[0][0];expect(options.filePaths).toHaveLength(1);expect(options.pods).toEqual([pod]);expect(options.rateConfirmations).toEqual([rate]);expect(options.reconcileSupportingDocuments).toBe(true);
  expect(repo.cacheSupportingExtraction).toHaveBeenCalledTimes(2);expect(repo.recordBillableInvoice).not.toHaveBeenCalled();
 });
 it('records emails without PDFs explicitly',async()=>{
  client.attachments.mockResolvedValue([]);await processJob(job,client);expect(repo.finish).toHaveBeenCalledWith(job,'ignored',null,'NO_PDF_ATTACHMENTS');
 });
});

it('processes a TMS document through storage and audit without any email calls',async()=>{
 const {TmsReceivingClient}=await import('../../src/tms/sync.js');const tmsJob={...job,source:'tms',tms_provider:'tai',tms_record_id:'123'};
 const source=new TmsReceivingClient(tmsJob);const authorize=vi.spyOn(source,'authorize').mockResolvedValue();
 const metadata=vi.spyOn(source,'metadata');vi.spyOn(source,'attachments').mockResolvedValue([{id:job.id,filename:'carrier.pdf',size:12,content_type:'application/pdf',download_url:'https://unused.invalid'}]);vi.spyOn(source,'download').mockResolvedValue(Buffer.from('%PDF-test'));
 await processJob(tmsJob,source);expect(metadata).not.toHaveBeenCalled();expect(authorize).toHaveBeenCalledTimes(2);expect(repo.saveAttachment).toHaveBeenCalledOnce();
 const options=vi.mocked(runAuditPipeline).mock.calls[0][0];expect(options.tenantId).toBe(job.tenant_id);expect(Object.values(options.sourceLabels!)[0]).toContain('tms/tai/123/');expect(repo.finish).toHaveBeenCalledWith(tmsJob,'completed',expect.anything(),null);
});
it('blocks a disconnected TMS source before downloading',async()=>{
 const {TmsReceivingClient}=await import('../../src/tms/sync.js');const tmsJob={...job,source:'tms',tms_provider:'tai'};const source=new TmsReceivingClient(tmsJob);
 vi.spyOn(source,'authorize').mockRejectedValue(new Error('TMS_CONNECTION_INACTIVE'));const attachments=vi.spyOn(source,'attachments');await processJob(tmsJob,source);
 expect(attachments).not.toHaveBeenCalled();expect(runAuditPipeline).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(tmsJob,'blocked',null,'TMS_CONNECTION_INACTIVE');
});
it('cannot route an email job through a TMS source to bypass sender authorization',async()=>{
 const {TmsReceivingClient}=await import('../../src/tms/sync.js');const source=new TmsReceivingClient(job);const attachments=vi.spyOn(source,'attachments');await processJob(job,source);expect(attachments).not.toHaveBeenCalled();expect(runAuditPipeline).not.toHaveBeenCalled();
});

it('blocks queued email before provider access when a TMS is active',async()=>{
 vi.mocked(repo.assertEmailIntakeEnabled).mockRejectedValue(new Error('EMAIL_INTAKE_DISABLED_TMS'));
 await processJob(job,client);expect(client.isAutomatic).not.toHaveBeenCalled();expect(client.attachments).not.toHaveBeenCalled();expect(runAuditPipeline).not.toHaveBeenCalled();expect(repo.finish).toHaveBeenCalledWith(job,'blocked',null,'EMAIL_INTAKE_DISABLED_TMS');
});
it('stops an email when TMS activation occurs during attachment discovery',async()=>{
 vi.mocked(repo.assertEmailIntakeEnabled).mockResolvedValueOnce().mockRejectedValue(new Error('EMAIL_INTAKE_DISABLED_TMS'));
 await processJob(job,client);expect(client.attachments).toHaveBeenCalledOnce();expect(client.download).not.toHaveBeenCalled();expect(runAuditPipeline).not.toHaveBeenCalled();
});

it('keeps incomplete TMS evidence in review and does not validate email shutoff',async()=>{
 const {TmsReceivingClient}=await import('../../src/tms/sync.js');
 const tmsJob={...job,source:'tms',tms_provider:'tai'};const tmsClient=new TmsReceivingClient(tmsJob);
 vi.spyOn(tmsClient,'authorize').mockResolvedValue();vi.spyOn(tmsClient,'attachments').mockImplementation(client.attachments);vi.spyOn(tmsClient,'download').mockImplementation(client.download);
 const issues=[{load:'LOAD-1',missing:['POD','RATE_CONFIRMATION']}];vi.mocked(runAuditPipeline).mockRejectedValue(new IncompleteTmsEvidence(issues));
 await processJob(tmsJob,tmsClient);expect(repo.recordEvidenceIssues).toHaveBeenCalledWith(tmsJob,issues);expect(repo.finish).toHaveBeenCalledWith(tmsJob,'needs_review',null,'TMS_EVIDENCE_INCOMPLETE');expect(repo.validateTmsIntake).not.toHaveBeenCalled();
});
