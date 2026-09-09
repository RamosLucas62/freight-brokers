import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createServer} from 'node:http';

const mocks=vi.hoisted(()=>({
 registerRequest:vi.fn(),saveAttachment:vi.fn(),markUploaded:vi.fn(),failUpload:vi.fn(),verifyRequest:vi.fn(),releaseOffer:vi.fn(),
 inspectRetry:vi.fn(),beginRetry:vi.fn(),finishRetry:vi.fn(),failRetry:vi.fn(),clearAttachments:vi.fn(),loadAttachments:vi.fn(),
 putInvoiceObject:vi.fn(),deleteInvoiceObjects:vi.fn(),sendSecurityEmail:vi.fn(),verifyTurnstile:vi.fn(),
 createCheckoutSession:vi.fn(),
 publicResult:vi.fn(),recordFunnelEvent:vi.fn(),recordCheckoutStarted:vi.fn(),unsubscribe:vi.fn(),
}));
vi.mock('../../src/free-audit/repository.js',()=>({...mocks,claimRequest:vi.fn(),saveResult:vi.fn(),finishRequest:vi.fn(),claimExpired:vi.fn(),expireRequest:vi.fn(),failExpiration:vi.fn(),issueRetry:vi.fn()}));
vi.mock('../../src/security/turnstile.js',()=>({verifyTurnstile:mocks.verifyTurnstile}));
vi.mock('../../src/storage/r2.js',()=>({freeAuditObjectKey:(r:string,a:string)=>`free-audits/${r}/${a}.pdf`,putInvoiceObject:mocks.putInvoiceObject,deleteInvoiceObjects:mocks.deleteInvoiceObjects}));
vi.mock('../../src/notifications/security.sender.js',()=>({sendSecurityEmail:mocks.sendSecurityEmail}));
vi.mock('../../src/billing/stripe.js',()=>({createCheckoutSession:mocks.createCheckoutSession}));
import {createFreeAuditHttpHandler} from '../../src/free-audit/http.js';

const limiter={consume:vi.fn(async()=>({allowed:true,limit:3,remaining:2,retryAfter:60})),close:vi.fn(async()=>{})};
let server:ReturnType<typeof createServer>;let base:string;
beforeEach(async()=>{
 vi.clearAllMocks();vi.stubEnv('RATE_LIMIT_KEY_SECRET','x'.repeat(32));mocks.verifyTurnstile.mockResolvedValue(true);mocks.createCheckoutSession.mockResolvedValue({url:'https://checkout.stripe.test/session'});mocks.deleteInvoiceObjects.mockResolvedValue(undefined);mocks.failUpload.mockResolvedValue(undefined);mocks.loadAttachments.mockResolvedValue([]);mocks.recordFunnelEvent.mockResolvedValue(undefined);mocks.recordCheckoutStarted.mockResolvedValue(undefined);
 const handler=createFreeAuditHttpHandler({allowedOrigins:['https://aiolympian.com','https://www.aiolympian.com'],publicUrl:'https://api.audit.aiolympian.com',offerUrl:'https://aiolympian.com/pricing'});
 server=createServer((req,res)=>void handler(req,res,limiter));await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();});
function form(){const value=new FormData();value.set('name','Lucas Ramos');value.set('company','Olympian');value.set('email','Lucas@Example.com');value.set('phone','+1 555 000 0000');value.set('loads_per_month','101-500');value.set('consent','true');value.set('turnstile_token','verified');value.append('files',new Blob([Buffer.from('%PDF-1.4 test')],{type:'application/pdf'}),'invoice.pdf');return value;}

describe('free audit public boundary',()=>{
 it('creates Stripe checkout from the public pricing origin',async()=>{
  const response=await fetch(base+'/checkout',{method:'POST',headers:{Origin:'https://aiolympian.com','Content-Type':'application/json'},body:JSON.stringify({email:'Buyer@Example.com',plan:'growth',period:'annual',turnstile_token:'verified'})});
  expect(response.status).toBe(200);expect(response.headers.get('access-control-allow-origin')).toBe('https://aiolympian.com');expect(await response.json()).toEqual({url:'https://checkout.stripe.test/session'});expect(mocks.createCheckoutSession).toHaveBeenCalledWith('buyer@example.com','growth','annual');
 });
 it('rejects checkout requests from untrusted origins',async()=>{
  const response=await fetch(base+'/checkout',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});expect(response.status).toBe(403);expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
 });
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
  const response=await fetch(base+`/free-audit/verify?token=${token}`);expect(response.status).toBe(200);expect(await response.text()).toContain('audit is underway');expect(mocks.verifyRequest).toHaveBeenCalledOnce();
 });
 it('renders a branded confirmation page compatible with the restrictive CSP',async()=>{
  mocks.verifyRequest.mockResolvedValue('11111111-1111-4111-8111-111111111111');const response=await fetch(base+`/free-audit/verify?token=${'a'.repeat(43)}`);const html=await response.text();
  expect(html).toContain('Your audit is underway');expect(html).toContain('class="card"');expect(response.headers.get('content-security-policy')).toMatch(/style-src 'nonce-[A-Za-z0-9_-]+'/);
 });
 it('lets a failed verified lead upload replacement files without entering contact data again',async()=>{
  const token='b'.repeat(43);mocks.inspectRetry.mockResolvedValue(true);mocks.beginRetry.mockResolvedValue('11111111-1111-4111-8111-111111111111');mocks.finishRetry.mockResolvedValue(undefined);
  const opened=await fetch(base+`/free-audit/retry?token=${token}`);const uploadPage=await opened.text();expect(uploadPage).toContain('Your name, company, email and audit details are already saved');expect(uploadPage).not.toContain('name="email"');
  const replacement=new FormData();replacement.append('files',new Blob([Buffer.from('%PDF-1.4 replacement')],{type:'application/pdf'}),'replacement.pdf');
  const uploaded=await fetch(base+`/free-audit/retry?token=${token}`,{method:'POST',body:replacement});expect(uploaded.status).toBe(200);expect(await uploaded.text()).toContain('Your new files are in');
  expect(mocks.beginRetry).toHaveBeenCalledOnce();expect(mocks.putInvoiceObject).toHaveBeenCalledOnce();expect(mocks.finishRetry).toHaveBeenCalledOnce();expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
 });
 it('does not expose the replacement form for an expired retry token',async()=>{
  mocks.inspectRetry.mockResolvedValue(false);const response=await fetch(base+`/free-audit/retry?token=${'c'.repeat(43)}`);expect(response.status).toBe(400);expect(await response.text()).not.toContain('type="file"');
 });
 it('renders the private result, product bridge and recommended plan',async()=>{const token='d'.repeat(43);mocks.publicResult.mockResolvedValue({id:'11111111-1111-4111-8111-111111111111',company_name:'Acme',recommended_plan:'growth',result:{run_id:'r',generated_at:new Date().toISOString(),total_invoices_processed:6,total_exceptions:2,valor_total_under_review:10855,exceptions:[{invoice_id:'i',tipo_regra:'DUPLICATE',rule_label:'Duplicate billing',valor_envolvido:100,descricao:'review',source_reference:{file:'private.pdf',page:1},metadata:{}}]}});const response=await fetch(base+`/free-audit/result?token=${token}`);const html=await response.text();expect(response.status).toBe(200);expect(html).toContain('$10,855');expect(html).toContain('Invoice + rate con + POD');expect(html).toContain('accessorial verification');expect(html).toContain('Growth');expect(html).not.toContain('private.pdf');expect(mocks.recordFunnelEvent).toHaveBeenCalledWith(expect.any(String),'result_opened');});
 it('protects report downloads with the private token',async()=>{mocks.publicResult.mockResolvedValue(null);const response=await fetch(base+`/free-audit/result?token=${'e'.repeat(43)}&format=pdf`);expect(response.status).toBe(404);expect(response.headers.get('cache-control')).toBe('no-store');});
});
