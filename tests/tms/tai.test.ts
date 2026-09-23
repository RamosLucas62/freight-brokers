import {afterEach,describe,expect,it,vi} from 'vitest';
import {TaiClient,TaiCredentials} from '../../src/tms/tai.js';
import {encryptTmsCredentials,decryptTmsCredentials,tmsCredentialsReady} from '../../src/tms/credentials.js';
afterEach(()=>vi.unstubAllEnvs());
describe('Tai connection verification',()=>{
 it('uses the documented read-only broker endpoint and API-key header',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json([]));
  await new TaiClient({site:'Acme',api_key:'secret'},fetcher).verifyAccess();
  expect(fetcher).toHaveBeenCalledWith('https://acme.taicloud.net/PublicApi/Broker/v2/ShipmentReferenceTypes',expect.objectContaining({method:'GET',redirect:'error',headers:{Accept:'application/json','x-api-key':'secret'}}));
 });
 it.each(['127.0.0.1','localhost:123','https://evil.com','x.taicloud.net@evil.com','../internal','a/b','a?b','a#b','a.b','-bad','bad-'])('rejects unsafe site %s',site=>{
  expect(()=>TaiCredentials.parse({site,api_key:'secret'})).toThrow();
 });
 it.each([401,403,429,500,302])('does not accept HTTP %s',async status=>{
  await expect(new TaiClient({site:'acme',api_key:'secret'},vi.fn().mockResolvedValue(new Response('',{status}))).verifyAccess()).rejects.toThrow(`TAI_ACCESS_HTTP_${status}`);
 });
 it.each([new Response('<html>Login</html>',{headers:{'content-type':'text/html'}}),Response.json({error:'invalid key'}),new Response('bad',{headers:{'content-type':'application/json'}}),new Response(null,{status:204})])('rejects misleading success responses',async response=>{
  await expect(new TaiClient({site:'acme',api_key:'secret'},vi.fn().mockResolvedValue(response)).verifyAccess()).rejects.toThrow();
 });
 it('bounds provider payloads and propagates timeouts',async()=>{
  const response=new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}});
  await expect(new TaiClient({site:'acme',api_key:'secret'},vi.fn().mockResolvedValue(response)).verifyAccess()).rejects.toThrow('TAI_RESPONSE_TOO_LARGE');
  await expect(new TaiClient({site:'acme',api_key:'secret'},vi.fn().mockRejectedValue(new Error('timeout'))).verifyAccess()).rejects.toThrow('timeout');
 });
});
describe('tenant-bound credential storage',()=>{
 it('encrypts and authenticates the company and provider as well as the ciphertext',()=>{
  vi.stubEnv('TMS_CREDENTIAL_KEY',Buffer.alloc(32,9).toString('base64url'));
  const value=encryptTmsCredentials('company-a','tai',{api_key:'private'});
  expect(value).not.toContain('private');expect(tmsCredentialsReady()).toBe(true);
  expect(decryptTmsCredentials('company-a','tai',value)).toEqual({api_key:'private'});
  expect(()=>decryptTmsCredentials('company-b','tai',value)).toThrow();
  expect(()=>decryptTmsCredentials('company-a','mcleod',value)).toThrow();
  expect(()=>decryptTmsCredentials('company-a','tai',value.slice(0,-5)+'AAAAA')).toThrow();
 });
 it('rejects missing and malformed keys before accepting credentials',()=>{
  for(const key of ['', 'not-a-key', Buffer.alloc(16).toString('base64url')]){
   vi.stubEnv('TMS_CREDENTIAL_KEY',key);expect(tmsCredentialsReady()).toBe(false);
   expect(()=>encryptTmsCredentials('company-a','tai',{})).toThrow();
  }
 });
});
