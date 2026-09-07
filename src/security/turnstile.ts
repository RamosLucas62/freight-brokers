import {z} from 'zod';

export async function verifyTurnstile(token:string|undefined,ip:string):Promise<boolean>{
 const secret=process.env.TURNSTILE_SECRET_KEY;
 if(!secret)return process.env.NODE_ENV!=='production';
 if(!token)return false;
 try{
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret,response:token,remoteip:ip}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)return false;
  return z.object({success:z.boolean()}).parse(await response.json()).success;
 }catch{return false;}
}
