import {IncomingMessage, ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {adminAction} from './admin.js';
import {buildCrmFunnel,type CrmBillingRow,type CrmFollowupRow,type CrmLeadRow} from './crm.js';
import {getSupabaseClient,timedFetch} from '../config/supabase.js';
import {applyRetentionDiscount,cancelSubscriptionAtPeriodEnd,createBillingPortalSession,pauseSubscriptionOneMonth,retrieveCheckoutSession,retrieveSubscription} from '../billing/stripe.js';
import type {RateLimiter,RateLimitRule} from '../security/rate-limit.js';
import {clientIp,privacyKey} from '../security/rate-limit.js';
import {verifyTurnstile} from '../security/turnstile.js';
import {readBody,securityHeaders,HttpError} from '../security/http.js';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {sendSecurityEmail} from '../notifications/security.sender.js';
import {notifyLeadFunnel,notifySupportRequest} from '../notifications/google-chat.sender.js';
import {plans,planFromMetadata,periodFromMetadata,selectionFromSubscription} from '../billing/plans.js';
import {failure,info,requestId} from '../observability/logger.js';
import {PORTAL_ACCEPTANCE_TEXT,PRIVACY_VERSION,TERMS_VERSION} from '../legal/consent.js';
import {RoseRocketClient} from '../tms/rose-rocket.js';
import {encryptRoseCredentials} from '../tms/rose-rocket.credentials.js';
import {answerPortalSupport} from '../free-audit/support.js';

const uuid=z.string().uuid();
async function body(req:IncomingMessage) {
 return JSON.parse((await readBody(req,16384)).toString('utf8'));
}
function verifiedAal(token:string):'aal1'|'aal2'{
 try{const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));return payload.aal==='aal2'?'aal2':'aal1';}catch{return 'aal1';}
}
function confirmationContacts(emails:string[]){return emails.map(email=>{const token=randomBytes(32).toString('base64url');return {email,token,token_hash:createHash('sha256').update(token).digest('hex')};});}
function csrfToken(session:string):string{
 const nonce=randomBytes(24).toString('base64url');const secret=process.env.CSRF_SECRET;if(!secret)return nonce;
 return `${nonce}.${createHmac('sha256',secret).update(`${nonce}.${privacyKey(session)}`).digest('base64url')}`;
}
function validCsrf(req:IncomingMessage,session:string):boolean{
 const secret=process.env.CSRF_SECRET;if(!secret)return process.env.NODE_ENV!=='production';
 const header=typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:'';
 const name=process.env.NODE_ENV==='production'?'__Host-audit_csrf':'audit_csrf';const raw=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${name}=`))?.slice(name.length+1);const cookie=raw?decodeURIComponent(raw):'';
 const [nonce,signature]=cookie.split('.',2);if(!nonce||!signature||header!==cookie)return false;
 const expected=createHmac('sha256',secret).update(`${nonce}.${privacyKey(session)}`).digest('base64url');const a=Buffer.from(signature);const b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
async function sendConfirmations(items:{email:string;token:string}[],origin:string){
 await Promise.all(items.map(item=>sendSecurityEmail({to:item.email,subject:'Confirm your freight audit report email',idempotencyKey:`report-contact-${createHash('sha256').update(item.token).digest('hex')}`,html:`<h1>Confirm report delivery</h1><p>This address was added to receive freight invoice risk reports.</p><p><a href="${new URL(`/verify-recipient?token=${encodeURIComponent(item.token)}`,origin).href}">Confirm this email address</a></p><p>This link expires in 30 minutes. If you did not expect it, ignore this message.</p>`})));
}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
async function notifyOwner(email:string|undefined,tenant:string,summary:string){
 if(!email)return;await sendSecurityEmail({to:email,subject:'Security change to your Freight Audit account',idempotencyKey:`security-change-${tenant}-${createHash('sha256').update(summary).digest('hex').slice(0,32)}-${Math.floor(Date.now()/300000)}`,html:`<h1>Account security change</h1><p>${escapeHtml(summary)}</p><p>If you did not make this change, contact support and revoke portal access immediately.</p>`});
}
function stripeId(value:string|{id?:string}|null|undefined):string{return typeof value==='string'?value:value?.id??'';}
async function onboardingSubscription(sessionId:string){
 const checkout=await retrieveCheckoutSession(sessionId);
 const subscriptionId=stripeId(checkout.subscription);const customerId=stripeId(checkout.customer);
 const checkoutComplete=checkout.status==='complete'&&Boolean(subscriptionId)&&Boolean(customerId);
 const subscription=checkoutComplete?await retrieveSubscription(subscriptionId):null;
 const customerMatches=Boolean(subscription)&&subscription?.id===subscriptionId&&stripeId(subscription?.customer)===customerId;
 const validTrial=customerMatches&&subscription?.status==='trialing'&&Number(subscription.trial_end)>Date.now()/1000;
 const paidAndActive=customerMatches&&checkout.payment_status==='paid'&&subscription?.status==='active';
 const selection=selectionFromSubscription(subscription)??{plan:planFromMetadata(checkout.metadata?.plan_code),period:periodFromMetadata(checkout.metadata?.billing_period)};
 return {checkout,subscription,subscriptionId,customerId,checkoutComplete,validTrial,paidAndActive,selection};
}
async function sendWelcomeEmail(input:{email:string;company:string;plan:string;accessUrl:string;sessionId:string;trialEndsAt?:Date}){
 const button='display:inline-block;background:#f4512c;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border:2px solid #111;border-radius:6px;box-shadow:4px 4px 0 #111';
 const subscriptionCopy=input.trialEndsAt
  ?`Your 7-day free trial of the ${escapeHtml(input.plan)} plan for <strong>${escapeHtml(input.company)}</strong> has started. Your first charge is scheduled for ${escapeHtml(input.trialEndsAt.toLocaleDateString('en-US',{dateStyle:'long',timeZone:'UTC'}))}, unless you cancel before then.`
  :`Your ${escapeHtml(input.plan)} subscription for <strong>${escapeHtml(input.company)}</strong> is active and your secure workspace is ready.`;
 await sendSecurityEmail({
  to:input.email,subject:'Your Olympian account is ready',idempotencyKey:`portal-welcome-${createHash('sha256').update(input.sessionId).digest('hex').slice(0,40)}`,
  html:`<h1>Welcome to Olympian</h1><p>${subscriptionCopy}</p><p><a href="${escapeHtml(input.accessUrl)}" style="${button}">Access the platform</a></p><p>This private link signs you in and expires for your protection. If it expires, request a new access link on the portal using ${escapeHtml(input.email)}.</p><p>If you did not create this subscription, contact support immediately.</p>`,
 });
}
export async function dashboard(req:IncomingMessage,res:ServerResponse,limiter:RateLimiter):Promise<boolean>{
 const url=new URL(req.url??'/', 'http://localhost');
 let operation:string|undefined;
 const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/onboarding':['index.html','text/html'],'/onboarding/thanks':['index.html','text/html'],'/verify-recipient':['index.html','text/html'],'/auth/callback':['index.html','text/html'],'/dashboard.js':['dashboard.js','text/javascript'],'/dashboard.css':['dashboard.css','text/css'],'/admin.js':['admin.js','text/javascript']};
 const asset=assets[url.pathname];
 if(!asset&&!url.pathname.startsWith('/api/portal/'))return false;
 const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 securityHeaders(res);
 try{
 if(asset&&req.method==='GET'){res.setHeader('Content-Type',asset[1]);res.setHeader('Cache-Control','no-store');res.end(await readFile(resolve(__dirname,'../../public',asset[0])));return true;}
 const origin=process.env.PORTAL_URL;
 const publicKey=process.env.SUPABASE_ANON_KEY;
 if(!origin||!publicKey){send(503,{error:'Portal access is still being configured. Contact your account administrator.'});return true;}
 if(req.method==='POST'&&(req.headers.origin!==new URL(origin).origin||req.headers['content-type']?.split(';',1)[0].trim().toLowerCase()!=='application/json')){send(403,{error:'Invalid request origin.'});return true;}
 if(url.pathname==='/api/portal/security-config'&&req.method==='GET'){send(200,{turnstile_site_key:process.env.TURNSTILE_SITE_KEY??null,mfa_required:false});return true;}
 const ip=clientIp(req.headers,req.socket.remoteAddress);
 const take=async(rule:Omit<RateLimitRule,'key'>&{key?:string})=>{
  const result=await limiter.consume({...rule,key:rule.key??ip});
  res.setHeader('RateLimit-Limit',String(result.limit));res.setHeader('RateLimit-Remaining',String(result.remaining));
  if(!result.allowed){res.setHeader('Retry-After',String(result.retryAfter));send(429,{error:'Too many requests. Please wait and try again.'});return false;}return true;
 };
 if(!(await take({scope:'portal-global-minute',limit:120,windowSeconds:60})))return true;
 if(!(await take({scope:'portal-global-burst',limit:30,windowSeconds:10})))return true;
 if(url.pathname==='/api/portal/onboarding/context'&&req.method==='GET'){
  if(!(await take({scope:'onboarding-context-ip',limit:30,windowSeconds:3600,failClosed:true})))return true;
  const sessionId=z.string().startsWith('cs_').max(255).parse(url.searchParams.get('session_id'));
  const state=await onboardingSubscription(sessionId);
  if(!state.checkoutComplete){send(402,{error:'Checkout is not complete yet.'});return true;}
  if(!state.paidAndActive&&!state.validTrial){send(402,{error:'We could not confirm this subscription. Please use the newest setup email or contact support.'});return true;}
  const selectedPlan=state.selection.plan;
  send(200,{email:state.checkout.customer_details?.email??null,plan_code:selectedPlan,plan_name:plans[selectedPlan].name,max_recipients:plans[selectedPlan].maxRecipients,trialing:state.validTrial});return true;
 }
 if(url.pathname==='/api/portal/recipient/confirm'&&req.method==='POST'){
  if(!(await take({scope:'recipient-confirm',limit:10,windowSeconds:600,failClosed:true})))return true;
  const {token}=z.object({token:z.string().min(32).max(128)}).parse(await body(req));
  const confirmed=await getSupabaseClient().rpc('confirm_report_contact',{p_token_hash:createHash('sha256').update(token).digest('hex')});
  if(confirmed.error){send(400,{error:'This confirmation link is invalid or has expired.'});return true;}
  send(200,confirmed.data);return true;
 }
 const auth=()=>createClient(process.env.SUPABASE_URL!,publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:timedFetch}});
 const secure=new URL(origin).protocol==='https:'?'; Secure':'';
 const cookieName=(name:string)=>process.env.NODE_ENV==='production'?`__Host-${name}`:name;
 const cookieValue=(name:string,token:string,seconds:number)=>`${cookieName(name)}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure}`;
 const csrfCookie=(token:string,seconds:number)=>`${cookieName('audit_csrf')}=${encodeURIComponent(token)}; SameSite=Strict; Path=/; Max-Age=${seconds}${secure}`;
 const readCookie=(name:string)=>{const key=cookieName(name);const raw=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${key}=`))?.slice(key.length+1);return raw?decodeURIComponent(raw):'';};
 const clearSession=()=>res.setHeader('Set-Cookie',[cookieValue('audit_session','',0),cookieValue('audit_refresh','',0),csrfCookie('',0)]);
 if(url.pathname==='/api/portal/login'&&req.method==='POST'){
 const input=z.object({email:z.string().email().max(254),turnstile_token:z.string().max(4096).optional()}).parse(await body(req));
 if(!(await take({scope:'login-ip',limit:5,windowSeconds:900,failClosed:true})))return true;
 if(!(await take({scope:'login-email',key:privacyKey(input.email),limit:3,windowSeconds:900,failClosed:true})))return true;
 if(!(await take({scope:'login-email-daily',key:privacyKey(input.email),limit:10,windowSeconds:86400,failClosed:true})))return true;
 if(!(await verifyTurnstile(input.turnstile_token,ip))){send(403,{error:'Security verification failed. Please refresh and try again.'});return true;}
 const {error}=await auth().auth.signInWithOtp({email:input.email,options:{shouldCreateUser:false,emailRedirectTo:new URL('/auth/callback',origin).href}});
 // Do not reveal whether a customer email is registered.
 if(error&&error.status&&error.status>=500){send(503,{error:'Unable to request a sign-in link. Please try again.'});return true;}
 send(200,{ok:true});return true;
 }
 if(url.pathname==='/api/portal/onboarding'&&req.method==='POST'){
 if(!(await take({scope:'onboarding-ip',limit:5,windowSeconds:3600,failClosed:true})))return true;
 const input=z.object({session_id:z.string().startsWith('cs_').max(255),company_name:z.string().trim().min(2).max(200),email:z.string().email().max(254),
  timezone:z.string().trim().min(1).max(100),report_emails:z.array(z.string().email().max(254)).min(1).max(500)}).parse(await body(req));
 const state=await onboardingSubscription(input.session_id);const {checkout,subscription,subscriptionId,customerId,validTrial,paidAndActive}=state;
 if(!state.checkoutComplete){send(402,{error:'Checkout is not complete yet.'});return true;}
 if(!paidAndActive&&!validTrial){send(402,{error:'We could not confirm this subscription. Please use the newest setup email or contact support.'});return true;}
 const billingStatus=validTrial?'trialing':'active';const trialEndsAt=validTrial?new Date(Number(subscription!.trial_end)*1000):undefined;
 const selectedPlan=state.selection.plan;const selectedPeriod=state.selection.period;
 const email=input.email.toLowerCase();
 if(checkout.customer_details?.email?.toLowerCase()!==email){send(403,{error:'Use the same email address used during checkout.'});return true;}
 const requested=[...new Set(input.report_emails.map(value=>value.toLowerCase()))];if(!requested.includes(email))requested.unshift(email);
 if(requested.length>plans[selectedPlan].maxRecipients){send(409,{error:`The ${plans[selectedPlan].name} plan supports up to ${plans[selectedPlan].maxRecipients} report recipients.`});return true;}
 const slugBase=input.company_name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,45)||'customer';
 const db=getSupabaseClient();
 operation='onboarding.identity_lookup';
 const existing=await db.rpc('portal_onboarding_user_id',{p_email:email});
 if(existing.error)throw existing.error;
 let userId=existing.data as string|null;
 if(!userId){
  operation='onboarding.identity_create';
  const user=await db.auth.admin.createUser({email,email_confirm:false});
  userId=user.data.user?.id??null;
  if(user.error||!userId)throw new Error('Could not create user');
 }
 let result:{data:any,error:any}|undefined;
 operation='onboarding.workspace_create';
 for(let i=0;i<8;i++){
  result=await db.rpc('portal_complete_onboarding',{p_session_id:input.session_id,p_company_name:input.company_name,p_alias:i?`${slugBase}-${i+1}`:slugBase,p_user_id:userId,p_email:email,p_stripe_customer_id:customerId,p_stripe_subscription_id:subscriptionId,p_timezone:input.timezone,p_report_emails:[email]});
  if(!result.error)break;
 }
 if(result?.error)throw result.error;
 const onboardTenant=String(result?.data?.tenant_id??'');
 operation='onboarding.plan_assign';
 const assigned=await db.rpc('assign_billing_plan',{p_tenant:onboardTenant,p_session_id:input.session_id,p_plan:selectedPlan,p_period:selectedPeriod});if(assigned.error)throw assigned.error;
 operation='onboarding.billing_state_sync';
 const billingState=await db.rpc('sync_onboarding_billing_state',{p_session_id:input.session_id,p_subscription_id:subscriptionId,p_status:billingStatus,p_trial_ends_at:trialEndsAt?.toISOString()??null});if(billingState.error)throw billingState.error;
 operation='onboarding.owner_assign';
 const owner=await db.rpc('secure_onboarding_owner',{p_tenant:onboardTenant,p_user:userId});if(owner.error)throw owner.error;
 const contacts=confirmationContacts(requested);
 operation='onboarding.notifications_save';
 const savedContacts=await db.rpc('portal_save_notification_settings_v2',{p_user:userId,p_tenant:onboardTenant,p_timezone:input.timezone,p_contacts:contacts.map(({email,token_hash})=>({email,token_hash})),p_ip_fingerprint:privacyKey(ip).slice(0,32)});if(savedContacts.error)throw savedContacts.error;
 operation='onboarding.access_link_create';
 const access=await db.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:new URL('/auth/callback',origin).href}});
 const accessUrl=access.data?.properties?.action_link;
 if(access.error||!accessUrl)throw access.error??new Error('PORTAL_ACCESS_LINK_NOT_CREATED');
 operation='onboarding.welcome_email_send';
 await sendWelcomeEmail({email,company:input.company_name,plan:plans[selectedPlan].name,accessUrl,sessionId:input.session_id,trialEndsAt});
 const pending=new Set<string>(savedContacts.data?.pending_verification??[]);
 try{await sendConfirmations(contacts.filter(contact=>pending.has(contact.email)),origin);}
 catch(error){failure('portal.onboarding.report_confirmation_failed',error,{request_id:requestId(req),tenant:onboardTenant,pending_count:pending.size});}
 operation=undefined;
 send(200,{...result?.data,access_email_sent:true});return true;
 }
 if(url.pathname==='/api/portal/session'&&req.method==='POST'){
 if(!(await take({scope:'session-ip',limit:10,windowSeconds:300,failClosed:true})))return true;
 const {access_token,refresh_token}=z.object({access_token:z.string().min(20).max(12000),refresh_token:z.string().min(1).max(12000).nullish()}).parse(await body(req));
 const {data,error}=await auth().auth.getUser(access_token);
 if(error||!data.user){send(401,{error:'Invalid or expired link. Request a new link.'});return true;}
 res.setHeader('Set-Cookie',[cookieValue('audit_session',access_token,3600),cookieValue('audit_refresh',refresh_token??'',refresh_token?604800:0),csrfCookie(csrfToken(access_token),3600)]);send(200,{ok:true});return true;
 }
 let token=readCookie('audit_session');const refreshToken=readCookie('audit_refresh');
 if(url.pathname==='/api/portal/logout'&&req.method==='POST'){
  if(token&&!validCsrf(req,token)){send(403,{error:'Security token is missing or expired. Refresh the page and try again.'});return true;}
  clearSession();send(200,{ok:true});return true;
 }
 if(req.method==='POST'&&(!token||!validCsrf(req,token))){send(403,{error:'Security token is missing or expired. Refresh the page and try again.'});return true;}
 const sessionAuth=auth();
 let authResult=token?await sessionAuth.auth.getUser(token):{data:{user:null},error:null};
 if((authResult.error||!authResult.data.user)&&refreshToken){
  const refreshed=await sessionAuth.auth.refreshSession({refresh_token:refreshToken});
  const refreshedUser=refreshed.data.user??refreshed.data.session?.user??null;
  const refreshedAccess=refreshed.data.session?.access_token??'';
  if(!refreshed.error&&refreshedUser&&refreshedAccess){
   token=refreshedAccess;authResult={data:{user:refreshedUser},error:null};
   const rotatedRefresh=refreshed.data.session?.refresh_token??refreshToken;
   res.setHeader('Set-Cookie',[cookieValue('audit_session',token,3600),cookieValue('audit_refresh',rotatedRefresh,604800),csrfCookie(csrfToken(token),3600)]);
  }
 }
 const user=authResult.data;
 if(authResult.error||!user.user||!token){clearSession();send(401,{error:refreshToken?'Your session has expired. Request a new sign-in link.':'Sign in with your email to continue.'});return true;}
 const serviceDb=getSupabaseClient();
 const role=await serviceDb.from('audit_admins').select('user_id').eq('user_id',user.user.id).maybeSingle();
 const access=await serviceDb.from('audit_portal_users').select('enabled,guide_completed_at').eq('user_id',user.user.id).maybeSingle();
 const legalAcceptance=await serviceDb.from('audit_portal_legal_acceptances').select('accepted_at').eq('user_id',user.user.id).eq('terms_version',TERMS_VERSION).eq('privacy_version',PRIVACY_VERSION).maybeSingle();
 if(role.error||access.error||legalAcceptance.error)throw new Error('Access lookup failed');
 if(access.data?.enabled===false){clearSession();send(401,{error:'Your portal access has been disabled. Contact your account administrator.'});return true;}
 const isAdmin=Boolean(role.data);
 // Customer reads are enforced by the user's JWT and database RLS. The service
 // role remains limited to audited RPC mutations and global administrator views.
 const userDb=createClient(process.env.SUPABASE_URL!,publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:timedFetch,headers:{Authorization:`Bearer ${token}`}}});
 const customerDb=typeof (userDb as {from?:unknown}).from==='function'?userDb:serviceDb;
 const db=isAdmin?serviceDb:customerDb;
 const aal=verifiedAal(token);
 const requiresLegalAcceptance=!isAdmin&&!legalAcceptance.data?.accepted_at;
 if(url.pathname==='/api/portal/legal/accept'&&req.method==='POST'){
  if(isAdmin){send(403,{error:'Legal acceptance is not required in administrator mode.'});return true;}
  if(!(await take({scope:'legal-accept-user',key:user.user.id,limit:5,windowSeconds:600,failClosed:true})))return true;
  z.object({terms_accepted:z.literal(true),privacy_acknowledged:z.literal(true)}).parse(await body(req));
  const accepted=await serviceDb.rpc('record_portal_legal_acceptance',{p_user:user.user.id,p_terms_version:TERMS_VERSION,p_privacy_version:PRIVACY_VERSION,p_acceptance_text:PORTAL_ACCEPTANCE_TEXT,p_ip_address:ip,p_user_agent:String(req.headers['user-agent']??'unknown')});
  if(accepted.error||!accepted.data)throw accepted.error??new Error('PORTAL_LEGAL_ACCEPTANCE_FAILED');
  send(200,{ok:true,accepted_at:accepted.data,terms_version:TERMS_VERSION,privacy_version:PRIVACY_VERSION});return true;
 }
 if(requiresLegalAcceptance&&url.pathname!=='/api/portal/me'){send(428,{error:'Accept the Terms of Service and acknowledge the Privacy Policy to continue.'});return true;}
 if(url.pathname==='/api/portal/guide/complete'&&req.method==='POST'){
  if(isAdmin){send(403,{error:'The customer guide is not available in administrator mode.'});return true;}
  if(!(await take({scope:'guide-complete-user',key:user.user.id,limit:5,windowSeconds:600,failClosed:true})))return true;
  const completed=await customerDb.rpc('portal_complete_guide');if(completed.error){send(409,{error:'Unable to save your guide preference. Please try again.'});return true;}
  send(200,{ok:true,completed_at:completed.data});return true;
 }
 if(url.pathname.startsWith('/api/portal/mfa/')){
  const refreshName=cookieName('audit_refresh');const refreshRaw=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${refreshName}=`))?.slice(refreshName.length+1);
  const refreshToken=refreshRaw?decodeURIComponent(refreshRaw):'';
  if(!refreshToken){send(409,{error:'Sign in again before configuring multi-factor authentication.'});return true;}
  const sessionAuth=auth();const restored=await sessionAuth.auth.setSession({access_token:token,refresh_token:refreshToken});
  if(restored.error){send(401,{error:'Your session has expired. Sign in again.'});return true;}
  if(url.pathname==='/api/portal/mfa/status'&&req.method==='GET'){
   const factors=await sessionAuth.auth.mfa.listFactors();if(factors.error)throw factors.error;
   send(200,{aal,factors:factors.data.totp.map(f=>({id:f.id,status:f.status,friendly_name:f.friendly_name}))});return true;
  }
  if(url.pathname==='/api/portal/mfa/enroll'&&req.method==='POST'){
   if(!(await take({scope:'mfa-enroll-user',key:user.user.id,limit:3,windowSeconds:3600,failClosed:true})))return true;
   const input=z.object({friendly_name:z.string().trim().min(2).max(50).default('Authenticator')}).parse(await body(req));
   const enrolled=await sessionAuth.auth.mfa.enroll({factorType:'totp',friendlyName:input.friendly_name});if(enrolled.error)throw enrolled.error;
   send(200,{id:enrolled.data.id,qr_code:enrolled.data.totp.qr_code,secret:enrolled.data.totp.secret});return true;
  }
  if(url.pathname==='/api/portal/mfa/verify'&&req.method==='POST'){
   if(!(await take({scope:'mfa-verify-user',key:user.user.id,limit:5,windowSeconds:600,failClosed:true})))return true;
   const input=z.object({factor_id:uuid,code:z.string().regex(/^\d{6}$/)}).parse(await body(req));
   const challenge=await sessionAuth.auth.mfa.challenge({factorId:input.factor_id});if(challenge.error)throw challenge.error;
   const verified=await sessionAuth.auth.mfa.verify({factorId:input.factor_id,challengeId:challenge.data.id,code:input.code});if(verified.error||!verified.data.access_token||!verified.data.refresh_token)throw verified.error??new Error('MFA_VERIFY_FAILED');
   res.setHeader('Set-Cookie',[cookieValue('audit_session',verified.data.access_token,3600),cookieValue('audit_refresh',verified.data.refresh_token,604800),csrfCookie(csrfToken(verified.data.access_token),3600)]);send(200,{ok:true});return true;
  }
  send(404,{error:'Page not found.'});return true;
 }
 if(url.pathname.startsWith('/api/portal/admin/')){
  if(!isAdmin){send(403,{error:'Administrator access required.'});return true;}
  const supportThread=url.pathname.match(/^\/api\/portal\/admin\/support\/([0-9a-f-]+)(?:\/(reply|resolve))?$/i);
  if(req.method!=='GET'){
   const supportMutation=Boolean(supportThread);
   if(!(await take({scope:supportMutation?'admin-support-user':'admin-mutation-user',key:user.user.id,limit:supportMutation?60:5,windowSeconds:supportMutation?60:600,failClosed:true})))return true;
  }
  const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0);
  if(url.pathname==='/api/portal/admin/support'&&req.method==='GET'){
   const result=await serviceDb.rpc('portal_admin_support_queue',{p_actor:user.user.id,p_page:page});if(result.error)throw result.error;
   send(200,result.data);return true;
  }
  if(supportThread){
   const conversation=uuid.parse(supportThread[1]);const action=supportThread[2];
   if(!action&&req.method==='GET'){
    const result=await serviceDb.rpc('portal_admin_support_conversation',{p_actor:user.user.id,p_conversation:conversation});if(result.error)throw result.error;
    send(200,result.data);return true;
   }
   if(action==='reply'&&req.method==='POST'){
    const input=z.object({message:z.string().trim().min(1).max(4000)}).parse(await body(req));
    const result=await serviceDb.rpc('portal_admin_support_reply',{p_actor:user.user.id,p_conversation:conversation,p_body:input.message});if(result.error)throw result.error;
    send(200,{message:result.data});return true;
   }
   if(action==='resolve'&&req.method==='POST'){
    const result=await serviceDb.rpc('portal_admin_support_resolve',{p_actor:user.user.id,p_conversation:conversation});if(result.error)throw result.error;
    send(200,{ok:true});return true;
   }
  }
  if(url.pathname==='/api/portal/admin/action'&&req.method==='POST'){
   try{send(200,await adminAction(serviceDb,user.user.id,await body(req)));}
   catch(error){if(error instanceof z.ZodError)throw error;send(409,{error:error instanceof Error?error.message:'Unable to save changes.'});}return true;
  }
  if(url.pathname==='/api/portal/admin/users'&&req.method==='GET'){
   const result=await serviceDb.rpc('portal_admin_users',{p_actor:user.user.id,p_page:page});
   if(result.error)throw result.error;send(200,result.data);return true;
  }
  if(url.pathname==='/api/portal/admin/confidence'&&req.method==='GET'){
   const result=await serviceDb.rpc('portal_admin_confidence_reviews',{p_actor:user.user.id,p_page:page});
   if(result.error)throw result.error;send(200,result.data);return true;
  }
  if(url.pathname==='/api/portal/admin/costs'&&req.method==='GET'){
   const tenantParam=url.searchParams.get('company');const fromParam=url.searchParams.get('from');const toParam=url.searchParams.get('to');
   const tenantFilter=tenantParam?uuid.parse(tenantParam):null;
   const date=z.string().datetime({offset:true});const from=fromParam?date.parse(fromParam):new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)).toISOString();const to=toParam?date.parse(toParam):new Date().toISOString();
   const result=await serviceDb.rpc('portal_admin_costs',{p_actor:user.user.id,p_tenant:tenantFilter,p_from:from,p_to:to});if(result.error)throw result.error;
   send(200,result.data);return true;
  }
  if(url.pathname==='/api/portal/admin/crm'&&req.method==='GET'){
   const leads=await serviceDb.from('free_audit_requests').select('id,email,contact_name,company_name,phone,loads_per_month,status,created_at,updated_at,completed_at,result,utm_source,utm_medium,utm_campaign,utm_term,utm_content',{count:'exact'}).neq('status','expired').order('created_at',{ascending:false}).limit(500);
   if(leads.error)throw leads.error;
   const ids=(leads.data??[]).map(lead=>lead.id);const emails=[...new Set((leads.data??[]).map(lead=>lead.email))];
   const [followups,billing]=await Promise.all([
    ids.length?serviceDb.from('free_audit_followups').select('request_id,day_offset,status,sent_at').in('request_id',ids).limit(5000):Promise.resolve({data:[],error:null}),
    emails.length?serviceDb.from('audit_billing_customers').select('billing_email,status,trial_ends_at,canceled_at,plan_code,billing_period,last_paid_amount_cents,last_paid_currency,last_paid_at,updated_at').in('billing_email',emails).order('updated_at',{ascending:false}).limit(2000):Promise.resolve({data:[],error:null}),
   ]);
   if(followups.error||billing.error)throw followups.error??billing.error;
   send(200,{...buildCrmFunnel((leads.data??[]) as CrmLeadRow[],(followups.data??[]) as CrmFollowupRow[],(billing.data??[]) as CrmBillingRow[]),truncated:(leads.count??0)>500});return true;
  }
  const resources:Record<string,[string,string]>={companies:['audit_tenants','id,name,alias,status,is_test,created_at'],activity:['audit_admin_activity','id,actor_email,action,tenant_id,target_user_id,company_name,target_email,details,created_at']};
  const resource=resources[url.pathname.slice('/api/portal/admin/'.length)];
  if(resource&&req.method==='GET'){
   const result=await serviceDb.from(resource[0]).select(resource[1],{count:'exact'}).order('created_at',{ascending:false}).order('id').range(page*50,page*50+49);
   if(result.error)throw result.error;send(200,{rows:result.data,total:result.count,page});return true;
  }
  send(404,{error:'Page not found.'});return true;
 }
 const membership=await db.from('audit_memberships').select('tenant_id,role,audit_tenants(id,name,alias,status)').eq('user_id',user.user.id);
 if(membership.error)throw membership.error;
 if(url.pathname==='/api/portal/me'&&req.method==='GET'){
  // Administrators browse the paginated company directory, avoiding a truncated global selector.
  send(200,{email:user.user.email,user_id:user.user.id,is_admin:isAdmin,aal,requires_legal_acceptance:requiresLegalAcceptance,terms_version:TERMS_VERSION,privacy_version:PRIVACY_VERSION,show_guide:!isAdmin&&!access.data?.guide_completed_at,companies:membership.data?.map(m=>({...m.audit_tenants,role:m.role})).filter(Boolean)});return true;
 }
 const tenant=uuid.parse(url.searchParams.get('company'));
 if(!isAdmin&&!membership.data?.some(m=>m.tenant_id===tenant)){send(403,{error:'You do not have access to this company.'});return true;}
 if(!(await take({scope:'authenticated-user-minute',key:user.user.id,limit:120,windowSeconds:60}))||!(await take({scope:'authenticated-tenant-minute',key:tenant,limit:300,windowSeconds:60})))return true;
 const tenantMembership=membership.data?.find(m=>m.tenant_id===tenant);
 const canManageRose=!isAdmin&&['owner','billing_admin'].includes(tenantMembership?.role??'');
 const roseTenant=tenantMembership?.audit_tenants as unknown as {status?:string}|undefined;
 const roseSetupAvailable=process.env.ROSE_ROCKET_CONNECT_ENABLED==='true';
 if(url.pathname==='/api/portal/support/conversation'&&req.method==='GET'){
  if(isAdmin){send(403,{error:'Open customer support from a customer account.'});return true;}
  const conversationParam=url.searchParams.get('conversation');const conversation=conversationParam?uuid.parse(conversationParam):null;
  const result=await serviceDb.rpc('portal_support_get_conversation',{p_tenant:tenant,p_user:user.user.id,p_conversation:conversation});if(result.error)throw result.error;
  send(200,result.data);return true;
 }
 if(url.pathname==='/api/portal/support/escalate'&&req.method==='POST'){
  if(isAdmin){send(403,{error:'Open customer support from a customer account.'});return true;}
  if(!(await take({scope:'portal-support-escalation-user',key:user.user.id,limit:5,windowSeconds:3600,failClosed:true})))return true;
  const input=z.object({conversation_id:uuid,problem:z.string().trim().min(10).max(2000)}).parse(await body(req));
  operation='portal.support.escalation';
  const escalated=await serviceDb.rpc('portal_support_escalate',{p_tenant:tenant,p_user:user.user.id,p_conversation:input.conversation_id,p_problem:input.problem});if(escalated.error)throw escalated.error;
  const conversation=escalated.data as {id:string;notified_at?:string|null;first_response_due_at:string;customer_name:string;customer_email:string;escalation_problem:string};
  if(!conversation.notified_at){
   const details=tenantMembership?.audit_tenants as unknown as {name?:string}|undefined;
   await notifySupportRequest({conversationId:conversation.id,name:conversation.customer_name,email:conversation.customer_email,accountName:details?.name??'Conta sem nome',accountId:tenant,problem:conversation.escalation_problem,dueAt:conversation.first_response_due_at});
   const notified=await serviceDb.rpc('portal_support_mark_notified',{p_conversation:conversation.id});if(notified.error)throw notified.error;
  }
  info('portal.support.escalated',{request_id:requestId(req),tenant_id:tenant,actor_user_id:user.user.id,conversation_id:conversation.id});
  operation=undefined;send(200,{conversation_id:conversation.id,status:'waiting',first_response_due_at:conversation.first_response_due_at});return true;
 }
 if(url.pathname==='/api/portal/support'&&req.method==='POST'){
  if(isAdmin){send(403,{error:'Open customer support from a customer account.'});return true;}
  if(!(await take({scope:'portal-support-user',key:user.user.id,limit:20,windowSeconds:3600,failClosed:true}))||!(await take({scope:'portal-support-tenant',key:tenant,limit:100,windowSeconds:3600,failClosed:true})))return true;
  operation='portal.support';
  const input=await body(req);const parsed=z.object({messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().trim().min(1).max(1200)})).min(1).max(24),context:z.object({view:z.enum(['jobs','invoices','reports','exceptions','history','settings']).optional()}).strict().optional()}).strict().parse(input);
  const customerName=String(user.user.user_metadata?.full_name??user.user.user_metadata?.name??user.user.email?.split('@')[0]??'Customer').trim().slice(0,200);
  const opened=await serviceDb.rpc('portal_support_open_conversation',{p_tenant:tenant,p_user:user.user.id,p_name:customerName,p_email:user.user.email??'unknown@example.com'});if(opened.error)throw opened.error;
  const conversation=opened.data as {id:string;status:'ai'|'waiting'|'active'|'resolved'};const latest=parsed.messages.at(-1)!;
  const saved=await serviceDb.rpc('portal_support_append_message',{p_tenant:tenant,p_user:user.user.id,p_conversation:conversation.id,p_author_type:'customer',p_body:latest.content});if(saved.error)throw saved.error;
  if(conversation.status==='waiting'||conversation.status==='active'){
   operation=undefined;send(200,{conversation_id:conversation.id,status:conversation.status,human_active:true});return true;
  }
  const result=await answerPortalSupport(parsed,fetch,{tenantId:tenant,subjectType:'support_conversation',subjectId:conversation.id});
  const aiSaved=await serviceDb.rpc('portal_support_append_message',{p_tenant:tenant,p_user:user.user.id,p_conversation:conversation.id,p_author_type:'ai',p_body:result.answer});if(aiSaved.error)throw aiSaved.error;
  info('portal.support.completed',{request_id:requestId(req),tenant_id:tenant,actor_user_id:user.user.id,conversation_id:conversation.id,offered_human:result.offerHuman});
  operation=undefined;send(200,{answer:result.answer,offer_human:result.offerHuman,conversation_id:conversation.id,status:'ai'});return true;
 }
 if(url.pathname==='/api/portal/integrations/rose-rocket'&&req.method==='POST'){
  if(!roseSetupAvailable){send(503,{error:'Rose Rocket connection setup is not available yet.'});return true;}
  if(!canManageRose){send(403,{error:'Only the company owner or billing administrator can connect Rose Rocket.'});return true;}
  if(process.env.REQUIRE_MFA_SENSITIVE==='true'&&aal!=='aal2'){send(403,{error:'Verify your authenticator before connecting Rose Rocket.'});return true;}
  if(roseTenant?.status!=='active'){send(409,{error:'This company must be active to connect Rose Rocket.'});return true;}
  if(!(await take({scope:'rose-connect-user',key:user.user.id,limit:3,windowSeconds:3600,failClosed:true})))return true;
  const input=z.object({org_id:uuid,user_id:uuid,client_id:z.string().trim().min(1).max(512),client_secret:z.string().min(1).max(2048)}).parse(await body(req));
  const account={orgId:input.org_id,userId:input.user_id,clientId:input.client_id,clientSecret:input.client_secret};
  try{await new RoseRocketClient({account}).verifyAccess();}
  catch{send(422,{error:'Rose Rocket could not verify this integration account. Check the four values and its API access.'});return true;}
  const previous=await serviceDb.from('audit_rose_connections').select('org_id').eq('tenant_id',tenant).maybeSingle();
  if(previous.error)throw previous.error;
  if(previous.data&&previous.data.org_id!==input.org_id){send(409,{error:'This company is already linked to another Rose Rocket organization. Contact support to change it.'});return true;}
  const changes={credentials_ciphertext:encryptRoseCredentials(account),connected_at:new Date().toISOString(),connected_by:user.user.id,connection_state:'pending',enabled:false};
  const saved=previous.data
   ?await serviceDb.from('audit_rose_connections').update(changes).eq('tenant_id',tenant).eq('org_id',input.org_id)
   :await serviceDb.from('audit_rose_connections').insert({org_id:input.org_id,tenant_id:tenant,...changes});
  if(saved.error){send(saved.error.code==='23505'?409:503,{error:saved.error.code==='23505'?'This Rose Rocket organization is already linked to another company.':'Could not save the connection. Try again.'});return true;}
  info('rose.connection.verified',{tenant_id:tenant,org_id:input.org_id,actor_user_id:user.user.id});
  send(200,{status:'pending',org_id:input.org_id});return true;
 }
 if(url.pathname==='/api/portal/integrations/rose-rocket/disconnect'&&req.method==='POST'){
  if(!canManageRose){send(403,{error:'Only the company owner or billing administrator can disconnect Rose Rocket.'});return true;}
  if(process.env.REQUIRE_MFA_SENSITIVE==='true'&&aal!=='aal2'){send(403,{error:'Verify your authenticator before disconnecting Rose Rocket.'});return true;}
  if(!(await take({scope:'rose-disconnect-user',key:user.user.id,limit:5,windowSeconds:3600,failClosed:true})))return true;
  const stopped=await serviceDb.from('audit_rose_connections').update({credentials_ciphertext:null,connected_at:null,connected_by:null,connection_state:'disconnected',enabled:false}).eq('tenant_id',tenant);
  if(stopped.error)throw stopped.error;
  info('rose.connection.disconnected',{tenant_id:tenant,actor_user_id:user.user.id});
  send(200,{status:'disconnected'});return true;
 }
 if(url.pathname==='/api/portal/settings'&&req.method==='GET'){
  const monthStart=new Date();monthStart.setUTCDate(1);monthStart.setUTCHours(0,0,0,0);
  const [settings,contacts,billing,senders,usage,roseConnection]=await Promise.all([
   db.from('audit_notification_settings').select('timezone,daily_hour,daily_enabled,monthly_enabled,immediate_enabled,immediate_threshold').eq('tenant_id',tenant).maybeSingle(),
   db.from('audit_report_contacts').select('email,verified_at').eq('tenant_id',tenant).eq('enabled',true).order('email'),
   db.from('audit_billing_customers').select('billing_email,stripe_subscription_id,status,trial_ends_at,retention_discount_used_at,pause_used_at,paused_until,cancel_at_period_end,canceled_at,deletion_scheduled_at,plan_code,billing_period,included_invoices,overage_unit_amount_cents,payment_grace_until').eq('tenant_id',tenant).maybeSingle(),
   db.from('audit_inbound_sender_rules').select('sender_email').eq('tenant_id',tenant).eq('enabled',true).order('sender_email'),
   db.from('audit_invoice_usage').select('id',{count:'exact',head:true}).eq('tenant_id',tenant).gte('created_at',monthStart.toISOString()),
   roseSetupAvailable?serviceDb.from('audit_rose_connections').select('org_id,enabled,connection_state,connected_at').eq('tenant_id',tenant).maybeSingle():Promise.resolve({data:null,error:null}),
  ]);
  if(settings.error||contacts.error||billing.error||senders.error||usage.error||roseConnection.error)throw new Error('Settings lookup failed');
  // Billing state is synchronized by Stripe webhooks. Reading Settings must stay
  // a local portal query and should not wait on a live Stripe API call.
  const bill=billing.data;
  const tenantRole=membership.data?.find(m=>m.tenant_id===tenant)?.role;
  const tenantDetails=membership.data?.find(m=>m.tenant_id===tenant)?.audit_tenants as {alias?:string}|undefined;const plan=plans[planFromMetadata(bill?.plan_code)];
  send(200,{notifications:{timezone:settings.data?.timezone??'UTC',daily_hour:settings.data?.daily_hour??7,can_manage:['owner','billing_admin'].includes(tenantRole??''),audit_email:tenantDetails?.alias?`${tenantDetails.alias}@audit.aiolympian.com`:null,max_recipients:plan.maxRecipients,max_senders:plan.maxSenders,report_emails:(contacts.data??[]).map(row=>({email:row.email,verified:Boolean(row.verified_at)})),inbound_senders:(senders.data??[]).map(row=>row.sender_email)},
   integrations:{rose_rocket:{setup_available:roseSetupAvailable,can_manage:canManageRose,status:roseConnection.data?.enabled?'active':roseConnection.data?.connection_state==='pending'&&roseConnection.data?.connected_at?'pending':'disconnected',org_id:roseConnection.data?.org_id??null,connected_at:roseConnection.data?.connected_at??null}},
   billing:bill?{status:bill.status,trial_ends_at:bill.trial_ends_at,paused_until:bill.paused_until,payment_grace_until:bill.payment_grace_until,cancel_at_period_end:bill.cancel_at_period_end,canceled_at:bill.canceled_at,
    plan_code:bill.plan_code,billing_period:bill.billing_period,included_invoices:bill.included_invoices,overage_unit_amount_cents:bill.overage_unit_amount_cents,usage_count:usage.count??0,
    deletion_scheduled_at:bill.deletion_scheduled_at,can_manage:!isAdmin&&bill.billing_email===user.user.email?.toLowerCase(),
    discount_available:!bill.retention_discount_used_at,pause_available:!bill.pause_used_at||new Date(bill.pause_used_at).getTime()<Date.now()-365*86400000}:null});return true;
 }
 if(url.pathname==='/api/portal/settings/notifications'&&req.method==='POST'){
  if(!(await take({scope:'settings-user',key:user.user.id,limit:5,windowSeconds:600,failClosed:true}))||!(await take({scope:'settings-tenant',key:tenant,limit:10,windowSeconds:600,failClosed:true})))return true;
  const input=z.object({timezone:z.string().trim().min(1).max(100),report_emails:z.array(z.string().email().max(254)).min(1).max(500),inbound_senders:z.array(z.string().email().max(254)).min(1).max(500)}).parse(await body(req));
  const planRow=await serviceDb.from('audit_billing_customers').select('plan_code').eq('tenant_id',tenant).maybeSingle();if(planRow.error)throw planRow.error;
  const plan=plans[planFromMetadata(planRow.data?.plan_code)];
  if(input.report_emails.length>plan.maxRecipients||input.inbound_senders.length>plan.maxSenders){send(409,{error:`Your ${plan.name} plan supports up to ${plan.maxRecipients} report recipients and ${plan.maxSenders} invoice sender${plan.maxSenders===1?'':'s'}.`});return true;}
  const emails=[...new Set(input.report_emails.map(value=>value.toLowerCase()))];const contacts=confirmationContacts(emails);
  const saved=await customerDb.rpc('portal_save_security_settings',{p_tenant:tenant,p_timezone:input.timezone,p_contacts:contacts.map(({email,token_hash})=>({email,token_hash})),p_senders:[...new Set(input.inbound_senders.map(value=>value.toLowerCase()))],p_ip_fingerprint:privacyKey(ip).slice(0,32)});
  if(saved.error){send(409,{error:'Check the time zone and email addresses, then try again.'});return true;}
  const pending=new Set<string>(saved.data?.pending_verification??[]);await sendConfirmations(contacts.filter(contact=>pending.has(contact.email)),origin);
  const owner=await serviceDb.from('audit_billing_customers').select('billing_email').eq('tenant_id',tenant).maybeSingle();
  await notifyOwner(owner.data?.billing_email,tenant,`Report recipients and authorized invoice senders were updated by ${user.user.email??'a portal user'}. ${pending.size} address(es) are awaiting confirmation.`);
  send(200,{ok:true});return true;
 }
 const billingAction=url.pathname.match(/^\/api\/portal\/billing\/(portal|retention-discount|pause|cancel)$/);
 if(billingAction&&req.method==='POST'){
  if(!(await take({scope:'billing-user',key:user.user.id,limit:5,windowSeconds:600,failClosed:true}))||!(await take({scope:'billing-tenant',key:tenant,limit:10,windowSeconds:600,failClosed:true})))return true;
  if(isAdmin){send(403,{error:'Only the customer billing owner can change the subscription.'});return true;}
  const found=await db.from('audit_billing_customers').select('billing_email,stripe_customer_id,stripe_subscription_id,status,retention_discount_used_at,pause_used_at').eq('tenant_id',tenant).maybeSingle();
  if(found.error||!found.data){send(409,{error:'No subscription is linked to this company.'});return true;}
  const billing=found.data;
  if(billing.billing_email!==user.user.email?.toLowerCase()){send(403,{error:'Only the billing owner can change this subscription.'});return true;}
  if(billingAction[1]==='portal'){
   if(!billing.stripe_customer_id)throw new Error('Missing Stripe customer');
   const session=await createBillingPortalSession(billing.stripe_customer_id);send(200,{url:session.url});return true;
  }
  if(!billing.stripe_subscription_id||!['trialing','active','canceling','paused'].includes(billing.status)){send(409,{error:'This subscription cannot be changed in its current state.'});return true;}
  const action=billingAction[1];
  if(action!=='cancel'&&billing.status!=='active'){send(409,{error:'Retention options are available only while the subscription is active.'});return true;}
  if(action==='retention-discount'){
   if(billing.retention_discount_used_at){send(409,{error:'The retention discount has already been used.'});return true;}
   await applyRetentionDiscount(billing.stripe_subscription_id,tenant);
   const recorded=await customerDb.rpc('portal_record_billing_action_secure',{p_tenant:tenant,p_action:'retention_discount'});if(recorded.error)throw recorded.error;
  } else if(action==='pause'){
   if(billing.pause_used_at&&new Date(billing.pause_used_at).getTime()>=Date.now()-365*86400000){send(409,{error:'The one-month pause has already been used in the last 12 months.'});return true;}
   const resumesAt=new Date(Date.now()+30*86400000);await pauseSubscriptionOneMonth(billing.stripe_subscription_id,tenant,resumesAt);
   const recorded=await customerDb.rpc('portal_record_billing_action_secure',{p_tenant:tenant,p_action:'pause_one_month'});if(recorded.error)throw recorded.error;
  } else {
   await cancelSubscriptionAtPeriodEnd(billing.stripe_subscription_id,tenant);
   const recorded=await customerDb.rpc('portal_record_billing_action_secure',{p_tenant:tenant,p_action:'cancel_at_period_end'});if(recorded.error)throw recorded.error;
   void notifyLeadFunnel({stage:'cancel_requested',requestId:tenant,email:user.user.email,metadata:{subscription:billing.stripe_subscription_id,status:billing.status}}).catch(error=>failure('google_chat.lead_notification.failed',error,{tenant_id:tenant,stage:'cancel_requested'}));
  }
  send(200,{ok:true});return true;
 }
 const action=url.pathname.match(/^\/api\/portal\/jobs\/([a-f0-9-]+)\/(retry|review)$/);
 if(action&&req.method==='POST'){
 if(!(await take({scope:'mutation-user-minute',key:user.user.id,limit:30,windowSeconds:60,failClosed:true})))return true;
 const job=uuid.parse(action[1]);const {note}=z.object({note:z.string().trim().min(5).max(2000)}).parse(await body(req));
 if(action[2]==='retry'){const currentPlan=await serviceDb.from('audit_billing_customers').select('plan_code').eq('tenant_id',tenant).maybeSingle();if(!plans[planFromMetadata(currentPlan.data?.plan_code)].reprocessing){send(403,{error:'Exception reprocessing is available on the Growth and Scale plans.'});return true;}}
 const {error}=await serviceDb.rpc('portal_job_action',{p_user:user.user.id,p_tenant:tenant,p_job:job,p_action:action[2],p_note:note});
 if(error){send(409,{error:'Unable to save. Check the current case status and try again.'});return true;}
 send(200,{ok:true});return true;
 }
 const resolution=url.pathname.match(/^\/api\/portal\/exceptions\/([a-f0-9-]+)\/resolve$/);
 if(resolution&&req.method==='POST'){
  if(!(await take({scope:'mutation-user-minute',key:user.user.id,limit:30,windowSeconds:60,failClosed:true})))return true;
  const input=z.object({outcome:z.enum(['avoided','no_loss']),avoided_amount:z.number().nonnegative().max(1000000000).nullable(),note:z.string().trim().min(5).max(2000)}).parse(await body(req));
  if(input.outcome==='avoided'&&(!input.avoided_amount||input.avoided_amount<=0)){send(400,{error:'Enter the confirmed amount of loss avoided.'});return true;}
  const {error}=await serviceDb.rpc('portal_resolve_exception',{p_user:user.user.id,p_tenant:tenant,p_exception:resolution[1],p_outcome:input.outcome,p_avoided_amount:input.avoided_amount,p_note:input.note});
  if(error){send(409,{error:'Unable to save this outcome. Please refresh and try again.'});return true;}
  send(200,{ok:true});return true;
 }
 const tables:Record<string,[string,string]>={jobs:['audit_inbound_jobs','id,email_id,status,error_code,result,created_at,started_at,finished_at'],invoices:['invoices','id,numero_fatura,numero_carga,carrier_name,mc_number,data_fatura,valor_total,origem,destino,verification,created_at'],reports:['audit_runs','run_id,report,created_at'],exceptions:['exceptions','id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,created_at,resolution_status,avoided_amount,resolution_note,resolved_at'],history:['audit_job_reviews','id,job_id,action,note,actor_email,actor_role,created_at']};
 const table=tables[url.pathname.split('/').pop()??''];
 if(table&&req.method==='GET'){
 const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0);
 const {data,error,count}=await db.from(table[0]).select(table[1],{count:'exact'}).eq('tenant_id',tenant).order('created_at',{ascending:false}).order(table[0]==='audit_runs'?'run_id':'id').range(page*50,page*50+49);
 if(error)throw error;send(200,{rows:Array.isArray(data)?data:[],total:count??0,page});return true;
 }
 send(404,{error:'Page not found.'});
 }catch(error){failure('portal.request.failed',error,{request_id:requestId(req),path:url.pathname,method:req.method,...(operation?{operation}:{})});
  const onboardingMessage=operation==='portal.support'?'AI support is temporarily unavailable. Please try again in a moment.':operation?.startsWith('onboarding.')?(operation==='onboarding.welcome_email_send'||operation==='onboarding.access_link_create'?'Your account was created, but the access email could not be sent. Please try again.':'We could not finish setting up your account. Your payment is safe; please try again.'):'Unable to complete the request. Check your information and try again.';
  send(error instanceof HttpError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:503,{error:onboardingMessage});}
 return true;
}
