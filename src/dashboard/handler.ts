import {IncomingMessage, ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {adminAction} from './admin.js';
import {getSupabaseClient} from '../config/supabase.js';

const uuid=z.string().uuid();
const limits=new Map<string,{count:number,until:number}>();
async function body(req:IncomingMessage) {
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('PAYLOAD');chunks.push(Buffer.from(chunk));}
 return JSON.parse(Buffer.concat(chunks).toString());
}
export async function dashboard(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/', 'http://localhost');
 const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/auth/callback':['index.html','text/html'],'/dashboard.js':['dashboard.js','text/javascript'],'/dashboard.css':['dashboard.css','text/css'],'/admin.js':['admin.js','text/javascript']};
 const asset=assets[url.pathname];
 if(!asset&&!url.pathname.startsWith('/api/portal/'))return false;
 const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
 if(asset&&req.method==='GET'){res.setHeader('Content-Type',asset[1]);res.setHeader('Cache-Control','no-store');res.end(await readFile(resolve(__dirname,'../../public',asset[0])));return true;}
 const origin=process.env.PORTAL_URL;
 const publicKey=process.env.SUPABASE_ANON_KEY;
 if(!origin||!publicKey){send(503,{error:'Portal access is still being configured. Contact your account administrator.'});return true;}
 if(req.method==='POST'&&(req.headers.origin!==new URL(origin).origin||!req.headers['content-type']?.startsWith('application/json'))){send(403,{error:'Invalid request origin.'});return true;}
 const auth=()=>createClient(process.env.SUPABASE_URL!,publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const secure=new URL(origin).protocol==='https:'?'; Secure':'';
 const cookie=(token:string,seconds:number)=>res.setHeader('Set-Cookie',`audit_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure}`);
 if(url.pathname==='/api/portal/login'&&req.method==='POST'){
 const input=z.object({email:z.string().email().max(254)}).parse(await body(req));
 const key=req.socket.remoteAddress??'unknown';const now=Date.now();
 for(const [k,v] of limits)if(v.until<now)limits.delete(k);
 const rate=limits.get(key)??{count:0,until:now+600000};rate.count++;limits.set(key,rate);
 if(rate.count>10){send(429,{error:'Please wait a few minutes before requesting another link.'});return true;}
 const {error}=await auth().auth.signInWithOtp({email:input.email,options:{shouldCreateUser:false,emailRedirectTo:new URL('/auth/callback',origin).href}});
 // Do not reveal whether a customer email is registered.
 if(error&&error.status&&error.status>=500){send(503,{error:'Unable to request a sign-in link. Please try again.'});return true;}
 send(200,{ok:true});return true;
 }
 if(url.pathname==='/api/portal/session'&&req.method==='POST'){
 const {access_token}=z.object({access_token:z.string().min(20).max(12000)}).parse(await body(req));
 const {data,error}=await auth().auth.getUser(access_token);
 if(error||!data.user){send(401,{error:'Invalid or expired link. Request a new link.'});return true;}
 cookie(access_token,3600);send(200,{ok:true});return true;
 }
 if(url.pathname==='/api/portal/logout'&&req.method==='POST'){cookie('',0);send(200,{ok:true});return true;}
 const raw=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('audit_session='))?.slice(14);
 const token=raw?decodeURIComponent(raw):'';
 if(!token){send(401,{error:'Sign in with your email to continue.'});return true;}
 const {data:user,error:authError}=await auth().auth.getUser(token);
 if(authError||!user.user){cookie('',0);send(401,{error:'Your session has expired. Request a new sign-in link.'});return true;}
 const db=getSupabaseClient();
 const role=await db.from('audit_admins').select('user_id').eq('user_id',user.user.id).maybeSingle();
 const access=await db.from('audit_portal_users').select('enabled').eq('user_id',user.user.id).maybeSingle();
 if(role.error||access.error)throw new Error('Access lookup failed');
 if(access.data?.enabled===false){cookie('',0);send(401,{error:'Your portal access has been disabled. Contact your account administrator.'});return true;}
 const isAdmin=Boolean(role.data);
 if(url.pathname.startsWith('/api/portal/admin/')){
  if(!isAdmin){send(403,{error:'Administrator access required.'});return true;}
  const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0);
  if(url.pathname==='/api/portal/admin/action'&&req.method==='POST'){
   try{send(200,await adminAction(db,user.user.id,await body(req)));}
   catch(error){if(error instanceof z.ZodError)throw error;send(409,{error:error instanceof Error?error.message:'Unable to save changes.'});}return true;
  }
  if(url.pathname==='/api/portal/admin/users'&&req.method==='GET'){
   const result=await db.rpc('portal_admin_users',{p_actor:user.user.id,p_page:page});
   if(result.error)throw result.error;send(200,result.data);return true;
  }
  const resources:Record<string,[string,string]>={companies:['audit_tenants','id,name,alias,status,is_test,created_at'],activity:['audit_admin_activity','id,actor_email,action,tenant_id,target_user_id,company_name,target_email,details,created_at']};
  const resource=resources[url.pathname.slice('/api/portal/admin/'.length)];
  if(resource&&req.method==='GET'){
   const result=await db.from(resource[0]).select(resource[1],{count:'exact'}).order('created_at',{ascending:false}).order('id').range(page*50,page*50+49);
   if(result.error)throw result.error;send(200,{rows:result.data,total:result.count,page});return true;
  }
  send(404,{error:'Page not found.'});return true;
 }
 const membership=await db.from('audit_memberships').select('tenant_id,audit_tenants(id,name,status)').eq('user_id',user.user.id);
 if(membership.error)throw membership.error;
 if(url.pathname==='/api/portal/me'&&req.method==='GET'){
  // Administrators browse the paginated company directory, avoiding a truncated global selector.
  send(200,{email:user.user.email,user_id:user.user.id,is_admin:isAdmin,companies:membership.data?.map(m=>m.audit_tenants).filter(Boolean)});return true;
 }
 const tenant=uuid.parse(url.searchParams.get('company'));
 if(!isAdmin&&!membership.data?.some(m=>m.tenant_id===tenant)){send(403,{error:'You do not have access to this company.'});return true;}
 const action=url.pathname.match(/^\/api\/portal\/jobs\/([a-f0-9-]+)\/(retry|review)$/);
 if(action&&req.method==='POST'){
 const job=uuid.parse(action[1]);const {note}=z.object({note:z.string().trim().min(5).max(2000)}).parse(await body(req));
 const {error}=await db.rpc('portal_job_action',{p_user:user.user.id,p_tenant:tenant,p_job:job,p_action:action[2],p_note:note});
 if(error){send(409,{error:'Unable to save. Check the current case status and try again.'});return true;}
 send(200,{ok:true});return true;
 }
 const tables:Record<string,[string,string]>={jobs:['audit_inbound_jobs','id,email_id,status,error_code,result,created_at,started_at,finished_at'],invoices:['invoices','id,numero_fatura,numero_carga,carrier_name,mc_number,data_fatura,valor_total,origem,destino,created_at'],reports:['audit_runs','run_id,report,created_at'],exceptions:['exceptions','id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,created_at'],history:['audit_job_reviews','id,job_id,action,note,actor_email,actor_role,created_at']};
 const table=tables[url.pathname.split('/').pop()??''];
 if(table&&req.method==='GET'){
 const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0);
 const {data,error,count}=await db.from(table[0]).select(table[1],{count:'exact'}).eq('tenant_id',tenant).order('created_at',{ascending:false}).order(table[0]==='audit_runs'?'run_id':'id').range(page*50,page*50+49);
 if(error)throw error;send(200,{rows:data,total:count,page});return true;
 }
 send(404,{error:'Page not found.'});
 }catch(error){send(error instanceof z.ZodError||error instanceof SyntaxError?400:503,{error:'Unable to complete the request. Check your information and try again.'});}
 return true;
}
