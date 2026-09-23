import {afterEach,describe,expect,it,vi} from 'vitest';
import {TaiClient} from '../../src/tms/tai.js';
import {McLeodClient,McLeodCredentials} from '../../src/tms/mcleod.js';
import {RoseRocketClient} from '../../src/tms/rose-rocket.js';
import {documentBatch} from '../../src/tms/sync.js';
import {inboundFailureDecision} from '../../src/inbound/failure-policy.js';
const connection={tenant_id:'11111111-1111-4111-8111-111111111111',provider:'tai',credentials_ciphertext:'',connection_version:'version-a',sync_claim:'claim'};
afterEach(()=>vi.unstubAllEnvs());
it('Tai discovers bills across all sync states, excludes receivables, and downloads signed PDFs without its key',async()=>{
 const calls:string[]=[];
 const fetcher=vi.fn(async(url:any,options:any)=>{
  const path=String(url);calls.push(path);
  if(path.includes('/Bills?'))return Response.json([{shipmentId:123}]);
  if(path.includes('/Documents?'))return Response.json([
   {documentId:1,attachmentName:'carrier.pdf',attachmentType:'Carrier Bill',attachmentUrl:'https://acme.taicloud.net/Files/SecureDownload?token=private'},
   {documentId:2,attachmentName:'customer.pdf',attachmentType:'Invoice',attachmentUrl:'https://acme.taicloud.net/Files/2'},
  ]);
  expect(options.headers).toBeUndefined();expect(options.redirect).toBe('error');return new Response('%PDF-test');
 });
 const client=new TaiClient({site:'acme',api_key:'secret'},fetcher);const records=[];for await(const record of client.records())records.push(record);
 expect(records).toHaveLength(1);expect(records[0].documents).toHaveLength(1);expect((await records[0].documents[0].download()).toString()).toBe('%PDF-test');
 expect(calls.filter(path=>path.includes('/Bills?'))).toHaveLength(5);
});
it.each(['https://evil.example/file','http://acme.taicloud.net/file','https://acme.taicloud.net:8443/file','https://user@acme.taicloud.net/file'])('Tai blocks untrusted document URL %s',async attachmentUrl=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json([{documentId:1,attachmentName:'bill.pdf',attachmentType:'Carrier Bill',attachmentUrl}]));const record=await new TaiClient({site:'acme',api_key:'secret'},fetcher).record('123');
 await expect(record.documents[0].download()).rejects.toThrow('TMS_UNTRUSTED_DOCUMENT_URL');expect(fetcher).toHaveBeenCalledOnce();
});
it('McLeod reads delivered orders, maps configured imaging types and scopes requests to its company',async()=>{
 const fetcher=vi.fn(async(url:any,options:any)=>{
  expect(options.headers['X-com.mcleodsoftware.CompanyID']).toBe('TMS');expect(options.headers.Authorization).toBe('Bearer secret');expect(options.redirect).toBe('error');
  if(String(url).includes('/orders/search?'))return Response.json([{id:'load-1'}]);
  if(String(url).includes('/images/O/'))return Response.json([{id:'1',companyId:'TMS',documentTypeId:'BILL',scanDate:'2026-09-22'},{id:'2',companyId:'TMS',documentTypeId:'W9'}]);
  return new Response('%PDF-mcleod');
 });
 const client=new McLeodClient({host:'demo.loadtracking.com',company_id:'TMS',token:'secret',document_type_ids:['BILL','POD']},fetcher);const records=[];for await(const record of client.records())records.push(record);
 expect(records).toHaveLength(1);expect(records[0].documents).toHaveLength(1);expect((await records[0].documents[0].download()).toString()).toBe('%PDF-mcleod');
 expect(fetcher.mock.calls[0][0]).toContain('orders.status=D&recordLength=100&recordOffset=0');
});
it('McLeod rejects images outside the configured company and unsupported hosts',async()=>{
 const credentials={host:'demo.mcleodhosted.com',company_id:'TMS',token:'secret',document_type_ids:['BILL']};
 await expect(new McLeodClient(credentials,vi.fn().mockResolvedValue(Response.json([{id:'1',companyId:'OTHER',documentTypeId:'BILL'}]))).record('load')).rejects.toThrow('MCLEOD_COMPANY_MISMATCH');
 for(const host of ['127.0.0.1','evil.example','demo.loadtracking.com.evil.example','demo.loadtracking.com:443'])expect(()=>McLeodCredentials.parse({...credentials,host})).toThrow();
});
it('stable batches survive credential rotation, ignore document ordering and distinguish new evidence',()=>{
 const docs=[{id:'invoice',revision:'1',filename:'bill.pdf',download:vi.fn()},{id:'pod',revision:'1',filename:'pod.pdf',download:vi.fn()}];
 const first=documentBatch(connection,'load-1',docs);
 expect(documentBatch({...connection,connection_version:'new'},'load-1',[...docs].reverse())).toEqual(first);
 expect(documentBatch(connection,'load-1',docs.slice(0,1)).batch).not.toBe(first.batch);
 expect(documentBatch({...connection,tenant_id:'another'},'load-1',docs).batch).not.toBe(first.batch);
});
describe('Rose automated delivery',()=>{
 const account={orgId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',clientId:'app',clientSecret:'secret'};
 it('registers the documented webhook subscription',async()=>{
  const fetcher=vi.fn(async(url:any,options:any)=>{
   if(String(url).includes('/oauth/token'))return Response.json({access_token:'token'});
   expect(JSON.parse(options.body)).toMatchObject({objectKey:'webhookDestination',json:{url:'https://portal.example.com/webhooks/test',subscriptions:[{eventName:'Order Status Changed'}]}});return Response.json({id:'destination'});
  });
  await new RoseRocketClient({account,fetcher}).registerDocumentWebhook('https://portal.example.com/webhooks/test');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('resolves uploaded files from the authenticated API and never forwards credentials to storage',async()=>{
  const fetcher=vi.fn(async(url:any,options:any)=>{
   if(String(url).includes('/oauth/token'))return Response.json({access_token:'token'});
   if(String(url).includes('/file/url?'))return Response.json({presignedUrl:'https://bucket.s3.us-east-1.amazonaws.com/file?signature=secret'});
   expect(options.headers).toBeUndefined();expect(options.redirect).toBe('error');return new Response('%PDF-upload');
  });
  const bytes=await new RoseRocketClient({account,fetcher}).downloadPdf({id:account.orgId,file:{id:account.userId}});expect(bytes.toString()).toBe('%PDF-upload');
 });
 it('rejects untrusted presigned origins before any download',async()=>{
  const fetcher=vi.fn(async(url:any)=>String(url).includes('/oauth/token')?Response.json({access_token:'token'}):Response.json({presignedUrl:'https://169.254.169.254/secret'}));
  await expect(new RoseRocketClient({account,fetcher}).downloadPdf({id:account.orgId,file:{id:account.userId}})).rejects.toThrow('ROSE_DOCUMENT_HOST_NOT_CONFIGURED');expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
it('retries temporary TMS download errors but not revoked credentials',()=>{
 expect(inboundFailureDecision(new Error('TMS_HTTP_429'),'download_attachment',1).retry).toBe(true);
 expect(inboundFailureDecision(new Error('TMS_HTTP_503'),'list_attachments',2).retry).toBe(true);
 expect(inboundFailureDecision(new Error('TMS_HTTP_401'),'list_attachments',1).retry).toBe(false);
 expect(inboundFailureDecision(new Error('fetch failed'),'download_attachment',1).retry).toBe(true);
});
it('Tai collects documented additional-charge evidence without importing customer invoices or carrier compliance files',async()=>{
 const types=['Carrier Bill','POD','Carrier Confirmation','Accessorial Auth','Lumper Receipt','Return Receipt','Invoice','W9','Insurance'];
 const fetcher=vi.fn().mockResolvedValue(Response.json(types.map((attachmentType,index)=>({documentId:index+1,attachmentName:`${attachmentType}.pdf`,attachmentUrl:'https://acme.taicloud.net/file',attachmentType}))));
 const record=await new TaiClient({site:'acme',api_key:'secret'},fetcher).record('123');
 expect(record.documents.map(d=>d.filename)).toEqual(types.slice(0,6).map(t=>`${t}.pdf`));
});
