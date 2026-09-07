import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../src/inbound/repository.js',()=>({savedReport:vi.fn(),finish:vi.fn(),saveAttachment:vi.fn(),storedExtractions:vi.fn(),cacheExtraction:vi.fn(),recordBillableInvoice:vi.fn()}));
vi.mock('../../src/db/audit.repo.js',()=>({createAuditStore:vi.fn()}));
vi.mock('../../src/pipeline/audit.pipeline.js',()=>({runAuditPipeline:vi.fn()}));
vi.mock('../../src/extraction/index.js',()=>({extractor:{extract:vi.fn()}}));
vi.mock('../../src/carrier/index.js',()=>({getCarrier:vi.fn()}));
import * as repo from '../../src/inbound/repository.js';
import {createAuditStore} from '../../src/db/audit.repo.js';
import {runAuditPipeline} from '../../src/pipeline/audit.pipeline.js';
import {processJob} from '../../src/inbound/worker.js';
const job={id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',email_id:'33333333-3333-4333-8333-333333333333'};
let active=vi.fn();let client:any;
beforeEach(()=>{
 vi.resetAllMocks();active=vi.fn().mockResolvedValue(undefined);vi.mocked(createAuditStore).mockReturnValue({assertActive:active} as any);
 vi.mocked(repo.storedExtractions).mockResolvedValue(new Map());
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
 it('marks failures for review without retrying paid work',async()=>{
  vi.mocked(runAuditPipeline).mockRejectedValue(new Error('timeout'));await processJob(job,client);expect(runAuditPipeline).toHaveBeenCalledOnce();expect(repo.finish).toHaveBeenCalledWith(job,'needs_review',null,'PROCESSING_FAILED');
 });
 it('records emails without PDFs explicitly',async()=>{
  client.attachments.mockResolvedValue([]);await processJob(job,client);expect(repo.finish).toHaveBeenCalledWith(job,'ignored',null,'NO_PDF_ATTACHMENTS');
 });
});
