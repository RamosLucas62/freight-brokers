'use strict';
const $=id=>document.getElementById(id);
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const date=value=>value?new Date(value).toLocaleString('en-US',{dateStyle:'short',timeStyle:'short'}):'—';
const invoiceDate=value=>{if(!value)return '—';const [year,month,day]=value.split('-').map(Number);return new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}).format(new Date(year,month-1,day));};
const badge=status=>`<span class="badge ${escape(status)}">${escape(status)}</span>`;
const riskLabels={LOW_CONFIDENCE:'Low Extraction Confidence',DUPLICATE_EXACT:'Exact Duplicate Invoice',DUPLICATE_PROBABLE:'Probable Duplicate Invoice',BANKING_CHANGE:'Banking Information Changed',MC_DIVERGENCE:'MC# Name Mismatch (FMCSA)',AUTHORITY_INACTIVE:'Carrier Authority Inactive',CARRIER_VERIFICATION_REQUIRED:'Carrier Identification Needs Review',RATE_CONFIRMATION_MISMATCH:'Rate Confirmation Mismatch',UNSUPPORTED_ACCESSORIAL:'Unsupported Accessorial Charge',UNBILLED_ACCESSORIAL:'Potential Unbilled Accessorial Revenue'};
const riskLabel=code=>{if(!code)return 'Invoice Risk';return riskLabels[code]??String(code).toLowerCase().split('_').filter(Boolean).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(' ');};
const jobReason=(row={},report)=>({
 PROCESSING_FAILED:'Processing was interrupted. Review the submission and resubmit it when the service is available.',
 OPENROUTER_TIMEOUT_OR_NETWORK:'The document analysis provider remained unavailable after automatic retries. No manual action is needed unless the issue continues.',
 OPENROUTER_INVALID_RESPONSE:'The document analysis provider did not return a usable result after automatic retries.',
 OPENROUTER_HTTP_ERROR:'The document analysis provider rejected the request. Review the document format and resubmit it; contact support if it happens again.',
 FMCSA_TIMEOUT_OR_NETWORK:'FMCSA remained unavailable after automatic retries. Review the submission before trying again.',
 FMCSA_INVALID_RESPONSE:'FMCSA did not return a usable response after automatic retries.',
 TMS_EVIDENCE_INCOMPLETE:'Waiting for matching freight evidence. Open this submission to see missing or uncertain documents; add them to the TMS record for another collection.',
 EMAIL_INTAKE_DISABLED_TMS:'Email intake is disabled because automatic TMS import is active. This email was not audited. Manage the connection in Settings.',
 ACCOUNT_UNAVAILABLE:'Processing is paused because the account is not currently available.',
 SENDER_AUTHENTICATION_FAILED:'The sender could not be authenticated.',
 SENDER_NOT_AUTHORIZED_OR_QUOTA:'The sender is not authorized for this private intake, or the plan limit was reached.',
 NO_PDF_ATTACHMENTS:'No supported PDF attachment was found in this email.',
 AUTOMATIC_EMAIL:'Automatic or reply-generated email ignored.',
 WORKER_INTERRUPTED:'Processing was interrupted before completion. Review before resubmitting.',
}[row?.error_code]??(row?.error_code||(row?.status==='completed'&&Number(report?.total_exceptions)>0
 ?`Processing completed with ${Number(report.total_exceptions).toLocaleString('en-US')} item${Number(report.total_exceptions)===1?'':'s'} requiring review.`
 :row?.status==='completed'?'Processing completed. No items require review.':'No processing issue reported.')));
const names={jobs:'Processing queue',invoices:'Invoices',reports:'Reports',exceptions:'Exceptions',history:'Review history',settings:'Settings & billing'};
const subtitles={jobs:'Track every document from submission to completion.',invoices:'View processed invoices for your company.',reports:'Audit results to support your decisions.',exceptions:'Review the issues that need a closer look.',history:'A record of every review and resubmission, with notes and timestamps.',settings:'Choose who receives reports and keep your subscription up to date.'};
let view='jobs',page=0,rows=[],total=0,selected=null,requestId=0,companies=[],currentUser=null,settingsData=null;
const DATA_CACHE_TTL=15000;
const dataCache=new Map();
const dataRequests=new Map();
let activeLoadController=null;
let turnstileWidgets={};
const productGuideSteps=[
 {section:'DOCUMENT SETUP',title:'How will your documents arrive?',description:'Choose your TMS to connect automatic document delivery. If you do not use a TMS or yours is not supported, we will guide you through email intake.',points:['Email stays available until a TMS batch passes the initial evidence check.','Report emails continue normally.','Disconnecting the last TMS restores email intake.'],stage:'Connect'},
 {section:'SETTINGS & BILLING',title:'Configure where documents and reports go.',description:'Settings & billing is the control room for your company. Start here whenever a recipient, sender or billing detail changes.',points:['Connect a supported TMS to collect documents automatically.','Without an active TMS, copy your private email address and authorize senders.','Check connection status and choose who receives reports.'],stage:'Send'},
 {section:'PROCESSING QUEUE',title:'Follow every submission from the queue.',description:'Each TMS document batch or accepted email becomes a submission. The queue shows whether it is waiting, processing, complete or needs your attention.',points:['Queued and processing items are still moving through the audit.','Completed submissions have results ready to review.','Blocked or needs review items explain what your team should check.'],stage:'Process'},
 {section:'INVOICES & REPORTS',title:'Move from source data to the audit result.',description:'Invoices contains the structured record extracted from each document. Reports summarizes what Olympian found across the submission.',points:['Use Invoices to verify carrier, load, route and amount.','Use Reports for totals, findings and the amount under review.','Open a row whenever you need the supporting detail.'],stage:'Review'},
 {section:'EXCEPTIONS & HISTORY',title:'Resolve findings and keep the evidence.',description:'Exceptions is your action list. Review history preserves what was decided, by whom and when, so the next dispute starts with context.',points:['Confirm the financial outcome of a finding.','Resubmit eligible exceptions when new evidence arrives.','Return to this guide anytime from the sidebar.'],stage:'Decide'},
];
let productGuideStep=0,guideProviders=null,guideCompany=null,guideSelection='';
function renderProductGuide(){
 const step=productGuideSteps[productGuideStep],totalSteps=productGuideSteps.length;$('guide-step-label').textContent=`Step ${productGuideStep+1} of ${totalSteps}`;$('guide-section').textContent=step.section;$('guide-title').textContent=step.title;$('guide-description').textContent=step.description;$('guide-number').textContent=String(productGuideStep+1).padStart(2,'0');$('guide-points').innerHTML=step.points.map(point=>`<li>${escape(point)}</li>`).join('');$('guide-route').innerHTML=productGuideSteps.map((item,index)=>`<span class="${index===productGuideStep?'active':index<productGuideStep?'complete':''}"><i></i>${escape(item.stage)}</span>`).join('');$('guide-progress-bar').style.transform=`scaleX(${(productGuideStep+1)/totalSteps})`;$('product-guide').querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(productGuideStep+1));$('guide-previous').disabled=productGuideStep===0;$('guide-next').innerHTML=productGuideStep===totalSteps-1?'Start with the queue <span>→</span>':'Next <span>→</span>';$('guide-feedback').textContent='';
 $('guide-next').classList.toggle('primary',productGuideStep!==0);if(productGuideStep===0)$('guide-next').textContent='Explore the portal →';
 renderGuideIntakeChoice();
}
async function openProductGuide(){
 if(!currentUser||currentUser.is_admin)return;
 productGuideStep=0;guideCompany=$('company').value;guideProviders=null;guideSelection='';renderProductGuide();
 const dialog=$('product-guide');if(!dialog.open)dialog.showModal();requestAnimationFrame(()=>$('guide-title').focus());
 const company=guideCompany;
 try{const result=await api(`integrations?company=${encodeURIComponent(company)}`);if(guideCompany!==company||$('company').value!==company)return;guideProviders=result.providers;guideSelection=guideProviders.find(p=>p.connection?.status==='verified'&&p.connection?.sync_enabled&&p.connection?.intake_validated_at)?.id??'';renderGuideIntakeChoice();}
 catch{if(guideCompany===company&&$('company').value===company){guideProviders=false;renderGuideIntakeChoice();}}
}
function renderGuideIntakeChoice(){
 let card=$('guide-intake-choice');
 if(!card){card=document.createElement('div');card.id='guide-intake-choice';card.className='integration-form';$('guide-points').after(card);}
 card.hidden=productGuideStep!==0;if(card.hidden)return;
 if(!guideProviders){card.innerHTML=guideProviders===false?'<p role="alert">Could not check available connections.</p><button id="guide-retry-intake" type="button">Retry</button>':'<p role="status">Checking available connections…</p>';$('guide-retry-intake')?.addEventListener('click',openProductGuide);return;}
 const active=guideProviders.find(p=>p.connection?.status==='verified'&&p.connection?.sync_enabled&&p.connection?.intake_validated_at);
 card.innerHTML=`<label for="guide-tms">Your transportation management system</label><select id="guide-tms"><option value="">Choose your system</option>${guideProviders.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}${p.mode==='unavailable'||!p.setup_available?' — email intake available':''}</option>`).join('')}<option value="email">I do not use a TMS / my TMS is not listed</option></select><p id="guide-intake-note" class="muted"></p><button id="guide-setup-intake" class="primary" type="button" disabled>Continue setup →</button>`;
 $('guide-tms').value=guideSelection;
 const draw=()=>{guideSelection=$('guide-tms').value;const provider=guideProviders.find(p=>p.id===guideSelection);const email=guideSelection==='email'||(provider&&(provider.mode==='unavailable'||!provider.setup_available));
  $('guide-intake-note').textContent=active?'Your TMS import is active. Email intake is disabled. Manage or disconnect your connections in Settings.':email?'We will show your private email address, authorized senders and how to send your first PDF.':provider?`${provider.instructions} Email intake turns off only after the first TMS batch has a validated invoice, signed POD and rate confirmation.`:'Select your system to see the next step.';
  $('guide-setup-intake').disabled=!guideSelection;$('guide-setup-intake').textContent=active?'Manage document connection →':email?'Set up email intake →':'Set up TMS connection →';
 };
 $('guide-tms').addEventListener('change',draw);draw();
 $('guide-setup-intake').addEventListener('click',async()=>{
  if($('company').value!==guideCompany){openProductGuide();return;}
  const provider=guideProviders.find(p=>p.id===guideSelection);const email=!active&&(guideSelection==='email'||(provider&&(provider.mode==='unavailable'||!provider.setup_available)));
  selectedTms=active?.id??provider?.id??'rose-rocket';closeProductGuide();dataCache.clear();await navigateToView('settings');
  const target=$(email?'email-intake-guide':'tms-panel');target?.scrollIntoView({block:'start',behavior:'smooth'});target?.focus();
 });
}
function closeProductGuide(openQueue=false){const dialog=$('product-guide');if(dialog.open)dialog.close();if(currentUser)currentUser.show_guide=false;api('guide/complete',{method:'POST',body:'{}'}).catch(()=>message('The guide was closed, but we could not save that preference. It may appear again the next time you sign in.'));if(openQueue)navigateToView('jobs');}
async function continueCustomerOnboarding(){
 if(!companies.length){$('company').innerHTML='<option>No company assigned</option>';message('Your account is active, but no company has been assigned. Contact your account administrator.');render();return;}
 await load();if(currentUser.show_guide)openProductGuide();
}
function openLegalAcceptance(){
 $('legal-acceptance-versions').textContent=`Terms version ${currentUser.terms_version} · Privacy version ${currentUser.privacy_version}`;
 const dialog=$('legal-acceptance');if(!dialog.open)dialog.showModal();requestAnimationFrame(()=>$('accept-terms').focus());
}
$('legal-acceptance').addEventListener('cancel',event=>event.preventDefault());
$('legal-acceptance-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;$('legal-acceptance-message').textContent='Recording your acceptance…';
 try{await api('legal/accept',{method:'POST',body:JSON.stringify({terms_accepted:true,privacy_acknowledged:true})});currentUser.requires_legal_acceptance=false;$('legal-acceptance').close();await continueCustomerOnboarding();}
 catch(error){$('legal-acceptance-message').textContent=error.message;button.disabled=false;}
});
async function initializeSecurity(){
 try{const config=await api('security-config');if(!config.turnstile_site_key)return;await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script);});turnstileWidgets.login=turnstile.render('#login-turnstile',{sitekey:config.turnstile_site_key});}catch{$('login-message').textContent='Security verification could not be loaded. Refresh the page.';}
}
const turnstileToken=name=>globalThis.turnstile&&turnstileWidgets[name]!=null?turnstile.getResponse(turnstileWidgets[name]):undefined;
async function api(path,options={}){
 const csrfEntry=document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith('audit_csrf=')||value.startsWith('__Host-audit_csrf='));const csrf=csrfEntry?.slice(csrfEntry.indexOf('=')+1);const response=await fetch('/api/portal/'+path,{...options,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':decodeURIComponent(csrf)}:{}),...options.headers}});
 const data=await response.json();
 if(!response.ok){if(response.status===401){$('portal').hidden=true;$('login').hidden=false;$('login-message').textContent=data.error;}throw new Error(data.error||'Unable to load data.');}return data;
}
function message(text){$('message').textContent=text;$('message').hidden=!text;}
let onboardingRecipients=[],onboardingMaxRecipients=3,onboardingCompleted=false;
function onboardingFeedback(kind,title,text){
 const dialog=$('onboarding-feedback');dialog.dataset.kind=kind;$('onboarding-feedback-title').textContent=title;$('onboarding-feedback-text').textContent=text;
 if(!dialog.open)dialog.showModal();
}
function renderOnboardingRecipients(){
 const list=$('recipient-tags');if(!list)return;list.replaceChildren();
 onboardingRecipients.forEach(email=>{const chip=document.createElement('span');chip.className='recipient-chip';chip.textContent=email;const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label',`Remove ${email}`);remove.textContent='×';remove.addEventListener('click',()=>{onboardingRecipients=onboardingRecipients.filter(value=>value!==email);renderOnboardingRecipients();});chip.append(remove);list.append(chip);});
 const limit=onboardingMaxRecipients>=500?'500 technical limit':String(onboardingMaxRecipients);$('recipient-count').textContent=`${onboardingRecipients.length} / ${limit}`;
 $('recipient-input').disabled=onboardingRecipients.length>=onboardingMaxRecipients;
}
function addOnboardingRecipient(raw,announce=true){
 const input=$('recipient-input');const email=raw.trim().toLowerCase();if(!email)return true;
 input.value=email;input.setCustomValidity('');
 if(!input.checkValidity()){if(announce)input.reportValidity();return false;}
 if(onboardingRecipients.includes(email)){input.value='';return true;}
 if(onboardingRecipients.length>=onboardingMaxRecipients){input.setCustomValidity(`Your plan allows up to ${onboardingMaxRecipients} report recipients.`);if(announce)input.reportValidity();return false;}
 onboardingRecipients.push(email);input.value='';renderOnboardingRecipients();return true;
}
function populateTimezones(selectId='timezone',preferred){
 const select=$(selectId);if(!select)return;const detected=preferred||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const zones=['UTC',...(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo','Europe/London','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'])];
 const groups=new Map();zones.forEach(zone=>{const region=zone.includes('/')?zone.split('/')[0]:'Universal';if(!groups.has(region))groups.set(region,[]);groups.get(region).push(zone);});
 select.replaceChildren();groups.forEach((values,region)=>{const group=document.createElement('optgroup');group.label=region;values.forEach(zone=>{const option=document.createElement('option');option.value=zone;option.textContent=zone.replaceAll('_',' ');group.append(option);});select.append(group);});
 if(!zones.includes(detected)){const option=document.createElement('option');option.value=detected;option.textContent=detected.replaceAll('_',' ');select.prepend(option);}select.value=detected;
}
function configureOnboardingForm(){
 const form=$('onboarding-form');form.innerHTML=`<label for="company-name">Company name</label><input id="company-name" required minlength="2" maxlength="200" placeholder="Acme Logistics"><label for="onboarding-email">Portal access email</label><input id="onboarding-email" type="email" autocomplete="email" required placeholder="you@company.com"><div class="recipient-label"><label for="recipient-input">Report recipients</label><span id="recipient-count">0 / 3</span></div><div class="recipient-picker"><div id="recipient-tags" class="recipient-tags"></div><input id="recipient-input" type="email" autocomplete="off" placeholder="Type an email and press Enter" aria-describedby="recipient-help"></div><small id="recipient-help" class="field-help">Press Enter after each address. New recipients confirm ownership before receiving reports.</small><label for="timezone">Company time zone</label><select id="timezone" required aria-describedby="timezone-help"></select><small id="timezone-help" class="field-help">Reports arrive at 7:00 AM in this time zone.</small><button class="primary" type="submit" disabled>Create account <span>→</span></button>`;
 if(!$('onboarding-feedback')){const dialog=document.createElement('dialog');dialog.id='onboarding-feedback';dialog.setAttribute('aria-labelledby','onboarding-feedback-title');dialog.innerHTML='<div class="feedback-mark" aria-hidden="true">✓</div><p class="eyebrow">ACCOUNT SETUP</p><h2 id="onboarding-feedback-title"></h2><p id="onboarding-feedback-text" class="muted"></p><button id="close-onboarding-feedback" class="primary" type="button">Got it</button>';document.body.append(dialog);$('close-onboarding-feedback').addEventListener('click',()=>dialog.close());}
 populateTimezones();
 $('recipient-input').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===','||event.key===';'){event.preventDefault();addOnboardingRecipient(event.currentTarget.value);}});
 $('recipient-input').addEventListener('paste',event=>{const values=event.clipboardData?.getData('text').split(/[;,\n]/).map(value=>value.trim()).filter(Boolean)??[];if(values.length>1){event.preventDefault();values.forEach(value=>addOnboardingRecipient(value,false));renderOnboardingRecipients();}});
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;$('login-message').textContent='Requesting your sign-in link…';
 try{await api('login',{method:'POST',body:JSON.stringify({email:$('email').value.trim(),turnstile_token:turnstileToken('login')})});$('login-message').textContent='If this email is registered, you will receive a sign-in link. Please also check your spam folder.';}
 catch(error){$('login-message').textContent=error.message;}finally{if(globalThis.turnstile&&turnstileWidgets.login!=null)turnstile.reset(turnstileWidgets.login);button.disabled=false;}
});
$('onboarding-form').addEventListener('submit',async event=>{
 event.preventDefault();const params=new URLSearchParams(location.search);const button=event.submitter;
 if($('recipient-input').value.trim()&&!addOnboardingRecipient($('recipient-input').value))return;
 const owner=$('onboarding-email').value.trim().toLowerCase();if(owner&&!onboardingRecipients.includes(owner)){if(!addOnboardingRecipient(owner))return;}
 if(!onboardingRecipients.length){$('recipient-input').setCustomValidity('Add at least one report recipient.');$('recipient-input').reportValidity();return;}
 button.disabled=true;button.firstChild.textContent='Creating account ';$('onboarding-message').textContent='Creating your account…';
 try{
  await api('onboarding',{method:'POST',body:JSON.stringify({session_id:params.get('session_id'),company_name:$('company-name').value.trim(),email:owner,timezone:$('timezone').value,report_emails:onboardingRecipients})});
  onboardingCompleted=true;button.firstChild.textContent='Account created ';$('onboarding-message').textContent='Account created. Access email sent.';
  onboardingFeedback('success','Your account is ready.',`We sent a secure access email to ${owner}. Open it and select “Access the platform” to enter your account.`);
 }
 catch(error){$('onboarding-message').textContent=error.message;onboardingFeedback('error','We could not create your account.',error.message);}finally{if(!onboardingCompleted){button.disabled=false;button.firstChild.textContent='Create account ';}}
});
async function initialize(){
 try{
 if(location.pathname==='/onboarding/thanks'){$('login').hidden=true;$('thanks-page').hidden=false;return;}
 await initializeSecurity();
 if(location.pathname==='/verify-recipient'){
  const token=new URLSearchParams(location.search).get('token');if(!token)throw new Error('This confirmation link is invalid.');
  const result=await api('recipient/confirm',{method:'POST',body:JSON.stringify({token})});history.replaceState(null,'','/');$('login-message').textContent=`${result.email} is confirmed and can now receive reports.`;return;
 }
 if(location.pathname==='/onboarding'){
  $('signin-panel').hidden=true;$('onboarding-panel').hidden=false;configureOnboardingForm();
  const sessionId=new URLSearchParams(location.search).get('session_id');if(!sessionId){onboardingFeedback('error','This setup link is incomplete.','Open the newest setup email from Olympian and use its button.');return;}
  try{const context=await api(`onboarding/context?session_id=${encodeURIComponent(sessionId)}`);onboardingMaxRecipients=context.max_recipients;$('recipient-help').textContent=context.max_recipients>=500?`${context.plan_name} supports multiple recipients (500-address technical safety limit). Press Enter after each address.`:`${context.plan_name} includes up to ${context.max_recipients} recipients. Press Enter after each address.`;if(context.email){$('onboarding-email').value=context.email;$('onboarding-email').readOnly=true;addOnboardingRecipient(context.email,false);}renderOnboardingRecipients();$('onboarding-form').querySelector('button[type="submit"]').disabled=false;}
  catch(error){onboardingFeedback('error','We could not verify this setup link.',error.message);}
  return;
 }
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('error_description')){history.replaceState(null,'','/');throw new Error('This link has expired or has already been used. Request a new link.');}
 if(hash.has('access_token')){const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token');history.replaceState(null,'','/');await api('session',{method:'POST',body:JSON.stringify({access_token,...(refresh_token?{refresh_token}:{})})});}
 const me=await api('me');currentUser=me;companies=me.companies??[];$('login').hidden=true;$('portal').hidden=false;$('account-email').textContent=me.email;$('open-guide').hidden=me.is_admin;
 if(me.is_admin){adminPortal.start(me,{api,onOpen:openCompany,onNavigate:()=>{requestId++;$('refresh').disabled=false;message('');}});return;}
 $('company').innerHTML=companies.map(c=>`<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('');
 if(me.requires_legal_acceptance){openLegalAcceptance();return;}
 await continueCustomerOnboarding();
 }catch(error){$('login-message').textContent=error.message;}
}
function openCompany(company){
 companies=[company];$('company').innerHTML=`<option value="${escape(company.id)}">${escape(company.name)}</option>`;
 $('customer-workspace').hidden=false;$('admin-workspace').hidden=true;$('admin-context').hidden=false;
 $('admin-context').textContent=`Administrator access · ${company.name} · Actions are recorded as ${currentUser.email}`;
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view==='jobs');b.setAttribute('aria-current',b.dataset.view==='jobs'?'page':'false');});
 view='jobs';page=0;$('search').value='';$('status').value='';load();
}
function cacheKey(company,requestedView,requestedPage){return `${company}:${requestedView}:${requestedPage}`;}
function applyLoadedData(data,company,requestedView){
 $('company-name').textContent=companies.find(c=>c.id===company)?.name??'YOUR OPERATION';
 if(requestedView==='settings'){settingsData=data;renderSettings();return;}
 rows=Array.isArray(data.rows)?data.rows.filter(row=>row&&typeof row==='object'):[];
 const parsedTotal=Number(data.total);total=Number.isFinite(parsedTotal)?parsedTotal:rows.length;render();
}
function schedulePrefetch(company,requestedView){
 if(requestedView==='settings')return;
 const views=['jobs','invoices','reports','exceptions','history'].filter(item=>item!==requestedView);
 const run=()=>views.reduce((promise,nextView)=>promise.then(()=>prefetch(company,nextView)),Promise.resolve());
 if(typeof requestIdleCallback==='function')requestIdleCallback(()=>void run(),{timeout:1200});
 else setTimeout(()=>void run(),150);
}
async function prefetch(company,requestedView){
 const key=cacheKey(company,requestedView,0);const cached=dataCache.get(key);
 if(cached&&Date.now()-cached.at<DATA_CACHE_TTL)return;
 if(dataRequests.has(key))return dataRequests.get(key);
 const request=api(`${requestedView}?company=${encodeURIComponent(company)}&page=0`).then(data=>{dataCache.set(key,{data,at:Date.now()});}).catch(()=>{}).finally(()=>dataRequests.delete(key));
 dataRequests.set(key,request);return request;
}
async function load(silent=false,options={}){
 if(!$('company').value)return;
 const id=++requestId;const company=$('company').value;const requestedView=view;const requestedPage=page;const key=cacheKey(company,requestedView,requestedPage);const cached=dataCache.get(key);
 if(activeLoadController)activeLoadController.abort();
 activeLoadController=new AbortController();
 if(cached&&!options.force&&!silent){applyLoadedData(cached.data,company,requestedView);if(Date.now()-cached.at<DATA_CACHE_TTL){schedulePrefetch(company,requestedView);return;}}
 if(!cached&&!silent){$('empty').hidden=false;$('empty').textContent='Loading data…';}
 $('refresh').disabled=true;
 try{const data=await api(`${requestedView}?company=${encodeURIComponent(company)}&page=${requestedPage}`,{signal:activeLoadController.signal});if(id!==requestId||view!==requestedView||$('company').value!==company)return;dataCache.set(key,{data,at:Date.now()});message('');applyLoadedData(data,company,requestedView);schedulePrefetch(company,requestedView);}
 catch(error){if(error?.name==='AbortError'||id!==requestId)return;message(error.message);if(!cached&&!silent&&requestedView!=='settings'){rows=[];total=0;render();$('empty').textContent='Unable to load data. Select Refresh to try again.';}}
 finally{if(id===requestId)$('refresh').disabled=false;}
}
function render(){
 $('settings-panel').hidden=true;$('records-panel').hidden=false;$('table-footnote').hidden=false;
 $('title').textContent=names[view];$('breadcrumb').textContent=names[view];$('subtitle').textContent=subtitles[view];$('list-title').textContent=names[view];$('total').textContent=`${total} record${total===1?'':'s'}`;$('status').hidden=view!=='jobs';
 $('metrics').hidden=view!=='jobs';
 $('metrics').innerHTML=[['queued','Queued','Waiting to be processed'],['processing','Processing','Audit in progress'],['completed','Completed','Report available'],['needs_review','Needs review','Review before resubmitting']].map(([key,label,description])=>`<div class="metric ${key==='needs_review'?'attention':''}"><small>${label}</small><strong>${rows.filter(r=>r.status===key).length.toString().padStart(2,'0')}</strong><small>${description}</small></div>`).join('');
 const query=$('search').value.toLowerCase();const filtered=rows.filter(r=>(!query||JSON.stringify(r).toLowerCase().includes(query))&&(view!=='jobs'||!$('status').value||r.status===$('status').value));
 const columns={jobs:['Submission','Received','Status','Result',''],invoices:['Invoice / load','Carrier','Route','Amount',''],reports:['Report','Generated','Invoices','Exceptions','Amount under review',''],exceptions:['Rule','Description','Amount involved','Date',''],history:['Action','Submission','Notes','Performed by','Date','']};
 $('table-head').innerHTML='<tr>'+columns[view].map(c=>`<th scope="col">${c}</th>`).join('')+'</tr>';
 $('table-body').innerHTML=filtered.map(r=>{
 const short=escape((r.id??r.run_id).slice(0,8).toUpperCase());let cells=[];
 if(view==='jobs')cells=[`AUD-${short}<small>${r.source==='tms'?`TMS · ${escape(r.tms_provider)} · ${escape(r.tms_record_id)}`:`Email ${escape(r.email_id?.slice(0,8))}`}</small>`,date(r.created_at),badge(r.status),r.result?`${r.result.total_exceptions??0} exception${r.result.total_exceptions===1?'':'s'}`:`<small>${escape(jobReason(r,r.result))}</small>`];
 if(view==='invoices')cells=[`${escape(r.numero_fatura)}<small>Load ${escape(r.numero_carga)}</small>`,`${escape(r.carrier_name)}<small>MC ${escape(r.mc_number)}</small>`,`${escape(r.origem)} → ${escape(r.destino)}`,money(r.valor_total)];
 if(view==='reports')cells=[`AUD-${short}`,date(r.created_at),r.report?.total_invoices_processed??0,r.report?.total_exceptions??0,money(r.report?.valor_total_under_review)];
 if(view==='exceptions')cells=[`${escape(riskLabel(r.tipo_regra))}<small>${escape(r.resolution_status??'pending')}</small>`,escape(r.descricao?.slice(0,85)),money(r.valor_envolvido),date(r.created_at)];
 if(view==='history')cells=[r.action==='retry'?'Resubmitted to queue':'Review saved',escape(r.job_id?.slice(0,8)),escape(r.note?.slice(0,85)),`${escape(r.actor_email??'Legacy record')}<small>${escape(r.actor_role??'customer')}</small>`,date(r.created_at)];
 return '<tr>'+cells.map(c=>`<td>${c}</td>`).join('')+`<td><button class="row-action" data-id="${escape(r.id??r.run_id)}">View details ↗</button></td></tr>`;
 }).join('');
 $('empty').hidden=filtered.length>0;$('empty').textContent=rows.length?'No results match your filters.':'No records yet. Incoming documents will appear here.';
 $('page-label').textContent=total?`Page ${page+1} of ${Math.ceil(total/50)} · ${filtered.length} shown`:'No records';$('previous').disabled=page===0;$('next').disabled=(page+1)*50>=total;
}
let settingsEmailValues={recipients:[],senders:[]};
const settingsEmailConfig={recipients:{input:'settings-recipient-input',tags:'settings-recipient-tags',count:'settings-recipient-count',label:'report recipients'},senders:{input:'settings-sender-input',tags:'settings-sender-tags',count:'settings-sender-count',label:'authorized senders'}};
function renderSettingsEmailPicker(kind,max,enabled){
 const config=settingsEmailConfig[kind],list=$(config.tags),input=$(config.input);if(!list||!input)return;list.replaceChildren();
 settingsEmailValues[kind].forEach(email=>{const chip=document.createElement('span');chip.className='recipient-chip';chip.textContent=email;if(enabled){const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label',`Remove ${email}`);remove.textContent='×';remove.addEventListener('click',()=>{settingsEmailValues[kind]=settingsEmailValues[kind].filter(value=>value!==email);renderSettingsEmailPicker(kind,max,enabled);});chip.append(remove);}list.append(chip);});
 const limit=max>=500?'500 technical limit':String(max);$(config.count).textContent=`${settingsEmailValues[kind].length} / ${limit}`;input.disabled=!enabled||settingsEmailValues[kind].length>=max;
}
function addSettingsEmail(kind,raw,max,enabled,announce=true){
 const config=settingsEmailConfig[kind],input=$(config.input),email=raw.trim().toLowerCase();if(!email)return true;input.value=email;input.setCustomValidity('');
 if(!input.checkValidity()){if(announce)input.reportValidity();return false;}if(settingsEmailValues[kind].includes(email)){input.value='';return true;}
 if(settingsEmailValues[kind].length>=max){input.setCustomValidity(`Your plan allows up to ${max} ${config.label}.`);if(announce)input.reportValidity();return false;}
 settingsEmailValues[kind].push(email);input.value='';renderSettingsEmailPicker(kind,max,enabled);return true;
}
function setupSettingsEmailPicker(kind,max,enabled){
 const input=$(settingsEmailConfig[kind].input);input.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===','||event.key===';'){event.preventDefault();addSettingsEmail(kind,event.currentTarget.value,max,enabled);}});
 input.addEventListener('paste',event=>{const values=event.clipboardData?.getData('text').split(/[;,\n]/).map(value=>value.trim()).filter(Boolean)??[];if(values.length>1){event.preventDefault();values.forEach(value=>addSettingsEmail(kind,value,max,enabled,false));renderSettingsEmailPicker(kind,max,enabled);}});
 renderSettingsEmailPicker(kind,max,enabled);
}
function roseIntegrationCard(rose){
 const status=rose.status??'disconnected';
 const state=status==='active'?[rose.intake_validated_at?'Initial collection validated · email intake off':'Collecting · evidence validation pending','PDFs attached to orders are received after order-status updates and checked again automatically. Existing orders need a status update before their first import. '+(rose.intake_validated_at?'Email intake is disabled; report emails continue.':'Email intake stays available until an actual batch passes the evidence check.')]:status==='pending'?['Setup incomplete','Reconnect to enable automatic document delivery.']:['Not connected','Your email intake works without a TMS connection.'];
 const action=!rose.can_manage?'<p class="muted">Only the company owner or billing administrator can manage this connection.</p>':status!=='active'&&!rose.setup_available?'<p class="muted">Olympian needs to finish secure setup for this connection. Contact support to enable it; do not send credentials.</p><button type="button" data-tms-help>Get setup help</button>':status!=='active'?`<form id="rose-connection-form" class="integration-form" autocomplete="off"><p class="muted">In Rose Rocket, create an OAuth application and service account. Copy the four values from its Request Details. Do not enter your personal password.</p><label>Paste Request Details JSON (optional)<input id="rose-details" type="password" autocomplete="new-password" placeholder="Paste the JSON request body from Rose Rocket"></label><button id="rose-fill" type="button">Fill connection details</button><div class="integration-fields"><label>Organization ID<input name="org_id" required autocomplete="off" placeholder="UUID"></label><label>Service account user ID<input name="user_id" required autocomplete="off" placeholder="UUID"></label><label>Client ID<input name="client_id" required autocomplete="off"></label><label>Client secret<input name="client_secret" type="password" required autocomplete="new-password"></label></div><button class="primary" type="submit">Connect and import automatically →</button><p id="rose-feedback" role="status" class="muted"></p></form>`:`<div class="integration-actions"><span>Organization ${escape(rose.org_id)}<br><small>Verified ${escape(date(rose.connected_at))}</small></span><button id="rose-disconnect" type="button">Disconnect</button></div><p id="rose-feedback" role="status" class="muted"></p>`;
 return `<section class="settings-card integration-card"><div class="integration-heading"><div><p class="eyebrow">OPTIONAL TMS CONNECTION</p><h3>Rose Rocket</h3></div><span class="integration-state ${escape(status)}">${escape(state[0])}</span></div><p class="muted">${escape(state[1])}</p>${action}<a class="integration-help" href="https://roserocket.readme.io/docs/rose-rocket-api-oauth-20-authentication-guide" target="_blank" rel="noopener noreferrer">How to create a Rose Rocket integration account ↗</a></section>`;
}
function renderSettings(){
 const data=settingsData;const emailEnabled=data.notifications.email_intake_enabled===true;const billing=data.billing;const status=billing?.status??'not linked';
 const rose=data.integrations?.rose_rocket??{setup_available:false,can_manage:false,status:'disconnected'};
 const recipients=data.notifications.report_emails??[];const canManageNotifications=data.notifications.can_manage;const maxRecipients=data.notifications.max_recipients??3;const maxSenders=data.notifications.max_senders??3;settingsEmailValues={recipients:recipients.map(item=>item.email),senders:[...(data.notifications.inbound_senders??[])]};
 const copy={trialing:['Free trial active','Invoice auditing and scheduled reports are available during your trial.',billing?.trial_ends_at?`Your first charge is scheduled for ${date(billing.trial_ends_at)} unless you cancel first.`:'Manage or cancel your trial in Stripe.'],active:['Active and protected','Invoice auditing and scheduled reports are available.','No action is needed.'],past_due:['Payment needs attention','Stripe could not collect a payment. Processing remains available during the short grace period.',billing?.payment_grace_until?`Update the card before ${date(billing.payment_grace_until)} to avoid suspension.`:'Update the payment method to restore service.'],paused:['Paused','Your data is preserved while invoice processing is paused.',billing?.paused_until?`Service returns automatically on ${date(billing.paused_until)}.`:'Update the payment method to resume processing.'],canceling:['Cancellation scheduled','Service remains available through the paid billing period.','After cancellation, data is held for 30 days before permanent deletion.'],canceled:['Inactive','Invoice processing and reports are no longer available.',billing?.deletion_scheduled_at?`Data is scheduled for deletion on ${date(billing.deletion_scheduled_at)}.`:'Contact support during the recovery window if needed.']}[status]??['Subscription unavailable','We could not find an active subscription for this company.','Contact your account administrator.'];
 const usage=billing?.usage_count??0;const included=billing?.included_invoices??0;const excess=Math.max(0,usage-included);const estimated=excess*(billing?.overage_unit_amount_cents??0)/100;
 $('title').textContent=names.settings;$('breadcrumb').textContent=names.settings;$('subtitle').textContent=subtitles.settings;$('metrics').hidden=true;$('records-panel').hidden=true;$('table-footnote').hidden=true;$('settings-panel').hidden=false;
 $('settings-panel').innerHTML=`<section class="continuity ${escape(status)}"><p class="eyebrow">ACCOUNT CONTINUITY</p><div><span>${badge(status)}</span><h2>${escape(copy[0])}</h2><p>${escape(copy[1])}</p></div><div class="next-action"><small>NEXT ACTION</small><strong>${escape(copy[2])}</strong></div></section>
 <div class="settings-grid"><form id="notification-settings" class="settings-card"><p class="eyebrow">REPORT DELIVERY</p><h3>Documents and report delivery</h3><section id="email-intake-guide" tabindex="-1">${emailEnabled?`<div class="intake-address"><div><small>EMAIL INTAKE ACTIVE</small><strong>${escape(data.notifications.audit_email??'Address being prepared')}</strong></div><button id="copy-intake" type="button" ${data.notifications.audit_email?'':'disabled'}>Copy address</button></div><p id="copy-feedback" class="copy-feedback" role="status"></p><ol><li>Authorize the sender addresses below and save your settings.</li><li>Send carrier invoices, PODs and rate confirmations as PDF attachments to your private address.</li><li>Open the processing queue to follow your first submission.</li></ol>`:'<p class="integration-state">Email intake disabled · TMS import active</p><p class="muted">Documents arrive through your TMS. Emails sent to the intake address are blocked without auditing. Disconnect all active TMS connections to restore email intake. Report delivery below stays active.</p>'}</section><div class="recipient-label settings-label"><label for="settings-recipient-input">Notification recipients</label><span id="settings-recipient-count"></span></div><div class="recipient-picker settings-picker"><div id="settings-recipient-tags" class="recipient-tags"></div><input id="settings-recipient-input" class="settings-email-input" type="email" autocomplete="off" placeholder="Type an email and press Enter" ${canManageNotifications?'':'disabled'}></div><small class="field-help">Press Enter after each address. New recipients receive a 30-minute confirmation link.</small><ul class="recipient-status">${recipients.map(item=>`<li><span>${escape(item.email)}</span><strong class="${item.verified?'confirmed':'pending'}">${item.verified?'Confirmed':'Confirmation pending'}</strong></li>`).join('')||'<li>No recipients configured</li>'}</ul><div class="recipient-label settings-label"><label for="settings-sender-input">Authorized invoice senders</label><span id="settings-sender-count"></span></div><div class="recipient-picker settings-picker"><div id="settings-sender-tags" class="recipient-tags"></div><input id="settings-sender-input" class="settings-email-input" type="email" autocomplete="off" placeholder="Type an email and press Enter" ${canManageNotifications?'':'disabled'}></div><small class="field-help">These are the exact From addresses allowed to submit documents to your private intake.</small><label for="settings-timezone">Company time zone</label><select id="settings-timezone" required ${canManageNotifications?'':'disabled'}></select><button class="primary" type="submit" ${canManageNotifications?'':'disabled'}>Save notification settings</button><p id="settings-feedback" role="status">${canManageNotifications?'':'Only the company owner or billing administrator can change report delivery.'}</p></form>
 <section class="settings-card"><div class="security-heading"><div><p class="eyebrow">ACCOUNT SECURITY</p><h3>Authenticator verification</h3></div><span class="optional-badge">Optional</span></div><p class="muted">Add a six-digit authenticator code for extra protection. Billing, cancellation and settings continue to work without it.</p><div id="mfa-panel"><button id="setup-mfa">${currentUser.aal==='aal2'?'Authenticator verified':'Set up authenticator'}</button></div></section>
 <section class="settings-card"><p class="eyebrow">BILLING</p><h3>Subscription management</h3><p class="muted">Stripe securely manages your card, invoices and billing details. Plan changes take effect in the next cycle.</p><dl><div><dt>Plan</dt><dd>${escape(({core:'Core',growth:'Growth · Recommended',scale:'Scale'})[billing?.plan_code]??'Core')}</dd></div><div><dt>Contract</dt><dd>${escape({monthly:'Monthly',semiannual:'6 months prepaid',annual:'Annual prepaid'}[billing?.billing_period]??'—')}</dd></div><div><dt>Invoices this month</dt><dd>${usage.toLocaleString()} / ${included.toLocaleString()}</dd></div><div><dt>Estimated overage</dt><dd>${money(estimated)}</dd></div><div><dt>Subscription</dt><dd>${badge(status)}</dd></div><div><dt>Billing owner</dt><dd>${billing?.can_manage?'You can manage billing':'Billing owner access required'}</dd></div></dl><button id="manage-billing" ${billing?.can_manage?'':'disabled'}>Change plan, card or view invoices ↗</button><div class="cancel-zone"><strong>Thinking about leaving?</strong><p>Review flexible options before ending service.</p><button id="open-cancel" ${billing?.can_manage&&['trialing','active'].includes(status)?'':'disabled'}>Review cancellation options</button></div></section></div>`;
 $('settings-panel').querySelector('.settings-grid').insertAdjacentHTML('afterbegin','<section id="tms-panel" tabindex="-1" class="settings-card integration-card"><p role="status">Loading TMS connections…</p></section>');
 loadTmsPanel(rose);
 $('notification-settings').addEventListener('submit',saveNotificationSettings);
 populateTimezones('settings-timezone',data.notifications.timezone);setupSettingsEmailPicker('recipients',maxRecipients,canManageNotifications);setupSettingsEmailPicker('senders',maxSenders,canManageNotifications&&emailEnabled);
 $('copy-intake')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(data.notifications.audit_email);$('copy-feedback').textContent='Private intake address copied.';}catch{$('copy-feedback').textContent='Could not copy automatically. Select the address above to copy it.';}});
 $('manage-billing').addEventListener('click',async()=>{try{await billingRequest('portal');}catch(error){message(error.message);}});
 $('open-cancel').addEventListener('click',()=>showCancellation(status==='trialing'?3:1));
 $('setup-mfa').addEventListener('click',setupMfa);

}

let selectedTms='rose-rocket';
async function loadTmsPanel(rose){
 const panel=$('tms-panel'),company=$('company').value;
 try{
  const result=await api(`integrations?company=${encodeURIComponent(company)}`);
  if(!panel.isConnected||$('company').value!==company)return;
  panel.innerHTML=`<div><p class="eyebrow">DOCUMENT CONNECTIONS</p><h3>Connect your TMS</h3></div><p class="muted">Connect your system once. Supported connectors collect documents and send them to audit automatically.</p><label for="tms-provider">Your transportation management system</label><select id="tms-provider">${result.providers.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}</select><div id="tms-provider-detail"></div>`;
  if(!result.providers.some(p=>p.id===selectedTms))selectedTms='rose-rocket';
  $('tms-provider').value=selectedTms;
  const draw=()=>{
   selectedTms=$('tms-provider').value;const provider=result.providers.find(p=>p.id===selectedTms),detail=$('tms-provider-detail');
   if(provider.id==='rose-rocket'){detail.innerHTML=roseIntegrationCard({...rose,intake_validated_at:provider.connection?.intake_validated_at});if(provider.connection?.sync_enabled)detail.insertAdjacentHTML('beforeend',`<p class="muted">${provider.connection.sync_error?'Sync needs attention. Reconnect after checking API access.':provider.connection.last_synced_at?`Last checked ${escape(date(provider.connection.last_synced_at))}`:'Waiting for the first automatic check.'} · ${Number(provider.connection.imported_batches??0)} document batches queued</p>`);bindRoseConnection();}
   else{
    const state=provider.connection?.status??'disconnected';
    const label=state==='verified'?(provider.connection.sync_error?'Sync needs attention':provider.connection.sync_enabled?(provider.connection.intake_validated_at?'Initial collection validated · email intake off':'Collecting · evidence validation pending'):'Import paused'):provider.mode==='unavailable'?'Not available':'Not connected';
    const note=state==='verified'?(provider.connection.sync_enabled?(provider.connection.intake_validated_at?'Initial document collection validated. Each new batch still needs matching freight evidence. Email intake is disabled; report emails continue.':'Documents are being collected. Email remains available until an actual batch contains a validated carrier invoice, signed POD and rate confirmation. Missing evidence appears in the queue.'):'Enable automatic import to receive documents from this connection.'):provider.mode==='unavailable'?'This connector cannot be activated yet. Olympian needs to complete the vendor integration before it can be offered.':'Connecting starts collection; email stays available until the first batch passes the evidence check. Connect to start importing documents automatically. Tai imports carrier bills and their supporting PDFs; McLeod checks documents on delivered orders.';
    const canConnect=provider.can_manage&&provider.setup_available;
    detail.innerHTML=`<div class="integration-heading"><h3>${escape(provider.name)}</h3><span class="integration-state ${state==='disconnected'?'':'pending'}">${label}</span></div><p class="muted">${note}</p><p>${escape(provider.instructions)}</p>${!provider.can_manage?'<p class="muted">Only the company owner or billing administrator can manage this connection.</p>':state==='verified'||state==='requested'?`<p>${escape(provider.connection.account_label??'Setup request saved')} · ${escape(date(provider.connection.last_synced_at??provider.connection.verified_at??provider.connection.requested_at))}</p>${state==='verified'&&!provider.connection.sync_enabled?'<button class="primary" id="tms-enable" type="button">Enable automatic import</button>':''}${provider.connection.sync_error?'<p role="alert">The last sync failed. Check API access and reconnect. Previously received documents remain in the queue.</p>':''}<button type="button" id="tms-disconnect">${state==='requested'?'Cancel request':'Disconnect'}</button>`:provider.mode==='unavailable'?'<p class="muted">Integration not released.</p>':canConnect?`<form id="tms-connect" class="integration-form" autocomplete="off"><div class="integration-fields">${provider.id==='tai'?'<label>Tai site code<input name="site" required maxlength="63" placeholder="yourcompany"><small>The part before .taicloud.net</small></label><label>API key<input name="api_key" type="password" required maxlength="2048" autocomplete="new-password"></label>':'<label>McLeod service hostname<input name="host" required placeholder="yourcompany.loadtracking.com"></label><label>Company ID<input name="company_id" required placeholder="TMS"></label><label>Integration token<input name="token" type="password" required autocomplete="new-password"></label><label>Document type IDs<input name="document_type_ids" required placeholder="Carrier bill, POD and rate confirmation type IDs"><small>Comma-separated IDs from your McLeod imaging configuration.</small></label>'}</div><button class="primary" type="submit">Connect and import automatically →</button></form>`:'<p class="muted">Olympian needs to configure secure connection storage. Do not send API keys through support.</p><button type="button" data-tms-help>Get setup help</button>'}<p id="tms-feedback" role="status"></p><a class="integration-help" href="${escape(provider.helpUrl)}" target="_blank" rel="noopener noreferrer">${escape(provider.name)} setup reference ↗</a>`;
    const submit=async(action,button,fields={})=>{
     const feedback=$('tms-feedback');button.disabled=true;feedback.textContent=action==='connect'?'Testing API access…':'Saving…';
     try{await api(`integrations/${provider.id}/${action}?company=${encodeURIComponent(company)}`,{method:'POST',body:JSON.stringify(fields)});if(!panel.isConnected||$('company').value!==company)return;$('tms-connect')?.reset();dataCache.clear();await load(false,{force:true});}
     catch(error){if(feedback.isConnected){feedback.textContent=error.message;button.disabled=false;}}
    };
    $('tms-connect')?.addEventListener('submit',event=>{event.preventDefault();const fields=Object.fromEntries(new FormData(event.currentTarget));if(provider.id==='mcleod')fields.document_type_ids=fields.document_type_ids.split(',').map(value=>value.trim()).filter(Boolean);submit('connect',event.submitter,fields);});
    $('tms-enable')?.addEventListener('click',event=>submit('enable',event.currentTarget));
    $('tms-disconnect')?.addEventListener('click',event=>{if(confirm(state==='requested'?'Cancel this setup request?':'Disconnect this TMS? Email intake resumes when no active TMS connections remain. Existing audits will remain.'))submit('disconnect',event.currentTarget);});
   }
   detail.querySelector('[data-tms-help]')?.addEventListener('click',openSupport);
  };
  $('tms-provider').addEventListener('change',draw);draw();
 }catch(error){if(panel.isConnected){panel.innerHTML='<p role="alert">Could not load TMS connections. Your other settings remain available.</p><button type="button" id="tms-retry">Retry</button>';$('tms-retry').onclick=()=>loadTmsPanel(rose);}}
}
function bindRoseConnection(){
 $('rose-fill')?.addEventListener('click',()=>{
  try{const values=JSON.parse($('rose-details').value);for(const name of ['org_id','user_id','client_id','client_secret']){if(typeof values[name]!=='string'||!values[name].trim())throw new Error();}
   for(const name of ['org_id','user_id','client_id','client_secret'])$('rose-connection-form').elements.namedItem(name).value=values[name];
   $('rose-details').value='';$('rose-feedback').textContent='Details filled. Test and save to verify access.';
  }catch{$('rose-feedback').textContent='Paste only the JSON request body containing org_id, user_id, client_id and client_secret.';}
 });
 $('rose-connection-form')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,feedback=$('rose-feedback'),company=$('company').value;const button=form.querySelector('button[type="submit"]');button.disabled=true;feedback.textContent='Verifying access…';
  try{const fields=Object.fromEntries(new FormData(form));await api(`integrations/rose-rocket?company=${encodeURIComponent(company)}`,{method:'POST',body:JSON.stringify(fields)});form.reset();if(form.isConnected&&$('company').value===company)await load(false,{force:true});}
  catch(error){if(feedback.isConnected){feedback.textContent=error.message;button.disabled=false;}}
 });
 $('rose-disconnect')?.addEventListener('click',async event=>{
  if(!confirm('Disconnect Rose Rocket? Email intake resumes when no active TMS connections remain. Existing audits will remain.'))return;
  const button=event.currentTarget,feedback=$('rose-feedback'),company=$('company').value;button.disabled=true;feedback.textContent='Disconnecting…';
  try{await api(`integrations/rose-rocket/disconnect?company=${encodeURIComponent(company)}`,{method:'POST',body:'{}'});if(button.isConnected&&$('company').value===company)await load(false,{force:true});}
  catch(error){if(feedback.isConnected){feedback.textContent=error.message;button.disabled=false;}}
 });
}

async function setupMfa(){
 const panel=$('mfa-panel');panel.textContent='Preparing secure setup…';
 try{const status=await api('mfa/status');let factor=status.factors.find(item=>item.status==='unverified')??status.factors.find(item=>item.status==='verified');let enrollment;
  if(!factor||factor.status==='verified'&&status.aal!=='aal2'){if(factor?.status==='verified'){panel.innerHTML=`<p>Enter the current six-digit code to verify this session.</p><input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button id="verify-mfa">Verify</button>`;}else{enrollment=await api('mfa/enroll',{method:'POST',body:JSON.stringify({friendly_name:'Freight Audit Portal'})});factor={id:enrollment.id,status:'unverified'};panel.innerHTML=`<p>Scan this QR code with your authenticator app, then enter the six-digit code.</p><img alt="Authenticator QR code" src="${escape(enrollment.qr_code)}"><p><small>Manual key: ${escape(enrollment.secret)}</small></p><input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button id="verify-mfa">Verify and enable</button>`;}}
  else{panel.innerHTML='<p>Multi-factor authentication is active for this session.</p>';return;}
  $('verify-mfa').addEventListener('click',async()=>{try{await api('mfa/verify',{method:'POST',body:JSON.stringify({factor_id:factor.id,code:$('mfa-code').value})});currentUser.aal='aal2';panel.innerHTML='<p>Authenticator verified. Extra account protection is active for this session.</p>';}catch(error){panel.insertAdjacentHTML('beforeend',`<p>${escape(error.message)}</p>`);}});
 }catch(error){panel.textContent=error.message;}
}
async function saveNotificationSettings(event){
 event.preventDefault();const maxRecipients=settingsData.notifications.max_recipients??3,maxSenders=settingsData.notifications.max_senders??3;if($('settings-recipient-input').value.trim()&&!addSettingsEmail('recipients',$('settings-recipient-input').value,maxRecipients,true))return;if($('settings-sender-input').value.trim()&&!addSettingsEmail('senders',$('settings-sender-input').value,maxSenders,true))return;if(!settingsEmailValues.recipients.length||!settingsEmailValues.senders.length){const input=!settingsEmailValues.recipients.length?$('settings-recipient-input'):$('settings-sender-input');input.setCustomValidity('Add at least one email address.');input.reportValidity();return;}const button=event.submitter;button.disabled=true;$('settings-feedback').textContent='Saving…';
 try{await api(`settings/notifications?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({timezone:$('settings-timezone').value,report_emails:settingsEmailValues.recipients,inbound_senders:settingsEmailValues.senders})});$('settings-feedback').textContent='Settings saved. New report addresses must confirm by email.';}
 catch(error){$('settings-feedback').textContent=error.message;}finally{button.disabled=false;}
}
async function billingRequest(action){
 const buttons=[...document.querySelectorAll('#settings-panel button,#cancel-dialog button')];buttons.forEach(button=>button.disabled=true);
 try{const key=crypto.randomUUID().replaceAll('-','');const result=await api(`billing/${action}?company=${encodeURIComponent($('company').value)}`,{method:'POST',headers:{'Idempotency-Key':key},body:'{}'});if(result.url){location.assign(result.url);return;}return result;}
 finally{buttons.forEach(button=>button.disabled=false);}
}
function showCancellation(step){
 const billing=settingsData.billing;let html='';
 if(step===1)html=`<h2 id="cancel-title">Stay protected for 15% less next month.</h2><p>Your audit history and automated reports continue without interruption. This one-time discount applies to your next billing period.</p><div class="dialog-actions"><button data-cancel-step="2">Continue</button><button class="primary" id="accept-discount" ${billing.discount_available?'':'disabled'}>${billing.discount_available?'Apply 15% discount':'Discount already used'}</button></div>`;
 if(step===2)html=`<h2 id="cancel-title">Need a break instead?</h2><p>Pause for 30 days. We preserve your company settings and audit history, and service resumes automatically afterward.</p><div class="dialog-actions"><button data-cancel-step="3">Continue to cancellation</button><button class="primary" id="accept-pause" ${billing.pause_available?'':'disabled'}>${billing.pause_available?'Pause for 30 days':'Pause already used this year'}</button></div>`;
 if(step===3){const trial=billing.status==='trialing';html=`<h2 id="cancel-title">${trial?'Cancel your free trial?':'Confirm cancellation.'}</h2><p>${trial?'Your trial remains available until its scheduled end, then the account becomes inactive and your card is not charged.':'Service remains active until the end of your paid period. The account then becomes inactive.'} After a 30-day recovery window, invoices, PDFs, exceptions, reports, recipients and company settings are permanently deleted.</p><label for="cancel-confirm">Type CANCEL to confirm</label><input id="cancel-confirm" autocomplete="off"><div class="dialog-actions">${trial?'':'<button data-cancel-step="2">Go back</button>'}<button class="danger" id="confirm-cancel" disabled>${trial?'Cancel free trial':'Schedule cancellation'}</button></div>`;}
 $('cancel-content').innerHTML=html;$('cancel-message').textContent='';if(!$('cancel-dialog').open)$('cancel-dialog').showModal();
 document.querySelectorAll('[data-cancel-step]').forEach(button=>button.addEventListener('click',()=>showCancellation(Number(button.dataset.cancelStep))));
 $('accept-discount')?.addEventListener('click',async()=>{try{await billingRequest('retention-discount');$('cancel-dialog').close();await load(false,{force:true});message('The 15% discount will be applied to your next billing period.');}catch(error){$('cancel-message').textContent=error.message;}});
 $('accept-pause')?.addEventListener('click',async()=>{try{await billingRequest('pause');$('cancel-dialog').close();await load(false,{force:true});message('Your account is paused for 30 days. Your data remains protected.');}catch(error){$('cancel-message').textContent=error.message;}});
 const confirm=$('cancel-confirm');confirm?.addEventListener('input',()=>{$('confirm-cancel').disabled=confirm.value!=='CANCEL';});
 $('confirm-cancel')?.addEventListener('click',async()=>{try{await billingRequest('cancel');$('cancel-dialog').close();await load(false,{force:true});message('Cancellation is scheduled for the end of the current billing period.');}catch(error){$('cancel-message').textContent=error.message;}});
}
function detail(row){
 selected=row;const report=row.report??row.result;
 const field=(label,value)=>`<p><small>${label}</small>${escape(value)}</p>`;
 let html=`<h2>${view==='invoices'?'Invoice '+escape(row.numero_fatura):names[view]}</h2><p class="muted">${escape(row.id??row.run_id)}</p>`;
 if(view==='jobs')html+=badge(row.status)+`<div class="detail-grid">${field('Received',date(row.created_at))}${field('Started',date(row.started_at))}${field('Finished',date(row.finished_at))}${field('What happened',jobReason(row,report))}</div>`;
 if(view==='jobs'&&row.evidence_issues?.length)html+=`<h3>Evidence needed</h3><ul>${row.evidence_issues.map(issue=>`<li>Load ${escape(issue.load??'not identified')}: ${escape(issue.missing.map(code=>({CARRIER_INVOICE:'carrier invoice',INVOICE_LOAD_NUMBER:'invoice load number',INVOICE_LOAD_REVIEW:'verify invoice load number',INVOICE_DETAILS:'invoice details',POD:'matching POD',SIGNED_POD:'readable signed POD',DELIVERY_DATE:'delivery date',RATE_CONFIRMATION:'matching rate confirmation',AUTHORIZED_TOTAL:'authorized total',POD_REVIEW:'POD review',RATE_CONFIRMATION_REVIEW:'rate confirmation review',AMBIGUOUS_POD:'resolve multiple matching PODs',AMBIGUOUS_RATE_CONFIRMATION:'resolve multiple matching rate confirmations',ACCESSORIAL_DOCUMENT:'additional-charge evidence with a readable matching load reference',ACCESSORIAL_EVIDENCE_REVIEW:'manual review of additional-charge receipts and terms'}[code]??code)).join(', '))}</li>`).join('')}</ul>`;
 if(view==='invoices')html+=`<div class="detail-grid">${field('Carrier',row.carrier_name)}${field('MC',row.mc_number)}${field('Load',row.numero_carga)}${field('Amount',money(row.valor_total))}${field('Origin',row.origem)}${field('Destination',row.destino)}${field('Invoice date',invoiceDate(row.data_fatura))}${field('Verification',row.verification?.status??'Legacy record')}${field('Confidence',row.verification?Math.round(row.verification.confidence*100)+'%':'Not measured')}</div>`;
 if(report){html+=`<div class="detail-grid">${field('Invoices processed',report.total_invoices_processed)}${field('Exceptions detected',report.total_exceptions)}${field('Amount under review',money(report.valor_total_under_review))}${report.confidence?field('Automatically verified',report.confidence.verified)+field('Needs review',report.confidence.review)+field('Unverifiable',report.confidence.unverifiable)+field('Automation rate',Math.round(report.confidence.automation_rate*100)+'%'):''}</div>`;
 for(const e of report.exceptions??[])html+=`<div class="exception"><strong>${escape(e.rule_label??riskLabel(e.tipo_regra))}</strong><p>${escape(e.descricao)}</p><small>Invoice ${escape(e.invoice_id)} · ${money(e.valor_envolvido)} · ${escape(e.source_reference?.file)} · Page ${escape(e.source_reference?.page)}</small></div>`;
 for(const warning of report.warnings??[])html+=`<p class="muted">${escape(warning)}</p>`;
 if(report.skipped_files?.length)html+=`<p class="muted">Previously processed documents: ${escape(report.skipped_files.join(', '))}</p>`;
 html+='<button id="download-report">Download report JSON ↓</button>';}
 if(view==='exceptions')html+=`<div class="exception"><strong>${escape(riskLabel(row.tipo_regra))}</strong><p>${escape(row.descricao)}</p></div><div class="detail-grid">${field('Amount involved',money(row.valor_envolvido))}${field('Invoice',row.invoice_id)}${field('Document',row.source_file)}${field('Page',row.source_page)}${field('Financial outcome',row.resolution_status??'pending')}${field('Confirmed loss avoided',money(row.avoided_amount))}</div>${row.resolution_note?`<p><strong>Outcome notes</strong><br>${escape(row.resolution_note)}</p>`:''}`;
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
function navigateToView(nextView){const button=document.querySelector(`[data-view="${nextView}"]`);if(!button)return;if(currentUser?.is_admin&&!$('company').value){adminPortal.show('companies');return;}adminPortal.leave();if(currentUser?.is_admin)$('admin-context').hidden=false;$('customer-workspace').hidden=false;$('admin-workspace').hidden=true;view=nextView;page=0;$('search').value='';$('status').value='';document.querySelectorAll('[data-view]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-current',item===button?'page':'false');});return load();}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>navigateToView(button.dataset.view)));
const supportHistory=[];let supportConversationId=null,supportStatus='ai',supportSyncing=false;
const escalation=document.createElement('form');escalation.id='support-escalation';escalation.className='support-escalation';escalation.hidden=true;escalation.innerHTML='<strong>Talk to human support</strong><p>Tell us what is happening. A specialist will reply here within 15 minutes.</p><label for="support-problem">What do you need help with?</label><textarea id="support-problem" rows="4" minlength="10" maxlength="2000" required placeholder="Describe the problem and what you were trying to do…"></textarea><div><button id="cancel-escalation" type="button">Not now</button><button class="primary" type="submit">Request support</button></div><small id="support-escalation-feedback" role="status"></small>';$('support-form').before(escalation);
function appendSupportMessage(role,content,{pending=false,label=''}={}){const item=document.createElement('div');item.className=`support-message ${role}${pending?' pending':''}`;if(role==='assistant'){const avatar=document.createElement('span');avatar.className='support-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=label==='Human support'?'H':'O';item.append(avatar);}const body=document.createElement('div');if(label){const name=document.createElement('small');name.textContent=label;body.append(name);}const text=document.createElement('p');text.textContent=content;body.append(text);item.append(body);$('support-messages').append(item);$('support-messages').scrollTop=$('support-messages').scrollHeight;return item;}
function renderSupportConversation(data){const messages=$('support-messages');messages.innerHTML='';supportHistory.length=0;supportConversationId=data.conversation?.id??null;supportStatus=data.conversation?.status??'ai';for(const item of data.messages??[]){const role=item.author_type==='customer'?'user':'assistant';const label=item.author_type==='admin'?'Human support':item.author_type==='ai'?'Olympian AI':'';appendSupportMessage(role,item.body,{label});if(['customer','ai'].includes(item.author_type))supportHistory.push({role:item.author_type==='customer'?'user':'assistant',content:item.body});}if(!data.messages?.length)appendSupportMessage('assistant','Hi — I can help with portal navigation, processing statuses, reports, exceptions, settings, billing, security, and supported integrations.');$('support-suggestions').hidden=Boolean(data.messages?.length)||supportStatus!=='ai';$('support-escalation').hidden=true;$('support-question').placeholder=supportStatus==='waiting'?'Add a message for the support team…':supportStatus==='active'?'Reply to human support…':'Type your question…';}
async function syncSupportConversation(){if(supportSyncing||!$('company').value)return;supportSyncing=true;try{const suffix=supportConversationId?`&conversation=${encodeURIComponent(supportConversationId)}`:'';renderSupportConversation(await api(`support/conversation?company=${encodeURIComponent($('company').value)}${suffix}`));}catch(error){if(!$('support-panel').hidden)appendSupportMessage('assistant',error.message);}finally{supportSyncing=false;}}
async function openSupport(){if(!$('company').value){message('Select a company before opening support.');return;}$('support-panel').hidden=false;$('open-support').classList.add('active');$('open-support').setAttribute('aria-expanded','true');await syncSupportConversation();requestAnimationFrame(()=>$('support-question').focus());}
function closeSupport(){$('support-panel').hidden=true;$('open-support').classList.remove('active');$('open-support').setAttribute('aria-expanded','false');$('open-support').focus();}
function resetSupportConversation(){supportHistory.length=0;supportConversationId=null;supportStatus='ai';renderSupportConversation({conversation:null,messages:[]});}
$('open-support').addEventListener('click',()=>$('support-panel').hidden?openSupport():closeSupport());$('close-support').addEventListener('click',closeSupport);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('support-panel').hidden)closeSupport();});
document.querySelectorAll('#support-suggestions button').forEach(button=>button.addEventListener('click',()=>{$('support-question').value=button.textContent;$('support-form').requestSubmit();}));
$('support-question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('support-form').requestSubmit();}});
$('support-form').addEventListener('submit',async event=>{event.preventDefault();const input=$('support-question'),send=event.submitter??$('support-form').querySelector('button[type="submit"]'),content=input.value.trim();if(!content||!$('company').value)return;appendSupportMessage('user',content);supportHistory.push({role:'user',content});input.value='';input.disabled=true;send.disabled=true;$('support-suggestions').hidden=true;const waiting=appendSupportMessage('assistant',supportStatus==='ai'?'Thinking…':'Sending…',{pending:true});try{const payload=await api(`support?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({messages:supportHistory.slice(-8),context:{view}})});waiting.remove();supportConversationId=payload.conversation_id;supportStatus=payload.status;if(payload.answer){appendSupportMessage('assistant',payload.answer,{label:'Olympian AI'});supportHistory.push({role:'assistant',content:payload.answer});}if(payload.offer_human){$('support-escalation').hidden=false;requestAnimationFrame(()=>$('support-problem').focus());}if(payload.human_active)appendSupportMessage('assistant','Message sent to the support team.',{label:'Support'});}catch(error){waiting.remove();appendSupportMessage('assistant',error.message||'Support is temporarily unavailable. Please try again.');}finally{input.disabled=false;send.disabled=false;input.focus();}});
$('cancel-escalation').addEventListener('click',()=>{$('support-escalation').hidden=true;$('support-question').focus();});
$('support-escalation').addEventListener('submit',async event=>{event.preventDefault();const problem=$('support-problem').value.trim(),button=event.submitter;if(!supportConversationId)return;button.disabled=true;$('support-escalation-feedback').textContent='Sending your request…';try{const payload=await api(`support/escalate?company=${encodeURIComponent($('company').value)}`,{method:'POST',body:JSON.stringify({conversation_id:supportConversationId,problem})});supportStatus=payload.status;$('support-escalation').hidden=true;appendSupportMessage('user',problem);appendSupportMessage('assistant','Your request is in. A support specialist will contact you here within 15 minutes.',{label:'Support'});$('support-question').placeholder='Add a message for the support team…';}catch(error){$('support-escalation-feedback').textContent=error.message;}finally{button.disabled=false;}});
$('open-guide').addEventListener('click',openProductGuide);$('exit-guide').addEventListener('click',()=>closeProductGuide());$('guide-previous').addEventListener('click',()=>{if(productGuideStep>0){productGuideStep--;renderProductGuide();$('guide-title').focus();}});$('guide-next').addEventListener('click',()=>{if(productGuideStep<productGuideSteps.length-1){productGuideStep++;renderProductGuide();$('guide-title').focus();}else closeProductGuide(true);});$('product-guide').addEventListener('cancel',event=>{event.preventDefault();closeProductGuide();});
$('company').addEventListener('change',()=>{page=0;$('search').value='';$('status').value='';resetSupportConversation();closeSupport();load();});
 $('search').addEventListener('input',render);$('status').addEventListener('change',render);
 $('previous').addEventListener('click',()=>{page--;load();});$('next').addEventListener('click',()=>{page++;load();});$('refresh').addEventListener('click',()=>{if(!$('admin-workspace').hidden)adminPortal.refresh();else load(false,{force:true});});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:'{}'});location.assign('/');}catch(error){message(error.message);}});
setInterval(()=>{if(!$('portal').hidden&&!document.hidden&&!$('detail').open&&$('admin-workspace').hidden)load(true);},30000);
setInterval(()=>{if(!$('support-panel').hidden&&!document.hidden&&supportConversationId&&['waiting','active'].includes(supportStatus))syncSupportConversation();},5000);
initialize();
