import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {Webhook} from 'svix';
import {createApp} from '../../src/http/app.js';
const secret='whsec_'+Buffer.from('test-secret-32-bytes-long-12345678').toString('base64');
let server:ReturnType<typeof createApp>;let base:string;
const enqueue=vi.fn(async()=>{});
beforeEach(async()=>{
 enqueue.mockReset();server=createApp({secret,enqueue,ready:async()=>true});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
function signed(body:string,date=new Date()) {const id='msg_test';return {'content-type':'application/json','svix-id':id,'svix-timestamp':String(Math.floor(date.getTime()/1000)),'svix-signature':new Webhook(secret).sign(id,date,body)};}
const body=JSON.stringify({type:'email.received',data:{email_id:'11111111-1111-4111-8111-111111111111',to:['test@audit.aiolympian.com']}});
describe('HTTP webhook boundary',()=>{
 it('accepts verified events only after durable enqueue',async()=>{
  const r=await fetch(base+'/webhooks/resend',{method:'POST',headers:signed(body),body});expect(r.status).toBe(200);expect(enqueue).toHaveBeenCalledOnce();
 });
 it('rejects tampered bodies',async()=>{
  const r=await fetch(base+'/webhooks/resend',{method:'POST',headers:signed(body),body:body+' '});expect(r.status).toBe(401);expect(enqueue).not.toHaveBeenCalled();
 });
 it('rejects old signed replays',async()=>{
  const r=await fetch(base+'/webhooks/resend',{method:'POST',headers:signed(body,new Date(Date.now()-600000)),body});expect(r.status).toBe(401);
 });
 it('returns retryable failure when persistence fails',async()=>{
  enqueue.mockRejectedValueOnce(new Error('private database details'));const r=await fetch(base+'/webhooks/resend',{method:'POST',headers:signed(body),body});expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');
 });
 it('provides health without disclosing configuration',async()=>{expect(await (await fetch(base+'/healthz')).json()).toEqual({status:'ok'});});
 it('rejects oversized requests before signature processing',async()=>{
  const r=await fetch(base+'/webhooks/resend',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(256*1024+1)});expect(r.status).toBe(413);expect(enqueue).not.toHaveBeenCalled();
 });
});
