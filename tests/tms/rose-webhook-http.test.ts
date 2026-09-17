import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createApp} from '../../src/http/app.js';
const resendSecret='whsec_'+Buffer.from('test-secret-32-bytes-long-12345678').toString('base64');
const token='rose_webhook_test_token_1234567890123456789012345678901234567890';
const org='11111111-1111-4111-8111-111111111111';
const event={id:'55555555-5555-4555-8555-555555555555',type:'Order Status Changed',refId:'33333333-3333-4333-8333-333333333333',
 ownerId:'22222222-2222-4222-8222-222222222222',orgId:org,createdAt:'2026-09-17T16:00:00Z',objectKey:'order',json:{status:'delivered'}};
const enqueue=vi.fn(async()=> 'queued' as const);
let server:ReturnType<typeof createApp>;let base:string;
beforeEach(async()=>{
 enqueue.mockReset();enqueue.mockResolvedValue('queued');
 server=createApp({secret:resendSecret,enqueue:async()=>{},ready:async()=>true,roseWebhook:{token,orgId:org,enqueue}});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
function send(path:string,body=JSON.stringify(event)){return fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body});}

describe('Rose Rocket webhook ingress',()=>{
 it('accepts only the configured URL token and durably enqueues a scoped order event',async()=>{
  expect((await send(`/webhooks/rose-rocket/${token}`)).status).toBe(202);
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({id:event.id,orgId:org}));
  expect((await send('/webhooks/rose-rocket/not-the-token')).status).toBe(401);
  expect(enqueue).toHaveBeenCalledTimes(1);
 });
 it('ignores a different organization and non-order events',async()=>{
  expect((await send(`/webhooks/rose-rocket/${token}`,JSON.stringify({...event,orgId:'99999999-9999-4999-8999-999999999999'}))).status).toBe(202);
  expect((await send(`/webhooks/rose-rocket/${token}`,JSON.stringify({...event,objectKey:'invoice'}))).status).toBe(200);
  expect(enqueue).not.toHaveBeenCalled();
 });
 it('returns retryable status on queue failure and rejects oversized bodies',async()=>{
  enqueue.mockRejectedValueOnce(new Error('private database details'));
  const failed=await send(`/webhooks/rose-rocket/${token}`);
  expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('private');
  expect((await send(`/webhooks/rose-rocket/${token}`,'x'.repeat(64*1024+1))).status).toBe(413);
 });
 it('acknowledges duplicate events without enqueuing them again',async()=>{
  enqueue.mockResolvedValueOnce('duplicate');
  const response=await send(`/webhooks/rose-rocket/${token}`);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({status:'ignored'});
 });
 it('has no active endpoint when the pilot is not configured',async()=>{
  const inactive=createApp({secret:resendSecret,enqueue:async()=>{},ready:async()=>true});
  await new Promise<void>((resolve,reject)=>{inactive.once('error',reject);inactive.listen(0,'127.0.0.1',resolve);});
  try{
   const url=`http://127.0.0.1:${(inactive.address() as {port:number}).port}/webhooks/rose-rocket/${token}`;
   expect((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)})).status).toBe(404);
  }finally{inactive.closeAllConnections();await new Promise<void>(resolve=>inactive.close(()=>resolve()));}
 });
 it('does not pass non-POST secret URLs to other route handlers',async()=>{
  const response=await fetch(`${base}/webhooks/rose-rocket/${token}`);
  expect(response.status).toBe(405);
  expect(enqueue).not.toHaveBeenCalled();
 });
});
