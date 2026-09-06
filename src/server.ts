import 'dotenv/config';
import {z} from 'zod';
import {createApp} from './http/app.js';
import {enqueue} from './inbound/repository.js';
import {startWorker} from './inbound/worker.js';
import {ResendReceivingClient} from './inbound/resend.js';
import {getSupabaseClient} from './config/supabase.js';
const Config=z.object({
 PORT:z.coerce.number().int().min(1).max(65535).default(3000),
 RESEND_WEBHOOK_SECRET:z.string().startsWith('whsec_').min(15),
 RESEND_API_KEY:z.string().min(1),
 SUPABASE_URL:z.string().url(),SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
 R2_ACCOUNT_ID:z.string().min(1),R2_ACCESS_KEY_ID:z.string().min(1),R2_SECRET_ACCESS_KEY:z.string().min(1),R2_BUCKET_NAME:z.string().min(1),
 OPENROUTER_API_KEY:z.string().min(1),FMCSA_API_KEY:z.string().min(1),
 EXTRACTOR_PROVIDER:z.literal('openrouter'),CARRIER_PROVIDER:z.literal('fmcsa'),
 CARRIER_CACHE_TTL_HOURS:z.coerce.number().positive().default(4),
 WORKER_ENABLED:z.enum(['true','false']).default('false'),
});
const parsed=Config.safeParse(process.env);
if(!parsed.success){console.error('Invalid server configuration:',parsed.error.issues.map(i=>i.path.join('.')).join(', '));process.exit(1);}
const config=parsed.data;
const server=createApp({secret:config.RESEND_WEBHOOK_SECRET,enqueue,ready:async()=>{
 const {error}=await getSupabaseClient().from('audit_inbound_jobs').select('id',{head:true}).limit(1);
 return !error;
}});
const stopWorker=config.WORKER_ENABLED==='true'?startWorker(new ResendReceivingClient(config.RESEND_API_KEY)):async()=>{};
server.listen(config.PORT,'0.0.0.0',()=>console.log(`[server] Listening on port ${config.PORT}; worker=${config.WORKER_ENABLED}`));
let closing=false;
async function shutdown(){
 if(closing)return;closing=true;
 server.close();
 const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
 await stopWorker();clearTimeout(deadline);process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
