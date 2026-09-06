'use strict';
// Management controls use native forms and dialogs; authorization lives on the server.
const adminPortal=(()=>{
 const el=id=>document.getElementById(id);
 const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=value=>value?new Date(value).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'}):'Never';
 let me,hooks,view='companies',page=0,rows=[],total=0,generation=0,selected=null,companyOptions=[],dialogGeneration=0;
 const titles={companies:'Companies',users:'Users & access',activity:'Admin activity'};
 const actionLabels={'company.create':'Company created','company.update':'Company updated','user.create':'User registered','user.register':'User access assigned','user.enable':'Portal access updated','user.role':'User role updated','membership.add':'Company access granted','membership.remove':'Company access removed','job.retry':'Case resubmitted','job.review':'Case reviewed','admin.bootstrap':'Initial administrator assigned'};
 const descriptions={companies:'Manage customer accounts and open their operations.',users:'Manage who can sign in and which companies they can access.',activity:'A traceable record of administrative changes across your operation.'};
 function start(user,callbacks){me=user;hooks=callbacks;el('admin-nav').hidden=false;el('portal-label').textContent='ADMIN CONSOLE';document.title='Freight Audit · Administration';el('company').innerHTML='<option value="">No company selected</option>';show('companies');}
 function leave(){generation++;document.querySelectorAll('[data-admin]').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current');});}
 async function show(next){hooks.onNavigate?.();view=next;page=0;el('admin-context').hidden=true;el('admin-workspace').hidden=false;el('customer-workspace').hidden=true;el('breadcrumb').textContent=titles[view];document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));document.querySelectorAll('[data-admin]').forEach(b=>{b.classList.toggle('active',b.dataset.admin===view);b.setAttribute('aria-current',b.dataset.admin===view?'page':'false');});await refresh();}
 async function refresh(){
 const id=++generation;el('admin-workspace').innerHTML='<p class="muted" role="status">Loading administration…</p>';
 try{const result=await hooks.api(`admin/${view}?page=${page}`);if(id!==generation)return;rows=result.rows??[];total=result.total??0;render();}catch(error){if(id!==generation)return;el('admin-workspace').innerHTML=`<p class="empty" role="alert">${esc(error.message)}</p>`;}
 }
 function render(){
 const columns=view==='companies'?['Company','Invoice inbox','Status','Created','']:view==='users'?['User','Role / access','Companies','Last sign-in','']:['Action','Performed by','Company / user','Date',''];
 el('admin-workspace').innerHTML=`<div class="heading"><div><p class="eyebrow">GLOBAL ADMINISTRATOR</p><h1>${titles[view]}</h1><p class="muted">${descriptions[view]}</p></div>${view!=='activity'?`<button class="primary" id="admin-add">+ ${view==='companies'?'Add company':'Add user'}</button>`:''}</div><div class="table-card"><div class="toolbar"><div><strong>${titles[view]}</strong> <small>${total} records</small></div><input id="admin-search" type="search" placeholder="Search this page…" aria-label="Search administration page"></div><div class="table-scroll"><table><thead><tr>${columns.map(c=>`<th scope="col">${c}</th>`).join('')}</tr></thead><tbody id="admin-rows"></tbody></table></div><p id="admin-empty" class="empty" hidden>No records found.</p><footer><span>Page ${page+1} of ${Math.max(1,Math.ceil(total/50))}</span><div><button id="admin-prev" ${page===0?'disabled':''}>← Previous</button><button id="admin-next" ${(page+1)*50>=total?'disabled':''}>Next →</button></div></footer></div>`;
 renderRows('');el('admin-search').addEventListener('input',event=>renderRows(event.target.value));el('admin-add')?.addEventListener('click',()=>edit(null));el('admin-prev').onclick=()=>{page--;refresh();};el('admin-next').onclick=()=>{page++;refresh();};
 el('admin-rows').onclick=event=>{const button=event.target.closest('button[data-id]');if(!button)return;const row=rows.find(r=>r.id===button.dataset.id);if(button.dataset.open){leave();hooks.onOpen(row);}else edit(row);};
 }
 function renderRows(query){
 const visible=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));el('admin-empty').hidden=visible.length>0;
 el('admin-rows').innerHTML=visible.map(r=>{
 let cells;
 if(view==='companies')cells=[`${esc(r.name)}${r.is_test?'<small>Test account</small>':''}`,`${esc(r.alias)}@audit.aiolympian.com`,`<span class="badge ${r.status==='active'?'completed':'blocked'}">${esc(r.status)}</span>`,when(r.created_at)];
 if(view==='users')cells=[`${esc(r.email)}${r.id===me.user_id?'<small>Your account</small>':''}`,`${r.is_admin?'Global admin':'Customer'}<small>${r.enabled?'Access enabled':'Access disabled'}</small>`,esc(r.companies.map(c=>c.name).join(', ')||'No company assigned'),when(r.last_sign_in_at)];
 if(view==='activity')cells=[esc(actionLabels[r.action]??'Administrative change'),esc(r.actor_email),`${esc(r.company_name??r.details?.name??'—')}<small>${esc(r.target_email??r.details?.email??'')}</small>`,when(r.created_at)];
 return `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}<td>${view==='companies'?`<button class="row-action" data-id="${esc(r.id)}" data-open="true">Open workspace ↗</button>`:''}<button class="row-action" data-id="${esc(r.id)}">${view==='activity'?'Details':'Manage'}</button></td></tr>`;
 }).join('');
 }
 const input=(label,name,value='',extra='')=>`<label for="manage-${name}">${label}</label><input id="manage-${name}" name="${name}" value="${esc(value)}" ${extra}>`;
 async function edit(row){
 const dialogId=++dialogGeneration;selected=row;el('admin-feedback').textContent='';el('admin-dialog-title').textContent=view==='activity'?'Activity details':view==='companies'?(row?'Manage company':'Add company'):(row?'Manage user access':'Add user');
 const form=el('admin-form');
 if(view==='companies')form.innerHTML=input('Company name','name',row?.name??'','required maxlength="200"')+(row?`<label for="manage-status">Account status</label><select id="manage-status" name="status">${['inactive','active','paused'].map(s=>`<option ${row.status===s?'selected':''}>${s}</option>`).join('')}</select><p class="muted">Invoice inbox: ${esc(row.alias)}@audit.aiolympian.com. Paused or inactive companies cannot process new invoices.</p>`:input('Invoice inbox alias','alias','','required maxlength="63" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="acme-logistics"')+'<p class="muted">Creates alias@audit.aiolympian.com. New companies start inactive.</p>')+'<button class="primary" type="submit">Save company</button>';
 else if(view==='activity')form.innerHTML=`<p><strong>${esc(actionLabels[row.action]??'Administrative change')}</strong></p><p class="muted">${esc(row.actor_email)} · ${when(row.created_at)}</p><div class="detail-grid">${Object.entries({Company:row.company_name??row.details?.name,User:row.target_email??row.details?.email,'Inbox alias':row.details?.alias,Status:row.details?.status,Role:row.details?.role,'Portal access':typeof row.details?.enabled==='boolean'?(row.details.enabled?'Enabled':'Disabled'):null,Notes:row.details?.note}).filter(([,value])=>value!=null).map(([label,value])=>`<p><small>${esc(label)}</small>${esc(value)}</p>`).join('')}</div>`;
 else if(!row)form.innerHTML=input('Work email','email','','type="email" required maxlength="254"')+'<label for="manage-company">Company</label><select id="manage-company" name="company_id" required><option value="">Loading companies…</option></select><p class="muted">Creates customer access without a password. No email is sent now. The user can request a sign-in link from the portal.</p><button class="primary" type="submit" disabled>Add user</button>';
 else form.innerHTML=`<p><strong>${esc(row.email)}</strong></p><p class="muted">${row.is_admin?'Global administrators can access every company.':'Customers can access only their assigned companies.'}</p><div class="access-controls"><label for="manage-enabled">Portal access</label><select id="manage-enabled" ${row.id===me.user_id?'disabled':''}><option value="true" ${row.enabled?'selected':''}>Enabled</option><option value="false" ${!row.enabled?'selected':''}>Disabled</option></select><button type="button" id="save-enabled" ${row.id===me.user_id?'disabled':''}>Update access</button><label for="manage-role">Role</label><select id="manage-role" ${row.id===me.user_id?'disabled':''}><option value="customer" ${!row.is_admin?'selected':''}>Customer</option><option value="admin" ${row.is_admin?'selected':''}>Global admin — all companies</option></select><button type="button" id="save-role" ${row.id===me.user_id?'disabled':''}>Update role</button></div><h3>Company access</h3><div>${row.companies.map(c=>`<div class="membership"><span>${esc(c.name)}</span><button type="button" data-revoke="${esc(c.id)}">Remove access</button></div>`).join('')||'<p class="muted">No company memberships.</p>'}</div><label for="manage-company">Grant access to a company</label><select id="manage-company"><option value="">Loading companies…</option></select><button id="grant-company" type="button" disabled>Grant company access</button>`;
 if(!el('admin-dialog').open)el('admin-dialog').showModal();
 form.onsubmit=async event=>{event.preventDefault();const fields=Object.fromEntries(new FormData(form));if(view==='companies')await save({action:row?'company.update':'company.create',...(row?{id:row.id}:{}),...fields});else if(!row)await save({action:'user.create',...fields});};
 if(view==='users'){
 if(row){el('save-enabled').onclick=()=>save({action:'user.enable',user_id:row.id,enabled:el('manage-enabled').value==='true'});el('save-role').onclick=()=>save({action:'user.role',user_id:row.id,role:el('manage-role').value});form.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>save({action:'membership.remove',user_id:row.id,company_id:b.dataset.revoke}));el('grant-company').onclick=()=>save({action:'membership.add',user_id:row.id,company_id:el('manage-company').value});}
 await loadCompanies(row,dialogId);
 }
 }
 async function loadCompanies(row,dialogId){
 try{
 companyOptions=[];let offset=0,expected=1;
 while(companyOptions.length<expected){const data=await hooks.api(`admin/companies?page=${offset++}`);companyOptions.push(...data.rows);expected=data.total;if(!data.rows.length)break;}
 if(dialogId!==dialogGeneration||!el('admin-dialog').open||selected!==row)return;
 const available=companyOptions.filter(c=>!row?.companies.some(m=>m.id===c.id));el('manage-company').innerHTML='<option value="">Select a company</option>'+available.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 const button=row?el('grant-company'):el('admin-form').querySelector('[type="submit"]');button.disabled=!available.length;
 if(!available.length)el('admin-feedback').textContent='No additional companies available. Add a company first if needed.';
 }catch(error){el('admin-feedback').textContent=error.message;}
 }
 async function save(payload){
 const buttons=[...el('admin-form').querySelectorAll('button')];const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);el('admin-feedback').textContent='Saving changes…';
 try{await hooks.api('admin/action',{method:'POST',body:JSON.stringify(payload)});el('admin-dialog').close();await refresh();}
 catch(error){el('admin-feedback').textContent=error.message;buttons.forEach((b,i)=>b.disabled=disabled[i]);}
 }
 document.addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>show(b.dataset.admin));el('admin-dialog-close').onclick=()=>el('admin-dialog').close();});
 return {start,show,refresh,leave};
})();
