const {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync}=require('node:fs');
const {tmpdir,userInfo}=require('node:os');
const {join}=require('node:path');
const {execFileSync}=require('node:child_process');

const root=join(__dirname,'..');
const bin=process.env.AUDIT_PG_BIN??(existsSync('/opt/homebrew/opt/postgresql@16/bin/initdb')?'/opt/homebrew/opt/postgresql@16/bin':'');
const dir=mkdtempSync(join(tmpdir(),'audit-reset-db-'));const db=join(dir,'data');let started=false;
try{
 execFileSync(join(bin,'initdb'),['-D',db,'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
 execFileSync(join(bin,'pg_ctl'),['-D',db,'-l',join(dir,'server.log'),'-o',`-k ${dir} -h ''`,'-w','start'],{stdio:'pipe'});started=true;
 let sql="CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$; GRANT USAGE ON SCHEMA auth TO authenticated,service_role; GRANT SELECT ON auth.users TO service_role; GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated,service_role;\n";
 sql+=readFileSync(join(root,'db/schema.sql'),'utf8');
 for(const file of readdirSync(join(root,'db/migrations')).filter(file=>file.endsWith('.sql')).sort())sql+='\n'+readFileSync(join(root,'db/migrations',file),'utf8');
 sql+="\nINSERT INTO auth.users(email) VALUES('ramos.lucas@aiolympian.com'),('customer@example.com'); INSERT INTO public.audit_portal_users(user_id) SELECT id FROM auth.users; INSERT INTO public.audit_memberships(tenant_id,user_id) SELECT '00000000-0000-4000-8000-000000000001',id FROM auth.users WHERE email='customer@example.com'; DROP TABLE public.audit_checkout_acceptances;\n";
 sql+=readFileSync(join(root,'scripts/reset-all-audit-test-data.sql'),'utf8');
 sql+="\nDO $$ BEGIN IF (SELECT count(*) FROM public.audit_tenants)<>0 OR (SELECT count(*) FROM public.audit_admins)<>1 OR (SELECT count(*) FROM public.audit_portal_users)<>1 OR EXISTS(SELECT 1 FROM auth.users WHERE email='customer@example.com') OR NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.audit_admins a ON a.user_id=u.id WHERE u.email='ramos.lucas@aiolympian.com') THEN RAISE EXCEPTION 'Reset validation failed'; END IF; END $$;";
 execFileSync(join(bin,'psql'),['-h',dir,'-U',userInfo().username,'-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:sql,stdio:['pipe','pipe','pipe']});
 console.log('Destructive reset SQL passed in isolated PostgreSQL.');
}catch(error){console.error(String(error.stderr||error.message));process.exitCode=1;}finally{if(started)execFileSync(join(bin,'pg_ctl'),['-D',db,'-m','fast','-w','stop'],{stdio:'pipe'});rmSync(dir,{recursive:true,force:true});}
