import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoseRocketClient} from '../../src/tms/rose-rocket.js';
import {decryptRoseCredentials,encryptRoseCredentials} from '../../src/tms/rose-rocket.credentials.js';

const account={orgId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',clientId:'customer-client',clientSecret:'private-customer-secret'};
afterEach(()=>vi.unstubAllEnvs());

describe('Rose Rocket customer connection',()=>{
 it('encrypts the entire service account and rejects tampering or another key',()=>{
  vi.stubEnv('ROSE_ROCKET_CREDENTIAL_KEY',Buffer.alloc(32,1).toString('base64url'));
  const stored=encryptRoseCredentials(account);
  expect(stored).not.toContain(account.clientSecret);
  expect(stored).not.toContain(account.orgId);
  expect(decryptRoseCredentials(stored)).toEqual(account);
  expect(()=>decryptRoseCredentials(stored.slice(0,-2)+'aa')).toThrow();
  vi.stubEnv('ROSE_ROCKET_CREDENTIAL_KEY',Buffer.alloc(32,2).toString('base64url'));
  expect(()=>decryptRoseCredentials(stored)).toThrow();
 });
 it('refuses customer secrets when the encryption key is absent',()=>{
  vi.stubEnv('ROSE_ROCKET_CREDENTIAL_KEY','');
  expect(()=>encryptRoseCredentials(account)).toThrow('ROSE_CREDENTIAL_KEY_REQUIRED');
 });
 it('verifies a service account using only the documented read-only request',async()=>{
  const fetcher=vi.fn(async (url:string,options:RequestInit)=>{
   if(url.endsWith('/oauth/token')){
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toMatchObject({org_id:account.orgId,user_id:account.userId});
    return Response.json({access_token:'test-token'});
   }
   expect(url).toBe('https://network.roserocket.com/api/v1/me');
   expect(options.method).toBe('GET');
   expect(options.headers).toEqual({Authorization:'Bearer test-token'});
   return Response.json({id:account.userId});
  });
  await new RoseRocketClient({account,fetcher:fetcher as unknown as typeof fetch}).verifyAccess();
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects access when Rose Rocket rejects verification',async()=>{
  const fetcher=vi.fn(async (url:string)=>url.endsWith('/oauth/token')?Response.json({access_token:'test-token'}):new Response('',{status:403}));
  await expect(new RoseRocketClient({account,fetcher:fetcher as unknown as typeof fetch}).verifyAccess()).rejects.toThrow('ROSE_ACCESS_HTTP_403');
 });
});
