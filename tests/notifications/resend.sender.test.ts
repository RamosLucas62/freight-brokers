import {it,expect,vi} from 'vitest';
import {ResendSender} from '../../src/notifications/resend.sender.js';

it('sends attachments through Resend with an idempotency key',async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'email-1'}),{status:200}));
 const sender=new ResendSender('key','reports@example.com',request);
 await expect(sender.send({idempotencyKey:'delivery-1',to:['ops@example.com'],subject:'Report',html:'<p>ok</p>',attachments:[{filename:'report.csv',content:Buffer.from('a,b')}]})).resolves.toBe('email-1');
 expect(request).toHaveBeenCalledWith('https://api.resend.com/emails',expect.objectContaining({method:'POST',headers:expect.objectContaining({'Idempotency-Key':'delivery-1'})}));
 const payload=JSON.parse(request.mock.calls[0][1].body);expect(payload.attachments[0].content).toBe(Buffer.from('a,b').toString('base64'));
});
