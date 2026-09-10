import 'dotenv/config';
import {z} from 'zod';
import {createApp} from './http/app.js';
import {enqueue} from './inbound/repository.js';
import {startWorker} from './inbound/worker.js';
import {ResendReceivingClient} from './inbound/resend.js';
import {getSupabaseClient} from './config/supabase.js';
import {ResendSender} from './notifications/resend.sender.js';
import {startNotificationWorker} from './notifications/worker.js';
import {startBillingMaintenanceWorker} from './billing/maintenance.worker.js';
import {createRateLimiter} from './security/rate-limit.js';
import {createFreeAuditHttpHandler} from './free-audit/http.js';
import {startFreeAuditWorker} from './free-audit/worker.js';
import {failure,info} from './observability/logger.js';
const Config=z.object({
 PORT:z.coerce.number().int().min(1).max(65535).default(3000),
 RESEND_WEBHOOK_SECRET:z.string().startsWith('whsec_').min(15),
 RESEND_API_KEY:z.string().min(1),
 RESEND_FROM_EMAIL:z.string().email(),
 PORTAL_URL:z.string().url(),
 SUPABASE_URL:z.string().url(),SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
 R2_ACCOUNT_ID:z.string().min(1),R2_ACCESS_KEY_ID:z.string().min(1),R2_SECRET_ACCESS_KEY:z.string().min(1),R2_BUCKET_NAME:z.string().min(1),
 OPENROUTER_API_KEY:z.string().min(1),FMCSA_API_KEY:z.string().min(1),
 EXTRACTOR_PROVIDER:z.literal('openrouter'),CARRIER_PROVIDER:z.literal('fmcsa'),
 CARRIER_CACHE_TTL_HOURS:z.coerce.number().positive().default(4),
 WORKER_ENABLED:z.enum(['true','false']).default('false'),
 STRIPE_SECRET_KEY:z.string().startsWith('sk_'),STRIPE_WEBHOOK_SECRET:z.string().startsWith('whsec_'),
 STRIPE_PRICE_CORE_MONTHLY:z.string().startsWith('price_'),STRIPE_PRICE_CORE_SEMIANNUAL:z.string().startsWith('price_'),STRIPE_PRICE_CORE_ANNUAL:z.string().startsWith('price_'),
 STRIPE_PRICE_GROWTH_MONTHLY:z.string().startsWith('price_'),STRIPE_PRICE_GROWTH_SEMIANNUAL:z.string().startsWith('price_'),STRIPE_PRICE_GROWTH_ANNUAL:z.string().startsWith('price_'),
 STRIPE_PRICE_SCALE_MONTHLY:z.string().startsWith('price_'),STRIPE_PRICE_SCALE_SEMIANNUAL:z.string().startsWith('price_'),STRIPE_PRICE_SCALE_ANNUAL:z.string().startsWith('price_'),
 STRIPE_RETENTION_COUPON_ID:z.string().min(1),STRIPE_PORTAL_CONFIGURATION_ID:z.string().startsWith('bpc_'),
 REDIS_URL:z.string().url(),RATE_LIMIT_KEY_SECRET:z.string().min(32),
 TRUST_PROXY:z.enum(['cloudflare','easypanel']),TURNSTILE_SITE_KEY:z.string().min(10),TURNSTILE_SECRET_KEY:z.string().min(10),
 REQUIRE_MFA_SENSITIVE:z.enum(['true','false']).default('false'),
 PDF_SCAN_URL:z.string().url(),PDF_SCAN_TOKEN:z.string().min(32),
 METRICS_TOKEN:z.string().min(32),
 CSRF_SECRET:z.string().min(32),
 OPENROUTER_ALLOWED_MODELS:z.string().min(1),OPENROUTER_DATA_PROCESSING_ACK:z.literal('true'),
 FREE_AUDIT_ORIGIN:z.string().url().transform(value=>new URL(value).origin),FREE_AUDIT_ORIGINS:z.string().optional(),FREE_AUDIT_PUBLIC_URL:z.string().url().transform(value=>new URL(value).origin),FREE_AUDIT_OFFER_URL:z.string().url(),
});
const parsed=Config.safeParse(process.env);
if(!parsed.success){failure('server.configuration.invalid',new Error('INVALID_SERVER_CONFIGURATION'),{invalid_variables:parsed.error.issues.map(i=>i.path.join('.'))});process.exit(1);}
const config=parsed.data;
if(new URL(config.PORTAL_URL).protocol!=='https:'){failure('server.configuration.invalid',new Error('PORTAL_URL_HTTPS_REQUIRED'),{invalid_variables:['PORTAL_URL']});process.exit(1);}
const limiter=createRateLimiter(config.REDIS_URL);
let allowedOrigins:string[];
try{allowedOrigins=[...new Set((config.FREE_AUDIT_ORIGINS??config.FREE_AUDIT_ORIGIN).split(',').map(value=>new URL(value.trim()).origin))];}
catch{failure('server.configuration.invalid',new Error('FREE_AUDIT_ORIGINS_INVALID'),{invalid_variables:['FREE_AUDIT_ORIGINS']});process.exit(1);}
const freeAudit=createFreeAuditHttpHandler({allowedOrigins,publicUrl:config.FREE_AUDIT_PUBLIC_URL,offerUrl:config.FREE_AUDIT_OFFER_URL});
const server=createApp({secret:config.RESEND_WEBHOOK_SECRET,enqueue,limiter,freeAudit,ready:async()=>{
 const {error}=await getSupabaseClient().from('audit_inbound_jobs').select('id',{head:true}).limit(1);
 return !error;
}});
const stopWorker=config.WORKER_ENABLED==='true'?startWorker(new ResendReceivingClient(config.RESEND_API_KEY)):async()=>{};
const stopNotifications=config.WORKER_ENABLED==='true'
 ?startNotificationWorker(new ResendSender(config.RESEND_API_KEY,config.RESEND_FROM_EMAIL),config.PORTAL_URL)
 :async()=>{};
const stopFreeAudits=config.WORKER_ENABLED==='true'
 ?startFreeAuditWorker(new ResendSender(config.RESEND_API_KEY,config.RESEND_FROM_EMAIL),config.FREE_AUDIT_OFFER_URL,config.FREE_AUDIT_PUBLIC_URL,config.CSRF_SECRET)
 :async()=>{};
const stopBilling=config.WORKER_ENABLED==='true'?startBillingMaintenanceWorker():async()=>{};
server.listen(config.PORT,'0.0.0.0',()=>info('server.started',{port:config.PORT,workers_enabled:config.WORKER_ENABLED==='true',node_env:process.env.NODE_ENV??'unknown'}));
let closing=false;
async function shutdown(){
 if(closing)return;closing=true;info('server.shutdown.started');
 server.close();
 const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
 await Promise.all([stopWorker(),stopNotifications(),stopFreeAudits(),stopBilling(),limiter.close()]);clearTimeout(deadline);info('server.shutdown.completed');process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
process.on('unhandledRejection',error=>failure('process.unhandled_rejection',error));
process.on('uncaughtException',error=>{failure('process.uncaught_exception',error);process.exit(1);});
