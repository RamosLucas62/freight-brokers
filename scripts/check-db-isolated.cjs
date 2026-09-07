const {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync}=require('node:fs');const {tmpdir,userInfo}=require('node:os');const {join}=require('node:path');const {execFileSync}=require('node:child_process');
const root=join(__dirname,'..');const bin=process.env.AUDIT_PG_BIN??(existsSync('/opt/homebrew/opt/postgresql@16/bin/initdb')?'/opt/homebrew/opt/postgresql@16/bin':'');const dir=mkdtempSync(join(tmpdir(),'audit-admin-db-'));const db=join(dir,'data');let started=false;
try{
 execFileSync(join(bin,'initdb'),['-D',db,'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'});
 execFileSync(join(bin,'pg_ctl'),['-D',db,'-l',join(dir,'server.log'),'-o',`-k ${dir} -h ''`,'-w','start'],{stdio:'pipe'});started=true;
 let sql="CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('sub',current_setting('request.jwt.claim.sub',true),'aal',current_setting('request.jwt.claim.aal',true)) $$; GRANT USAGE ON SCHEMA auth TO authenticated,service_role; GRANT SELECT ON auth.users TO service_role; GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated,service_role; BEGIN;\n";
 sql+=readFileSync(join(root,'db/schema.sql'),'utf8');
 for(const file of readdirSync(join(root,'db/migrations')).filter(f=>f.endsWith('.sql')).sort())sql+='\n'+readFileSync(join(root,'db/migrations',file),'utf8');
 for(const file of ['tenant-isolation.sql','customer-portal.sql','global-admin.sql','notifications.sql','subscription-lifecycle.sql','security-hardening.sql'])sql+='\n'+readFileSync(join(root,'tests/db',file),'utf8');
 sql+='\nROLLBACK;';
 execFileSync(join(bin,'psql'),['-h',dir,'-U',userInfo().username,'-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:sql,stdio:['pipe','pipe','pipe']});
 console.log('All migrations and tenant, portal and global-admin SQL checks passed in isolated PostgreSQL.');
}catch(e){console.error(String(e.stderr||e.message));process.exitCode=1;}finally{if(started)execFileSync(join(bin,'pg_ctl'),['-D',db,'-m','fast','-w','stop'],{stdio:'pipe'});rmSync(dir,{recursive:true,force:true});}
