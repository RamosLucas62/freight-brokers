export interface EmailAttachment {filename:string;content:Buffer;}
import {readResponseBody} from '../security/http.js';

export class ResendSender {
 constructor(private apiKey:string,private from:string,private request:typeof fetch=fetch){}
 async send(input:{idempotencyKey:string;to:string[];subject:string;html:string;attachments:EmailAttachment[]}):Promise<string>{
  const response=await this.request('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json','Idempotency-Key':input.idempotencyKey},
   body:JSON.stringify({from:this.from,to:input.to,subject:input.subject,html:input.html,
    attachments:input.attachments.map(a=>({filename:a.filename,content:a.content.toString('base64')}))}),
   signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw new Error(`RESEND_SEND_FAILED_${response.status}`);
  const result=JSON.parse((await readResponseBody(response,256*1024)).toString('utf8')) as {id?:string};
  if(!result.id)throw new Error('RESEND_SEND_INVALID_RESPONSE');
  return result.id;
 }
}
