'use strict';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const date=value=>value?new Date(value).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'}):'—';
const invoiceDate=value=>{if(!value)return '—';const [year,month,day]=value.split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}).format(new Date(year,month-1,day));};
const badge=status=>`<span class="badge ${escape(status)}">${escape(status)}</span>`;
const names={jobs:'Processing queue',invoices:'Invoices',reports:'Reports',exceptions:'Exceptions',history:'Review history'};
const subtitles={jobs:'Track every document from submission to completion.',invoices:'View processed invoices for your company.',reports:'Audit results to support your decisions.',exceptions:'Review the issues that need a closer look.',history:'A record of every review and resubmission, with notes and timestamps.'};
let view='jobs',page=0,rows=[],total=0,selected=null,requestId=0,companies=[],currentUser=null;
async function api(path,options={}){
 const response=await fetch('/api/portal/'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 const data=await response.json();
 if(!response.ok){if(response.status===401){$('portal').hidden=true;$('login').hidden=false;$('login-message').textContent=data.error;}throw new Error(data.error||'Unable to load data.');}return data;
}
function message(text){$('message').textContent=text;$('message').hidden=!text;}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;$('login-message').textContent='Requesting your sign-in link…';
 try{await api('login',{method:'POST',body:JSON.stringify({email:$('email').value.trim()})});$('login-message').textContent='If this email is registered, you will receive a sign-in link. Please also check your spam folder.';}
 catch(error){$('login-message').textContent=error.message;}finally{button.disabled=false;}
});
async function initialize(){
 try{
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('error_description')){history.replaceState(null,'','/');throw new Error('This link has expired or has already been used. Request a new link.');}
 if(hash.has('access_token')){const access_token=hash.get('access_token');history.replaceState(null,'','/');await api('session',{method:'POST',body:JSON.stringify({access_token})});}
 const me=await api('me');currentUser=me;companies=me.companies??[];$('login').hidden=true;$('portal').hidden=false;$('account-email').textContent=me.email;
 if(me.is_admin){adminPortal.start(me,{api,onOpen:openCompany,onNavigate:()=>{requestId++;$('refresh').disabled=false;message('');}});return;}
 $('company').innerHTML=companies.map(c=>`<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('');
 if(!companies.length){$('company').innerHTML='<option>No company assigned</option>';message('Your account is active, but no company has been assigned. Contact your account administrator.');render();return;}
 await load();
 }catch(error){$('login-message').textContent=error.message;}
}
function openCompany(company){
 companies=[company];$('company').innerHTML=`<option value="${escape(company.id)}">${escape(company.name)}</option>`;
 $('customer-workspace').hidden=false;$('admin-workspace').hidden=true;$('admin-context').hidden=false;
 $('admin-context').textContent=`Administrator access · ${company.name} · Actions are recorded as ${currentUser.email}`;
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view==='jobs');b.setAttribute('aria-current',b.dataset.view==='jobs'?'page':'false');});
 view='jobs';page=0;$('search').value='';$('status').value='';load();
}
async function load(silent=false){
 if(!$('company').value)return;
 const id=++requestId;const company=$('company').value;
 if(!silent){$('table-body').innerHTML='';$('empty').hidden=false;$('empty').textContent='Loading data…';}
 $('refresh').disabled=true;
 try{const data=await api(`${view}?company=${encodeURIComponent(company)}&page=${page}`);if(id!==requestId)return;rows=data.rows;total=data.total;message('');$('company-name').textContent=companies.find(c=>c.id===company)?.name??'YOUR OPERATION';render();}
 catch(error){if(id!==requestId)return;message(error.message);if(!silent){rows=[];total=0;render();$('empty').textContent='Unable to load data. Select Refresh to try again.';}}
 finally{if(id===requestId)$('refresh').disabled=false;}
}
function render(){
 $('title').textContent=names[view];$('breadcrumb').textContent=names[view];$('subtitle').textContent=subtitles[view];$('list-title').textContent=names[view];$('total').textContent=`${total} record${total===1?'':'s'}`;$('status').hidden=view!=='jobs';
 $('metrics').hidden=view!=='jobs';
 $('metrics').innerHTML=[['queued','Queued','Waiting to be processed'],['processing','Processing','Audit in progress'],['completed','Completed','Report available'],['needs_review','Needs review','Review before resubmitting']].map(([key,label,description])=>`<div class="metric ${key==='needs_review'?'attention':''}"><small>${label}</small><strong>${rows.filter(r=>r.status===key).length.toString().padStart(2,'0')}</strong><small>${description}</small></div>`).join('');
 const query=$('search').value.toLowerCase();const filtered=rows.filter(r=>(!query||JSON.stringify(r).toLowerCase().includes(query))&&(view!=='jobs'||!$('status').value||r.status===$('status').value));
 const columns={jobs:['Submission','Received','Status','Exceptions',''],invoices:['Invoice / load','Carrier','Route','Amount',''],reports:['Report','Generated','Invoices','Exceptions','Amount under review',''],exceptions:['Rule','Description','Amount involved','Date',''],history:['Action','Submission','Notes','Performed by','Date','']};
 $('table-head').innerHTML='<tr>'+columns[view].map(c=>`<th scope="col">${c}</th>`).join('')+'</tr>';
 $('table-body').innerHTML=filtered.map(r=>{
 const short=escape((r.id??r.run_id).slice(0,8).toUpperCase());let cells=[];
 if(view==='jobs')cells=[`AUD-${short}<small>Email ${escape(r.email_id?.slice(0,8))}</small>`,date(r.created_at),badge(r.status),r.result?.total_exceptions??'—'];
 if(view==='invoices')cells=[`${escape(r.numero_fatura)}<small>Load ${escape(r.numero_carga)}</small>`,`${escape(r.carrier_name)}<small>MC ${escape(r.mc_number)}</small>`,`${escape(r.origem)} → ${escape(r.destino)}`,money(r.valor_total)];
 if(view==='reports')cells=[`AUD-${short}`,date(r.created_at),r.report?.total_invoices_processed??0,r.report?.total_exceptions??0,money(r.report?.valor_total_under_review)];
 if(view==='exceptions')cells=[escape(r.tipo_regra),escape(r.descricao?.slice(0,85)),money(r.valor_envolvido),date(r.created_at)];
 if(view==='history')cells=[r.action==='retry'?'Resubmitted to queue':'Review saved',escape(r.job_id?.slice(0,8)),escape(r.note?.slice(0,85)),`${escape(r.actor_email??'Legacy record')}<small>${escape(r.actor_role??'customer')}</small>`,date(r.created_at)];
 return '<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+`<td><button class="row-action" data-id="${escape(r.id??r.run_id)}">View details ↗</button></td></tr>`;
 }).join('');
 $('empty').hidden=filtered.length>0;$('empty').textContent=rows.length?'No results match your filters.':'No records yet. Incoming documents will appear here.';
 $('page-label').textContent=total?`Page ${page+1} of ${Math.ceil(total/50)} · ${filtered.length} shown`:'No records';$('previous').disabled=page===0;$('next').disabled=(page+1)*50>=total;
}
function detail(row){
 selected=row;const report=row.report??row.result;
 const field=(label,value)=>`<p><small>${label}</small>${escape(value)}</p>`;
 let html=`<h2>${view==='invoices'?'Invoice '+escape(row.numero_fatura):names[view]}</h2><p class="muted">${escape(row.id??row.run_id)}</p>`;
 if(view==='jobs')html+=badge(row.status)+`<div class="detail-grid">${field('Received',date(row.created_at))}${field('Started',date(row.started_at))}${field('Finished',date(row.finished_at))}${field('Reason',row.error_code)}</div>`;
 if(view==='invoices')html+=`<div class="detail-grid">${field('Carrier',row.carrier_name)}${field('MC',row.mc_number)}${field('Load',row.numero_carga)}${field('Amount',money(row.valor_total))}${field('Origin',row.origem)}${field('Destination',row.destino)}${field('Invoice date',invoiceDate(row.data_fatura))}</div>`;
 if(report){html+=`<div class="detail-grid">${field('Invoices processed',report.total_invoices_processed)}${field('Exceptions detected',report.total_exceptions)}${field('Amount under review',money(report.valor_total_under_review))}</div>`;
 for(const e of report.exceptions??[])html+=`<div class="exception"><strong>${escape(e.rule_label??e.tipo_regra)}</strong><p>${escape(e.descricao)}</p><small>Invoice ${escape(e.invoice_id)} · ${money(e.valor_envolvido)} · ${escape(e.source_reference?.file)} · Page ${escape(e.source_reference?.page)}</small></div>`;
 for(const warning of report.warnings??[])html+=`<p class="muted">${escape(warning)}</p>`;
 if(report.skipped_files?.length)html+=`<p class="muted">Previously processed documents: ${escape(report.skipped_files.join(', '))}</p>`;
 html+='<button id="download-report">Download report JSON ↓</button>';}
 if(view==='exceptions')html+=`<div class="exception"><strong>${escape(row.tipo_regra)}</strong><p>${escape(row.descricao)}</p></div><div class="detail-grid">${field('Amount involved',money(row.valor_envolvido))}${field('Invoice',row.invoice_id)}${field('Document',row.source_file)}${field('Page',row.source_page)}</div>`;
 if(view==='history')html+=`<div class="detail-grid">${field('Action',row.action==='retry'?'Resubmission':'Review')}${field('Date',date(row.created_at))}${field('Submission',row.job_id)}${field('Performed by',row.actor_email??'Legacy record')}${field('Role',row.actor_role??'customer')}</div><p>${escape(row.note)}</p>`;
 $('detail-content').innerHTML=html;$('detail-message').textContent='';$('note').value='';$('review-form').hidden=view!=='jobs'||!['needs_review','blocked','completed','ignored'].includes(row.status);
 $('review-form').querySelector('[value="retry"]').hidden=!['needs_review','blocked'].includes(row.status);
 $('download-report')?.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`audit-${report.run_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('detail').showModal();
}
$('table-body').addEventListener('click',event=>{const button=event.target.closest('[data-id]');if(button)detail(rows.find(r=>(r.id??r.run_id)===button.dataset.id));});
$('close-dialog').addEventListener('click',()=>$('detail').close());
$('review-form').addEventListener('submit',async event=>{
 event.preventDefault();const action=event.submitter.value;const buttons=[...$('review-form').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try{await api(`jobs/${selected.id}/${action}?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({note:$('note').value.trim()})});$('detail-message').textContent=action==='retry'?'Case resubmitted to the queue.':'Review saved to history.';$('review-form').hidden=true;if(action==='retry'){const statusBadge=$('detail-content').querySelector('.badge');if(statusBadge){statusBadge.className='badge queued';statusBadge.textContent='queued';}}await load(true);}
 catch(error){$('detail-message').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(currentUser?.is_admin&&!$('company').value){adminPortal.show('companies');return;}adminPortal.leave();if(currentUser?.is_admin)$('admin-context').hidden=false;$('customer-workspace').hidden=false;$('admin-workspace').hidden=true;view=button.dataset.view;page=0;$('search').value='';$('status').value='';document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-current',b===button?'page':'false');});load();}));
$('company').addEventListener('change',()=>{page=0;$('search').value='';$('status').value='';load();});
$('search').addEventListener('input',render);$('status').addEventListener('change',render);
$('previous').addEventListener('click',()=>{page--;load();});$('next').addEventListener('click',()=>{page++;load();});$('refresh').addEventListener('click',()=>{if(!$('admin-workspace').hidden)adminPortal.refresh();else load();});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:'{}'});location.assign('/');}catch(error){message(error.message);}});
setInterval(()=>{if(!$('portal').hidden&&!document.hidden&&!$('detail').open&&$('admin-workspace').hidden)load(true);},30000);
initialize();
