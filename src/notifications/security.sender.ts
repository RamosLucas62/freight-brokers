export async function sendSecurityEmail(input:{to:string;subject:string;html:string;idempotencyKey:string}):Promise<void>{
 const key=process.env.RESEND_API_KEY;const from=process.env.RESEND_FROM_EMAIL;
 if(!key||!from)throw new Error('SECURITY_EMAIL_NOT_CONFIGURED');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':input.idempotencyKey},body:JSON.stringify({from,to:[input.to],subject:input.subject,html:input.html}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`SECURITY_EMAIL_FAILED_${response.status}`);
}
