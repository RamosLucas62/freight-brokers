'use strict';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const date=value=>value?new Date(value).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'}):'—';
const invoiceDate=value=>{if(!value)return '—';const [year,month,day]=value.split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}).format(new Date(year,month-1,day));};
const badge=status=>`<span class="badge ${escape(status)}">${escape(status)}</span>`;
const names={jobs:'Processing queue',invoices:'Invoices',reports:'Reports',exceptions:'Exceptions',history:'Review history',settings:'Settings & billing'};
const subtitles={jobs:'Track every document from submission to completion.',invoices:'View processed invoices for your company.',reports:'Audit results to support your decisions.',exceptions:'Review the issues that need a closer look.',history:'A record of every review and resubmission, with notes and timestamps.',settings:'Choose who receives reports and keep your subscription up to date.'};
let view='jobs',page=0,rows=[],total=0,selected=null,requestId=0,companies=[],currentUser=null,settingsData=null;
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
$('checkout-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;$('checkout-message').textContent='Opening secure checkout…';
 try{const data=await api('checkout',{method:'POST',body:JSON.stringify({email:$('checkout-email').value.trim()})});location.assign(data.url);}
 catch(error){$('checkout-message').textContent=error.message;}finally{button.disabled=false;}
});
$('onboarding-form').addEventListener('submit',async event=>{
 event.preventDefault();const params=new URLSearchParams(location.search);const button=event.submitter;button.disabled=true;$('onboarding-message').textContent='Creating your account…';
 try{
  const reportEmails=$('report-emails').value.split(/[;,\n]/).map(value=>value.trim()).filter(Boolean);
  const data=await api('onboarding',{method:'POST',body:JSON.stringify({session_id:params.get('session_id'),company_name:$('company-name').value.trim(),email:$('onboarding-email').value.trim(),timezone:$('timezone').value.trim(),report_emails:reportEmails})});
  $('onboarding-message').innerHTML=`Account created. Send invoices to <strong>${escape(data.audit_email)}</strong>. Check your inbox for the portal sign-in link.`;
 }
 catch(error){$('onboarding-message').textContent=error.message;}finally{button.disabled=false;}
});
async function initialize(){
 try{
 if(location.pathname==='/onboarding'){$('signin-panel').hidden=true;$('onboarding-panel').hidden=false;$('timezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';$('onboarding-email').addEventListener('input',()=>{if(!$('report-emails').value.trim())$('report-emails').value=$('onboarding-email').value.trim();});return;}
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
 try{const data=await api(`${view}?company=${encodeURIComponent(company)}&page=${page}`);if(id!==requestId)return;message('');$('company-name').textContent=companies.find(c=>c.id===company)?.name??'YOUR OPERATION';if(view==='settings'){settingsData=data;renderSettings();}else{rows=data.rows;total=data.total;render();}}
 catch(error){if(id!==requestId)return;message(error.message);if(!silent&&view!=='settings'){rows=[];total=0;render();$('empty').textContent='Unable to load data. Select Refresh to try again.';}}
 finally{if(id===requestId)$('refresh').disabled=false;}
}
function render(){
 $('settings-panel').hidden=true;$('records-panel').hidden=false;$('table-footnote').hidden=false;
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
 if(view==='exceptions')cells=[`${escape(r.tipo_regra)}<small>${escape(r.resolution_status??'pending')}</small>`,escape(r.descricao?.slice(0,85)),money(r.valor_envolvido),date(r.created_at)];
 if(view==='history')cells=[r.action==='retry'?'Resubmitted to queue':'Review saved',escape(r.job_id?.slice(0,8)),escape(r.note?.slice(0,85)),`${escape(r.actor_email??'Legacy record')}<small>${escape(r.actor_role??'customer')}</small>`,date(r.created_at)];
 return '<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+`<td><button class="row-action" data-id="${escape(r.id??r.run_id)}">View details ↗</button></td></tr>`;
 }).join('');
 $('empty').hidden=filtered.length>0;$('empty').textContent=rows.length?'No results match your filters.':'No records yet. Incoming documents will appear here.';
 $('page-label').textContent=total?`Page ${page+1} of ${Math.ceil(total/50)} · ${filtered.length} shown`:'No records';$('previous').disabled=page===0;$('next').disabled=(page+1)*50>=total;
}
function renderSettings(){
 const data=settingsData;const billing=data.billing;const status=billing?.status??'not linked';
 const copy={active:['Active and protected','Invoice auditing and scheduled reports are available.','No action is needed.'],past_due:['Payment needs attention','New invoice processing is paused while Stripe retries the payment.','Update the payment method to restore service.'],paused:['Paused','Your data is preserved while invoice processing is paused.',billing?.paused_until?`Service returns automatically on ${date(billing.paused_until)}.`:'Check your subscription before resuming.'],canceling:['Cancellation scheduled','Service remains available through the paid billing period.','After cancellation, data is held for 30 days before permanent deletion.'],canceled:['Inactive','Invoice processing and reports are no longer available.',billing?.deletion_scheduled_at?`Data is scheduled for deletion on ${date(billing.deletion_scheduled_at)}.`:'Contact support during the recovery window if needed.']}[status]??['Subscription unavailable','We could not find an active subscription for this company.','Contact your account administrator.'];
 $('title').textContent=names.settings;$('breadcrumb').textContent=names.settings;$('subtitle').textContent=subtitles.settings;$('metrics').hidden=true;$('records-panel').hidden=true;$('table-footnote').hidden=true;$('settings-panel').hidden=false;
 $('settings-panel').innerHTML=`<section class="continuity ${escape(status)}"><p class="eyebrow">ACCOUNT CONTINUITY</p><div><span>${badge(status)}</span><h2>${escape(copy[0])}</h2><p>${escape(copy[1])}</p></div><div class="next-action"><small>NEXT ACTION</small><strong>${escape(copy[2])}</strong></div></section>
 <div class="settings-grid"><form id="notification-settings" class="settings-card"><p class="eyebrow">REPORT DELIVERY</p><h3>Notification recipients</h3><p class="muted">Daily reports arrive at 7:00 AM in this company time zone. Enter up to 20 addresses.</p><label for="settings-emails">Email addresses</label><textarea id="settings-emails" required>${escape(data.notifications.report_emails.join('\n'))}</textarea><small class="field-help">Use one address per line, or separate them with commas.</small><label for="settings-timezone">Company time zone</label><input id="settings-timezone" list="timezone-options" required value="${escape(data.notifications.timezone)}"><button class="primary" type="submit">Save notification settings</button><p id="settings-feedback" role="status"></p></form>
 <section class="settings-card"><p class="eyebrow">BILLING</p><h3>Subscription management</h3><p class="muted">Stripe securely manages your card, invoices and billing details.</p><dl><div><dt>Subscription</dt><dd>${badge(status)}</dd></div><div><dt>Billing owner</dt><dd>${billing?.can_manage?'You can manage billing':'Billing owner access required'}</dd></div></dl><button id="manage-billing" ${billing?.can_manage?'':'disabled'}>Change card or view invoices ↗</button><div class="cancel-zone"><strong>Thinking about leaving?</strong><p>Review flexible options before ending service.</p><button id="open-cancel" ${billing?.can_manage&&status==='active'?'':'disabled'}>Review cancellation options</button></div></section></div>`;
 $('notification-settings').addEventListener('submit',saveNotificationSettings);
 $('manage-billing').addEventListener('click',async()=>{try{await billingRequest('portal');}catch(error){message(error.message);}});
 $('open-cancel').addEventListener('click',()=>showCancellation(1));
}
async function saveNotificationSettings(event){
 event.preventDefault();const button=event.submitter;button.disabled=true;$('settings-feedback').textContent='Saving…';
 try{const report_emails=$('settings-emails').value.split(/[;,\n]/).map(value=>value.trim()).filter(Boolean);await api(`settings/notifications?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({timezone:$('settings-timezone').value.trim(),report_emails})});$('settings-feedback').textContent='Notification settings saved.';}
 catch(error){$('settings-feedback').textContent=error.message;}finally{button.disabled=false;}
}
async function billingRequest(action){
 const buttons=[...document.querySelectorAll('#settings-panel button,#cancel-dialog button')];buttons.forEach(button=>button.disabled=true);
 try{const result=await api(`billing/${action}?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:'{}'});if(result.url){location.assign(result.url);return;}return result;}
 finally{buttons.forEach(button=>button.disabled=false);}
}
function showCancellation(step){
 const billing=settingsData.billing;let html='';
 if(step===1)html=`<h2 id="cancel-title">Stay protected for 15% less next month.</h2><p>Your audit history and automated reports continue without interruption. This one-time discount applies to your next billing period.</p><div class="dialog-actions"><button data-cancel-step="2">Continue</button><button class="primary" id="accept-discount" ${billing.discount_available?'':'disabled'}>${billing.discount_available?'Apply 15% discount':'Discount already used'}</button></div>`;
 if(step===2)html=`<h2 id="cancel-title">Need a break instead?</h2><p>Pause for 30 days. We preserve your company settings and audit history, and service resumes automatically afterward.</p><div class="dialog-actions"><button data-cancel-step="3">Continue to cancellation</button><button class="primary" id="accept-pause" ${billing.pause_available?'':'disabled'}>${billing.pause_available?'Pause for 30 days':'Pause already used this year'}</button></div>`;
 if(step===3)html=`<h2 id="cancel-title">Confirm cancellation.</h2><p>Service remains active until the end of your paid period. The account then becomes inactive. After a 30-day recovery window, invoices, PDFs, exceptions, reports, recipients and company settings are permanently deleted.</p><label for="cancel-confirm">Type CANCEL to confirm</label><input id="cancel-confirm" autocomplete="off"><div class="dialog-actions"><button data-cancel-step="2">Go back</button><button class="danger" id="confirm-cancel" disabled>Schedule cancellation</button></div>`;
 $('cancel-content').innerHTML=html;$('cancel-message').textContent='';if(!$('cancel-dialog').open)$('cancel-dialog').showModal();
 document.querySelectorAll('[data-cancel-step]').forEach(button=>button.addEventListener('click',()=>showCancellation(Number(button.dataset.cancelStep))));
 $('accept-discount')?.addEventListener('click',async()=>{try{await billingRequest('retention-discount');$('cancel-dialog').close();await load();message('The 15% discount will be applied to your next billing period.');}catch(error){$('cancel-message').textContent=error.message;}});
 $('accept-pause')?.addEventListener('click',async()=>{try{await billingRequest('pause');$('cancel-dialog').close();await load();message('Your account is paused for 30 days. Your data remains protected.');}catch(error){$('cancel-message').textContent=error.message;}});
 const confirm=$('cancel-confirm');confirm?.addEventListener('input',()=>{$('confirm-cancel').disabled=confirm.value!=='CANCEL';});
 $('confirm-cancel')?.addEventListener('click',async()=>{try{await billingRequest('cancel');$('cancel-dialog').close();await load();message('Cancellation is scheduled for the end of the current billing period.');}catch(error){$('cancel-message').textContent=error.message;}});
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
 if(view==='exceptions')html+=`<div class="exception"><strong>${escape(row.tipo_regra)}</strong><p>${escape(row.descricao)}</p></div><div class="detail-grid">${field('Amount involved',money(row.valor_envolvido))}${field('Invoice',row.invoice_id)}${field('Document',row.source_file)}${field('Page',row.source_page)}${field('Financial outcome',row.resolution_status??'pending')}${field('Confirmed loss avoided',money(row.avoided_amount))}</div>${row.resolution_note?`<p><strong>Outcome notes</strong><br>${escape(row.resolution_note)}</p>`:''}`;
 if(view==='history')html+=`<div class="detail-grid">${field('Action',row.action==='retry'?'Resubmission':'Review')}${field('Date',date(row.created_at))}${field('Submission',row.job_id)}${field('Performed by',row.actor_email??'Legacy record')}${field('Role',row.actor_role??'customer')}</div><p>${escape(row.note)}</p>`;
 $('detail-content').innerHTML=html;$('detail-message').textContent='';$('note').value='';$('review-form').hidden=view!=='jobs'||!['needs_review','blocked','completed','ignored'].includes(row.status);$('resolution-form').hidden=view!=='exceptions';if(view==='exceptions'){$('resolution-outcome').value=row.resolution_status==='no_loss'?'no_loss':'avoided';$('avoided-amount').value=row.avoided_amount??row.valor_envolvido??'';$('resolution-note').value=row.resolution_note??'';$('avoided-amount').disabled=$('resolution-outcome').value==='no_loss';}
 $('review-form').querySelector('[value="retry"]').hidden=!['needs_review','blocked'].includes(row.status);
 $('download-report')?.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`audit-${report.run_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 $('detail').showModal();
}
$('table-body').addEventListener('click',event=>{const button=event.target.closest('[data-id]');if(button)detail(rows.find(r=>(r.id??r.run_id)===button.dataset.id));});
$('close-dialog').addEventListener('click',()=>$('detail').close());
$('close-cancel').addEventListener('click',()=>$('cancel-dialog').close());
$('review-form').addEventListener('submit',async event=>{
 event.preventDefault();const action=event.submitter.value;const buttons=[...$('review-form').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try{await api(`jobs/${selected.id}/${action}?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({note:$('note').value.trim()})});$('detail-message').textContent=action==='retry'?'Case resubmitted to the queue.':'Review saved to history.';$('review-form').hidden=true;if(action==='retry'){const statusBadge=$('detail-content').querySelector('.badge');if(statusBadge){statusBadge.className='badge queued';statusBadge.textContent='queued';}}await load(true);}
 catch(error){$('detail-message').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
});
$('resolution-outcome').addEventListener('change',()=>{$('avoided-amount').disabled=$('resolution-outcome').value==='no_loss';});
$('resolution-form').addEventListener('submit',async event=>{event.preventDefault();const outcome=$('resolution-outcome').value;const amount=outcome==='avoided'?Number($('avoided-amount').value):null;try{await api(`exceptions/${selected.id}/resolve?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({outcome,avoided_amount:amount,note:$('resolution-note').value.trim()})});$('detail-message').textContent='Financial outcome saved. It will be reflected in the monthly report.';$('resolution-form').hidden=true;await load(true);}catch(error){$('detail-message').textContent=error.message;}});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(currentUser?.is_admin&&!$('company').value){adminPortal.show('companies');return;}adminPortal.leave();if(currentUser?.is_admin)$('admin-context').hidden=false;$('customer-workspace').hidden=false;$('admin-workspace').hidden=true;view=button.dataset.view;page=0;$('search').value='';$('status').value='';document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-current',b===button?'page':'false');});load();}));
$('company').addEventListener('change',()=>{page=0;$('search').value='';$('status').value='';load();});
$('search').addEventListener('input',render);$('status').addEventListener('change',render);
$('previous').addEventListener('click',()=>{page--;load();});$('next').addEventListener('click',()=>{page++;load();});$('refresh').addEventListener('click',()=>{if(!$('admin-workspace').hidden)adminPortal.refresh();else load();});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:'{}'});location.assign('/');}catch(error){message(error.message);}});
setInterval(()=>{if(!$('portal').hidden&&!document.hidden&&!$('detail').open&&$('admin-workspace').hidden)load(true);},30000);
initialize();
