import {beforeEach,describe,expect,it,vi} from 'vitest';

const send=vi.fn();
vi.mock('@aws-sdk/client-s3',()=>({
 S3Client:vi.fn(function(){return {send};}),
 PutObjectCommand:vi.fn(function(input){return input;}),
 DeleteObjectsCommand:vi.fn(function(input){return input;}),
}));

import {deleteInvoiceObjects,invoiceObjectKey,putInvoiceObject,resetR2ClientForTests} from '../../src/storage/r2.js';

beforeEach(()=>{
 vi.clearAllMocks();resetR2ClientForTests();send.mockResolvedValue({});
 process.env.R2_ACCOUNT_ID='account';process.env.R2_ACCESS_KEY_ID='access';
 process.env.R2_SECRET_ACCESS_KEY='secret';process.env.R2_BUCKET_NAME='private-bucket';
});

describe('Cloudflare R2 invoice storage',()=>{
 it('builds a tenant-scoped object key without allowing path injection',()=>{
  expect(invoiceObjectKey('tenant','job','../../invoice')).toBe('invoices/tenant/job/..%2F..%2Finvoice.pdf');
 });
 it('uploads PDFs into the configured private bucket',async()=>{
  const bytes=Buffer.from('%PDF-test');await putInvoiceObject('invoices/t/j/a.pdf',bytes);
 expect(send).toHaveBeenCalledWith(expect.objectContaining({Bucket:'private-bucket',Key:'invoices/t/j/a.pdf',Body:bytes,ContentType:'application/pdf'}));
 });
 it('deletes stored customer PDFs in R2 batches',async()=>{
  await deleteInvoiceObjects(['invoices/t/j/a.pdf','invoices/t/j/b.pdf']);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({Bucket:'private-bucket',Delete:{Objects:[{Key:'invoices/t/j/a.pdf'},{Key:'invoices/t/j/b.pdf'}],Quiet:true}}));
 });
});
