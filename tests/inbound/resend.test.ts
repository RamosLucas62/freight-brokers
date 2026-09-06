import {describe,it,expect,vi} from 'vitest';
import {ResendReceivingClient,limitedBody} from '../../src/inbound/resend.js';
import {ReceivedEvent,recipientAliases} from '../../src/inbound/events.js';
const id='11111111-1111-4111-8111-111111111111';
const attachment={id,filename:'../../invoice.pdf',content_type:'application/pdf',size:10,download_url:'https://inbound-cdn.resend.com/file?signature=test'};
describe('Resend receiving',()=>{
 it('routes to, cc and bcc once and ignores foreign domains and received_for',()=>{
  const event=ReceivedEvent.parse({type:'email.received',data:{email_id:id,to:['TEST@AUDIT.AIOLYMPIAN.COM'],cc:['test@audit.aiolympian.com','a@evil.com'],bcc:['other@audit.aiolympian.com'],received_for:['forged@audit.aiolympian.com']}});
  expect(recipientAliases(event)).toEqual(['test','other']);
 });
 it('downloads PDF bytes without forwarding API credentials',async()=>{
  const request=vi.fn().mockResolvedValue(new Response('%PDF-1.4 test'));
  const result=await new ResendReceivingClient('secret',request).download(attachment);
  expect(result.toString()).toContain('%PDF');expect(request.mock.calls[0][1].headers).toBeUndefined();
  expect(request.mock.calls[0][1].redirect).toBe('error');
 });
 it.each(['http://inbound-cdn.resend.com/a','https://127.0.0.1/a','https://inbound-cdn.resend.com.evil.com/a','https://user:pass@inbound-cdn.resend.com/a'])('rejects download host %s',async url=>{
  const request=vi.fn();await expect(new ResendReceivingClient('s',request).download({...attachment,download_url:url})).rejects.toThrow('UNTRUSTED');expect(request).not.toHaveBeenCalled();
 });
 it('rejects non-PDF bytes',async()=>await expect(new ResendReceivingClient('s',vi.fn().mockResolvedValue(new Response('html'))).download(attachment)).rejects.toThrow('INVALID_PDF'));
 it('bounds actual streaming bytes even without content length',async()=>await expect(limitedBody(new Response('123456'),5)).rejects.toThrow('TOO_LARGE'));
 it('rejects pagination instead of silently dropping attachments',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({has_more:true,data:[]}));
  await expect(new ResendReceivingClient('s',request).attachments(id)).rejects.toThrow('TOO_MANY');
 });
 it('accepts machine-generated invoice emails',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({headers:{'Auto-Submitted':'auto-generated'}}));
  expect(await new ResendReceivingClient('s',request).isAutomatic(id)).toBe(false);
 });
 it('recognizes autoresponders from actual message headers',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({headers:{'Auto-Submitted':'auto-replied'}}));
  expect(await new ResendReceivingClient('s',request).isAutomatic(id)).toBe(true);
 });
});
