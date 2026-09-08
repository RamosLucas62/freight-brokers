import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createServer} from 'node:http';

const mocks=vi.hoisted(()=>({
 registerRequest:vi.fn(),saveAttachment:vi.fn(),markUploaded:vi.fn(),failUpload:vi.fn(),verifyRequest:vi.fn(),releaseOffer:vi.fn(),
 putInvoiceObject:vi.fn(),deleteInvoiceObjects:vi.fn(),sendSecurityEmail:vi.fn(),verifyTurnstile:vi.fn(),
}));
vi.mock('../../src/free-audit/repository.js',()=>({...mocks,claimRequest:vi.fn(),loadAttachments:vi.fn(),saveResult:vi.fn(),finishRequest:vi.fn(),claimExpired:vi.fn(),expireRequest:vi.fn(),failExpiration:vi.fn()}));
vi.mock('../../src/security/turnstile.js',()=>({verifyTurnstile:mocks.verifyTurnstile}));
vi.mock('../../src/storage/r2.js',()=>({freeAuditObjectKey:(r:string,a:string)=>`free-audits/${r}/${a}.pdf`,putInvoiceObject:mocks.putInvoiceObject,deleteInvoiceObjects:mocks.deleteInvoiceObjects}));
vi.mock('../../src/notifications/security.sender.js',()=>({sendSecurityEmail:mocks.sendSecurityEmail}));
import {createFreeAuditHttpHandler} from '../../src/free-audit/http.js';

const limiter={consume:vi.fn(async()=>({allowed:true,limit:3,remaining:2,retryAfter:60})),close:vi.fn(async()=>{})};
let server:ReturnType<typeof createServer>;let base:string;
beforeEach(async()=>{
 vi.clearAllMocks();vi.stubEnv('RATE_LIMIT_KEY_SECRET','x'.repeat(32));mocks.verifyTurnstile.mockResolvedValue(true);mocks.deleteInvoiceObjects.mockResolvedValue(undefined);mocks.failUpload.mockResolvedValue(undefined);
 const handler=createFreeAuditHttpHandler({allowedOrigins:['https://aiolympian.com','https://www.aiolympian.com'],publicUrl:'https://api.audit.aiolympian.com',offerUrl:'https://aiolympian.com/pricing'});
 server=createServer((req,res)=>void handler(req,res,limiter));await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();});
function form(){const value=new FormData();value.set('name','Lucas Ramos');value.set('company','Olympian');value.set('email','Lucas@Example.com');value.set('phone','+1 555 000 0000');value.set('loads_per_month','101-500');value.set('consent','true');value.set('turnstile_token','verified');value.append('files',new Blob([Buffer.from('%PDF-1.4 test')],{type:'application/pdf'}),'invoice.pdf');return value;}

describe('free audit public boundary',()=>{
 it('stores PDFs and sends verification only for a first request',async()=>{
  mocks.registerRequest.mockResolvedValue({request_id:'11111111-1111-4111-8111-111111111111',action:'created',offer_allowed:false,offer_number:0});
  const response=await fetch(base+'/webhooks/free-audit',{method:'POST',headers:{Origin:'https://aiolympian.com'},body:form()});
 expect(response.status).toBe(202);expect(mocks.registerRequest).toHaveBeenCalledWith(expect.objectContaining({email:'lucas@example.com'}));expect(mocks.putInvoiceObject).toHaveBeenCalledOnce();expect(mocks.markUploaded).toHaveBeenCalledOnce();expect(mocks.sendSecurityEmail).toHaveBeenCalledWith(expect.objectContaining({to:'lucas@example.com',subject:expect.stringContaining('Confirm')}));
 });
 it('allows the configured www origin and returns matching CORS headers',async()=>{
  mocks.registerRequest.mockResolvedValue({request_id:'11111111-1111-4111-8111-111111111111',action:'created',offer_allowed:false,offer_number:0});
  const response=await fetch(base+'/webhooks/free-audit',{method:'POST',headers:{Origin:'https://www.aiolympian.com'},body:form()});
  expect(response.status).toBe(202);expect(response.headers.get('access-control-allow-origin')).toBe('https://www.aiolympian.com');
 });
 it('answers preflight for each configured origin',async()=>{
  for(const origin of ['https://aiolympian.com','https://www.aiolympian.com']){
   const response=await fetch(base+'/webhooks/free-audit',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST'}});
   expect(response.status).toBe(204);expect(response.headers.get('access-control-allow-origin')).toBe(origin);expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  }
 });
 it('does not store repeat uploads and sends the paid-plan offer',async()=>{
  mocks.registerRequest.mockResolvedValue({request_id:'11111111-1111-4111-8111-111111111111',action:'repeat',offer_allowed:true,offer_number:1});
  const response=await fetch(base+'/webhooks/free-audit',{method:'POST',headers:{Origin:'https://aiolympian.com'},body:form()});
  expect(response.status).toBe(202);expect(mocks.putInvoiceObject).not.toHaveBeenCalled();expect(mocks.sendSecurityEmail).toHaveBeenCalledWith(expect.objectContaining({subject:expect.stringContaining('already been used')}));
 });
 it('rejects a different browser origin and never reads the submission',async()=>{
  const response=await fetch(base+'/webhooks/free-audit',{method:'POST',headers:{Origin:'https://evil.example'},body:form()});expect(response.status).toBe(403);expect(mocks.registerRequest).not.toHaveBeenCalled();
 });
 it('returns actionable guidance for an invalid document without exposing internals',async()=>{
  mocks.registerRequest.mockResolvedValue({request_id:'11111111-1111-4111-8111-111111111111',action:'created',offer_allowed:false,offer_number:0});const invalid=form();invalid.delete('files');invalid.append('files',new Blob([Buffer.from('not a pdf')],{type:'application/pdf'}),'broken.pdf');
  const response=await fetch(base+'/webhooks/free-audit',{method:'POST',headers:{Origin:'https://aiolympian.com'},body:invalid});expect(response.status).toBe(400);expect(await response.json()).toEqual(expect.objectContaining({error:'pdfs_only',message:expect.stringContaining('valid, unencrypted PDF')}));
 });
 it('queues the audit only for a valid one-time confirmation token',async()=>{
  mocks.verifyRequest.mockResolvedValue('11111111-1111-4111-8111-111111111111');const token='a'.repeat(43);
  const response=await fetch(base+`/free-audit/verify?token=${token}`);expect(response.status).toBe(200);expect(await response.text()).toContain('audit has started');expect(mocks.verifyRequest).toHaveBeenCalledOnce();
 });
});
