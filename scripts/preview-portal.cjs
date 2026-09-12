// Isolated, loopback-only preview. No credentials, database, email or paid calls.
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const adminMode=process.argv.includes('--admin');
const port=adminMode?3102:3101;
const demoCompanies=[{id:'11111111-1111-4111-8111-111111111111',name:'Northline Logistics · DEMO',alias:'northline-demo',status:'active',is_test:true,created_at:'2026-09-06T12:00:00Z'},{id:'22222222-2222-4222-8222-222222222222',name:'Atlas Freight · DEMO',alias:'atlas-demo',status:'paused',is_test:true,created_at:'2026-09-05T12:00:00Z'}];
const demoUsers=[{id:'33333333-3333-4333-8333-333333333333',email:'owner@example.com',is_admin:true,enabled:true,companies:[],last_sign_in_at:'2026-09-06T12:00:00Z'},{id:'44444444-4444-4444-8444-444444444444',email:'customer@example.com',is_admin:false,enabled:true,companies:[demoCompanies[0]],last_sign_in_at:null}];
const activity=[];
const crmStages=[['free_audit','Auditoria gratuita'],['followup_1','Follow-up D+1'],['followup_3','Follow-up D+3'],['followup_5','Follow-up D+5'],['followup_10','Follow-up D+10'],['followup_30','Follow-up D+30'],['trial','Teste de 7 dias'],['active','Cliente ativo'],['churn','Churn']];
const crmRows=crmStages.map(([stage],index)=>({id:`crm-${index}`,email:`lead${index+1}@example.com`,contact_name:['Maya Chen','Jordan Lee','Noah Williams','Sophia Davis','Liam Brown','Emma Wilson','Oliver Jones','Ava Taylor','Ethan Moore'][index],company_name:['Summit Freight','Northstar Logistics','Harbor Transport','Blue Route','Ironwood Cargo','Coastal Lines','Redwood Freight','Atlas Transport','Westline Logistics'][index],phone:`+1 555 01${String(index).padStart(2,'0')}`,loads_per_month:index<3?'101-500':'501-1500',status:'completed',created_at:'2026-09-01T12:00:00Z',updated_at:`2026-09-${String(index+2).padStart(2,'0')}T12:00:00Z`,completed_at:'2026-09-01T13:00:00Z',utm_source:index%2?'linkedin':'google',utm_medium:'cpc',utm_campaign:'freight-audit-us',utm_term:null,utm_content:index%2?'case-study':'hero',stage,latest_followup:[0,1,3,5,10,30,30,30,30][index],invoice_count:6,last_activity_at:`2026-09-${String(index+2).padStart(2,'0')}T12:00:00Z`,followups:[1,3,5,10,30].map(day=>({request_id:`crm-${index}`,day_offset:day,status:day<=[0,1,3,5,10,30,30,30,30][index]?'sent':'pending',sent_at:day<=[0,1,3,5,10,30,30,30,30][index]?'2026-09-08T12:00:00Z':null})),subscription:['trial','active','churn'].includes(stage)?{status:stage==='trial'?'trialing':stage==='active'?'active':'canceled',plan_code:'growth',billing_period:'semiannual',trial_ends_at:stage==='trial'?'2026-09-18T12:00:00Z':null,canceled_at:stage==='churn'?'2026-09-10T12:00:00Z':null,last_paid_amount_cents:stage==='active'||stage==='churn'?538200:null,last_paid_currency:stage==='active'||stage==='churn'?'usd':null,last_paid_at:stage==='active'||stage==='churn'?'2026-09-09T12:00:00Z':null}:null}));
const company='11111111-1111-4111-8111-111111111111';
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const exception={id:id(20),invoice_id:id(10),tipo_regra:'banking_change',rule_label:'Banking information changed',valor_envolvido:2480,descricao:'The banking information differs from this carrier’s history. Verify the change before releasing payment.',source_file:'invoice-1042.pdf',source_page:1,source_reference:{file:'invoice-1042.pdf',page:1},created_at:'2026-09-06T14:32:00Z'};
const report={run_id:id(3),generated_at:'2026-09-06T14:32:00Z',total_invoices_processed:3,total_exceptions:1,valor_total_under_review:2480,exceptions:[exception]};
const jobs=['needs_review','processing','queued','completed','completed','blocked'].map((status,i)=>({id:id(i+1),email_id:id(i+100),status,created_at:'2026-09-06T14:32:00Z',error_code:status==='needs_review'?'PROCESSING_FAILED':null,result:status==='completed'?report:null}));
const data={jobs,invoices:[{id:id(10),numero_fatura:'INV-1042',numero_carga:'LD-80291',carrier_name:'Northline Transport (sample)',mc_number:'123456',origem:'Dallas, TX',destino:'Atlanta, GA',valor_total:2480,data_fatura:'2026-09-05',created_at:'2026-09-06T14:32:00Z'}],reports:[{run_id:id(3),report,created_at:'2026-09-06T14:32:00Z'}],exceptions:[exception],history:[]};
createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/portal/')){
 res.setHeader('Content-Type','application/json');const route=url.pathname.slice(12);
 if(route==='me'){res.end(JSON.stringify({email:adminMode?'owner@example.com · SAMPLE DATA':'demo@example.com · SAMPLE DATA',user_id:demoUsers[0].id,is_admin:adminMode,companies:adminMode?[]:[demoCompanies[0]]}));return;}
 if(route.startsWith('admin/')){
 if(!adminMode){res.writeHead(403);res.end('{"error":"Admin demo is available on port 3102."}');return;}
 if(route==='admin/action'&&req.method==='POST'){
 let raw='';for await(const chunk of req)raw+=chunk;const p=JSON.parse(raw);const now=new Date().toISOString();
 if(p.action==='company.create')demoCompanies.unshift({id:randomUUID(),name:p.name,alias:p.alias,status:'inactive',is_test:true,created_at:now});
 if(p.action==='company.update')Object.assign(demoCompanies.find(c=>c.id===p.id),{name:p.name,status:p.status});
 if(p.action==='user.create')demoUsers.push({id:randomUUID(),email:p.email,enabled:true,is_admin:false,companies:[demoCompanies.find(c=>c.id===p.company_id)],last_sign_in_at:null});
 const target=demoUsers.find(u=>u.id===p.user_id);
 if(p.action==='user.enable')target.enabled=p.enabled;
 if(p.action==='user.role')target.is_admin=p.role==='admin';
 if(p.action==='membership.add')target.companies.push(demoCompanies.find(c=>c.id===p.company_id));
 if(p.action==='membership.remove')target.companies=target.companies.filter(c=>c.id!==p.company_id);
 activity.unshift({id:randomUUID(),actor_email:'owner@example.com',action:p.action,tenant_id:p.company_id??p.id,target_user_id:p.user_id,company_name:demoCompanies.find(c=>c.id===(p.company_id??p.id))?.name??p.name,target_email:target?.email??p.email,details:p,created_at:now});
 res.end('{"ok":true}');return;
 }
 if(route==='admin/crm'){res.end(JSON.stringify({rows:crmRows,total:crmRows.length,stages:crmStages.map(([id,label])=>({id,label,count:crmRows.filter(row=>row.stage===id).length})),truncated:false}));return;}
 const list=route==='admin/companies'?demoCompanies:route==='admin/users'?demoUsers:activity;const page=Number(url.searchParams.get('page')??0);
 res.end(JSON.stringify({rows:list.slice(page*50,page*50+50),total:list.length,page}));return;
 }
 const action=route.match(/^jobs\/([^/]+)\/(retry|review)$/);
 if(action&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const job=jobs.find(j=>j.id===action[1]);if(action[2]==='retry')job.status='queued';data.history.unshift({id:id(Date.now()),job_id:job.id,action:action[2],note:body.note,actor_email:adminMode?'owner@example.com':'customer@example.com',actor_role:adminMode?'admin':'customer',created_at:new Date().toISOString()});res.end('{"ok":true}');return;}
 if(data[route]){const scoped=url.searchParams.get('company')===company?data[route]:[];res.end(JSON.stringify({rows:scoped,total:scoped.length,page:0}));return;}
 res.end('{"ok":true}');return;
 }
 const files={'/':'index.html','/dashboard.js':'dashboard.js','/dashboard.css':'dashboard.css','/admin.js':'admin.js'};const file=files[url.pathname];
 if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(__dirname,'../public',file)));
}).listen(port,'127.0.0.1',()=>console.log(`Demo with fictional data: http://127.0.0.1:${port}`));
