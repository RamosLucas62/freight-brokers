import {describe,it,expect,vi} from 'vitest';
import {RoseRocketClient,roseEventHint} from '../../src/tms/rose-rocket.js';
import {readRosePilotDocuments,roseAuditStatus} from '../../src/tms/rose-rocket.pilot.js';
import type {AuditReport} from '../../src/types/report.types.js';

const org='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const order='33333333-3333-4333-8333-333333333333';
const doc='44444444-4444-4444-8444-444444444444';
const eventId='55555555-5555-4555-8555-555555555555';
const account={clientId:'client-test',clientSecret:'secret-test',orgId:org,userId:user};
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n');
const object={id:order,orgId:org,objectKey:'order',documents:[{id:doc,documentType:'proofOfDelivery',externalUrl:`/api/v2/platformModel/documents/presignedUrl/${doc}`,fileName:'pod.pdf'}]};
function client(fetcher:typeof fetch){return new RoseRocketClient({account,fetcher});}

describe('Rose Rocket Platform v2 pilot boundary',()=>{
 it('authenticates as a service account, scopes objects, and downloads PDFs',async()=>{
  const fetcher=vi.fn(async (url:string,init:RequestInit)=>{
   if(url.endsWith('/oauth/token')){
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({grant_type:'client_credentials',org_id:org,user_id:user});
    return Response.json({access_token:'test-access',expires_in:3600});
   }
   expect(init.headers).toEqual({Authorization:'Bearer test-access'});
   expect(init.redirect).toBe('error');
   if(url.includes('/objects/'))return Response.json(object);
   if(url.includes('/documents/'))return new Response(pdf,{headers:{'content-type':'application/pdf'}});
   throw new Error('unexpected request');
  });
  const documents=await readRosePilotDocuments(client(fetcher as unknown as typeof fetch),[{key:'order',id:order}]);
  expect(documents).toEqual([{objectKey:'order',objectId:order,documentId:doc,documentType:'proofOfDelivery',filename:'pod.pdf',bytes:pdf}]);
  expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('rejects records from another organization before reading their documents',async()=>{
  const fetcher=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'token'}):Response.json({...object,orgId:user}));
  await expect(readRosePilotDocuments(client(fetcher as unknown as typeof fetch),[{key:'order',id:order}])).rejects.toThrow('ROSE_OBJECT_SCOPE_MISMATCH');
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('recognizes a generated carrier bill without treating receivables as carrier invoices',async()=>{
  const bill={...object,objectKey:'bill',documents:[{id:doc,externalUrl:`/api/v2/platformModel/documents/bill/${order}/pdf`}]};
  const fetcher=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'token'}):url.includes('/objects/')?Response.json(bill):new Response(pdf));
  const documents=await readRosePilotDocuments(client(fetcher as unknown as typeof fetch),[{key:'bill',id:order}]);
  expect(documents).toMatchObject([{documentType:'bill',documentId:doc}]);
  const receivable={...bill,objectKey:'invoice',documents:[{id:doc,documentType:'invoice',externalUrl:`/api/v2/platformModel/documents/invoice/${order}/pdf`}]};
  const other=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'token'}):Response.json(receivable));
  expect(await readRosePilotDocuments(client(other as unknown as typeof fetch),[{key:'invoice',id:order}])).toEqual([]);
  expect(other).toHaveBeenCalledTimes(2);
 });
 it('rejects external document URLs and redirects',async()=>{
  const fetcher=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'token'}):Response.redirect('https://untrusted.example/document'));
  const api=client(fetcher as unknown as typeof fetch);
  await expect(api.downloadPdf({...object.documents[0],externalUrl:'https://untrusted.example/document'})).rejects.toThrow('ROSE_DOCUMENT_URL_UNSUPPORTED');
  await expect(api.downloadPdf(object.documents[0])).rejects.toThrow('ROSE_API_HTTP_302');
 });
 it('does not accept a non-PDF response',async()=>{
  const fetcher=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'token'}):new Response('not a pdf'));
  await expect(client(fetcher as unknown as typeof fetch).downloadPdf(object.documents[0])).rejects.toThrow('ROSE_DOCUMENT_NOT_PDF');
 });
 it('re-authenticates once after an expired access token',async()=>{
  let auth=0;let reads=0;
  const fetcher=vi.fn(async (url:string)=>{
   if(url.endsWith('/oauth/token'))return Response.json({access_token:`token-${++auth}`,expires_in:3600});
   reads++;return reads===1?new Response('',{status:401}):Response.json(object);
  });
  expect((await client(fetcher as unknown as typeof fetch).getObject('order',order)).id).toBe(order);
  expect(auth).toBe(2);expect(reads).toBe(2);
 });
 it('permits only HTTPS Rose Rocket API origins',()=>{
  expect(()=>new RoseRocketClient({account,apiOrigin:'https://customer.roserocket.com/'})).not.toThrow();
  expect(()=>new RoseRocketClient({account,apiOrigin:'https://customer.roserocket.com.evil.example/'})).toThrow('ROSE_INVALID_ORIGIN');
  expect(()=>new RoseRocketClient({account,apiOrigin:'http://network.roserocket.com/'})).toThrow('ROSE_INVALID_ORIGIN');
 });
 it('accepts only a scoped, documented order-status event as a refetch hint',()=>{
  const event={id:eventId,type:'Order Status Changed',refId:order,ownerId:user,orgId:org,createdAt:'2026-09-17T16:00:00Z',objectKey:'order',json:{status:'delivered'}};
  expect(roseEventHint(event,org)).toEqual({eventId,orderId:order,occurredAt:event.createdAt});
  expect(roseEventHint({...event,type:'Another Order Event'},org)?.orderId).toBe(order);
  expect(roseEventHint({...event,objectKey:'invoice'},org)).toBeNull();
  expect(()=>roseEventHint({...event,orgId:user},org)).toThrow('ROSE_EVENT_SCOPE_MISMATCH');
 });
 it('keeps the output status local and requires review when evidence is uncertain',()=>{
  const report={run_id:eventId,generated_at:'2026-09-17T16:00:00Z',total_invoices_processed:1,total_exceptions:0,confidence:{verified:0,review:1,unverifiable:0,quality_control_samples:0,automation_rate:0,field_statuses:{verified:0,review:1,unverifiable:0}}} as AuditReport;
  expect(roseAuditStatus(report).status).toBe('needs_review');
  expect(roseAuditStatus({...report,confidence:undefined}).status).toBe('audited');
  expect(roseAuditStatus({...report,total_invoices_processed:0,confidence:undefined}).status).toBe('needs_review');
 });
});
