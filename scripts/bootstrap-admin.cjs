require('dotenv/config');
const {createClient}=require('@supabase/supabase-js');
const email=process.argv[2]?.trim().toLowerCase();
if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){console.error('Usage: node scripts/bootstrap-admin.cjs owner@example.com');process.exit(1);}
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY){console.error('Configure the Supabase backend environment first.');process.exit(1);}
(async()=>{
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await db.rpc('portal_bootstrap_admin',{p_email:email});
 if(error){console.error('Owner setup failed. Apply migration 005, create this email in Supabase Auth, and ensure no administrator has already been assigned.');process.exit(1);}
 console.log('Initial administrator assigned. Sign in through the portal with your own magic link.');
})().catch(()=>{console.error('Owner setup could not reach the backend.');process.exit(1);});
