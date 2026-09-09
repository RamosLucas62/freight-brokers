import type {AuditReport} from '../types/report.types.js';

const money=(value:number|null|undefined)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value??0));
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const csv=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;

export function verificationEmail(name:string,verificationUrl:string){
 return {subject:'Confirm your email to start your free invoice audit',html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:640px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN FREE AUDIT</p><h1 style="font-size:25px">Confirm your work email</h1><p>Hi ${escapeHtml(name)}, confirm this address to authorize the one-time free audit. We will not process the invoices until you confirm.</p><p style="margin:28px 0"><a href="${escapeHtml(verificationUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">Confirm and start my audit</a></p><p style="font-size:12px;color:#666">This link expires in 30 minutes. If you did not request this audit, ignore this email and the documents will be deleted automatically.</p></body></html>`};
}

export function repeatOfferEmail(name:string,offerUrl:string){
 return {subject:'Your free audit has already been used — see ongoing protection',html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:640px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN INVOICE AUDIT</p><h1 style="font-size:25px">Keep every invoice protected</h1><p>Hi ${escapeHtml(name)}, this email address has already received its one-time free audit. Additional audits are available through our Core and Scale plans.</p><p>Get continuous duplicate billing, banking-change, MC mismatch and carrier authority checks, with reports delivered to your inbox.</p><p style="margin:28px 0"><a href="${escapeHtml(offerUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">See plans and protect my brokerage</a></p><p style="font-size:12px;color:#666">For security, files submitted with this additional request were not stored or processed.</p></body></html>`};
}

export type FreeAuditFailureKind='invalid_document'|'unsafe_document'|'too_large'|'temporary_error';
export function failureEmail(name:string,kind:FreeAuditFailureKind,retryUrl:string){
 const copy={
  invalid_document:{heading:'We could not read one of your invoice files',body:'One or more files were not a valid, readable PDF. Export the original document again as a standard, unencrypted PDF and submit the audit again.'},
  unsafe_document:{heading:'We could not safely process one of your files',body:'Our document security check rejected one or more files. Remove passwords, embedded files, scripts or other active content, export a clean PDF, and submit the audit again.'},
  too_large:{heading:'One or more files exceeded the upload limits',body:'Each PDF must be 20 MB or smaller, with no more than 100 MB total. Reduce or split the files and submit the audit again.'},
  temporary_error:{heading:'We could not complete your audit',body:'A temporary processing problem stopped this audit. Your free audit was not consumed. Please submit the files again; if the problem continues, reply to this email and our team will help.'},
 }[kind];
 return {subject:`Action needed for your Olympian free audit`,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:640px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN FREE AUDIT</p><h1 style="font-size:25px">${copy.heading}</h1><p>Hi ${escapeHtml(name)}, ${copy.body}</p><p>Your contact details are saved. Use the secure link below and upload only the replacement files.</p><p style="margin:28px 0"><a href="${escapeHtml(retryUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">Upload replacement files</a></p><p style="font-size:12px;color:#666">This private link expires in 72 hours and can be used once. For security, we do not include internal system details or document contents in email.</p></body></html>`};
}

export function resultEmail(name:string,company:string,report:AuditReport,resultUrl:string){
 const invoices=`${report.total_invoices_processed} eligible invoice${report.total_invoices_processed===1?'':'s'}`;
 const findings=`${report.total_exceptions} item${report.total_exceptions===1?'':'s'} requiring review`;
 return {subject:`Your Olympian audit is ready — ${money(report.valor_total_under_review)} under review`,html:`<!doctype html><html><body style="margin:0;background:#f7f7f0;color:#11110f;font-family:Arial,sans-serif"><table width="100%" role="presentation"><tr><td align="center" style="padding:40px 16px"><table width="100%" role="presentation" style="max-width:620px;background:#fff;border:2px solid #11110f"><tr><td style="padding:38px"><p style="color:#ef5427;font-weight:700">OLYMPIAN FREE AUDIT</p><h1 style="font-size:32px;margin:24px 0 12px">Your audit is ready.</h1><p>Hi ${escapeHtml(name)}, we reviewed ${escapeHtml(invoices)} for ${escapeHtml(company)} and found ${escapeHtml(findings)}.</p><p style="font-size:28px;font-weight:800">${money(report.valor_total_under_review)} under review</p><p style="margin:30px 0"><a href="${escapeHtml(resultUrl)}" style="background:#ef5427;color:#fff;border:2px solid #11110f;padding:14px 20px;text-decoration:none;font-weight:700">View my audit</a></p><p style="color:#66665f;font-size:13px">This private link expires in 35 days.</p></td></tr></table></td></tr></table></body></html>`};
}
export function followupEmail(day:1|3|5|10|30,name:string,report:AuditReport,plan:'core'|'growth'|'scale',resultUrl:string,unsubscribeUrl:string){
 const plans={core:'Core',growth:'Growth',scale:'Scale'};const copy={
  1:{subject:'Your Olympian audit findings are still ready',heading:'Did you get a chance to review the findings?',body:`We flagged ${report.total_exceptions} items across ${report.total_invoices_processed} eligible invoices. Your complete result is still available at the private link below.`,cta:'View my audit'},
  3:{subject:'Your free audit was a snapshot',heading:'What about the next carrier invoice?',body:'The free audit reviewed one submission. Olympian can continuously check invoices as they arrive, surfacing exceptions before they disappear into accounts payable.',cta:'See how Olympian works'},
  5:{subject:`${plans[plan]} is likely the best fit for your operation`,heading:`A practical starting point: ${plans[plan]}`,body:`Based on the load volume you reported, ${plans[plan]} is likely the clearest starting point. Your private result explains why and lets you compare all plans.`,cta:'View my recommendation'},
  10:{subject:'One last note about your Olympian audit',heading:'Keep the result. Change what happens next.',body:'Your audit result remains available through our final check-in. If continuous invoice review would help your team, the private page shows the next step.',cta:'Return to my audit'},
  30:{subject:'A 30-day check-in from Olympian',heading:'Has your invoice volume changed?',body:'A month has passed since your free audit. If carrier invoice review is still taking time from your team, you can revisit the findings and see the recommended path forward.',cta:'Revisit my audit'},
 }[day];
 return {subject:copy.subject,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:640px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN</p><h1 style="font-size:25px">${copy.heading}</h1><p>Hi ${escapeHtml(name)}, ${copy.body}</p><p style="margin:28px 0"><a href="${escapeHtml(resultUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">${copy.cta}</a></p><p style="font-size:12px;color:#666"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#666">Stop these audit follow-ups</a></p></body></html>`};
}

export function freeAuditCsv(report:AuditReport):Buffer{
 const header=['source_file','finding','description','amount_involved'];
 return Buffer.from('\uFEFF'+[header,...report.exceptions.map(e=>[e.source_reference.file,e.rule_label,e.descricao,e.valor_envolvido])].map(row=>row.map(csv).join(',')).join('\r\n'),'utf8');
}

function pdfEscape(value:unknown){return String(value??'').normalize('NFKD').replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7E]/g,'').replace(/[\\()]/g,'\\$&');}
function wrap(value:unknown,width=74){
 const words=pdfEscape(value).trim().split(/\s+/).flatMap(word=>word.length>width?word.match(new RegExp(`.{1,${width}}`,'g'))??[word]:[word]);
 const lines:string[]=[];let line='';
 for(const word of words){const next=line?`${line} ${word}`:word;if(next.length<=width)line=next;else{if(line)lines.push(line);line=word;}}
 if(line)lines.push(line);return lines;
}
const pdfColor={ink:'0.067 0.067 0.059',orange:'0.937 0.329 0.153',cream:'0.969 0.969 0.941',white:'1 1 1',muted:'0.400 0.400 0.373',paleOrange:'0.984 0.894 0.847',green:'0.184 0.435 0.345'} as const;
function pdfText(text:unknown,x:number,y:number,size:number,font:'F1'|'F2'='F1',color:keyof typeof pdfColor='ink'){
 return `BT /${font} ${size} Tf ${pdfColor[color]} rg ${x} ${y} Td (${pdfEscape(text)}) Tj ET`;
}
function pdfRect(x:number,y:number,width:number,height:number,fill:keyof typeof pdfColor,stroke?:keyof typeof pdfColor){
 return `q ${pdfColor[fill]} rg${stroke?` ${pdfColor[stroke]} RG 1 w`:''} ${x} ${y} ${width} ${height} re ${stroke?'B':'f'} Q`;
}
export function freeAuditPdf(company:string,report:AuditReport):Buffer{
 const pages:string[][]=[];let page:string[]=[];let y=0;
 const startPage=(continuation=false)=>{
  page=[pdfRect(0,0,612,792,'cream'),pdfRect(48,744,12,12,'orange'),pdfText('OLYMPIAN',70,745,12,'F2'),pdfText('FREE INVOICE AUDIT',469,747,8,'F2','muted'),`q ${pdfColor.ink} RG .8 w 48 728 m 564 728 l S Q`];
  if(continuation){page.push(pdfText('Findings requiring review',48,690,20,'F2'),pdfText(company,48,668,9,'F1','muted'));y=638;}else y=708;
  pages.push(page);
 };
 startPage();
 page.push(pdfText('AUDIT SNAPSHOT',48,y,9,'F2','orange'),pdfText(company,48,y-34,24,'F2'));
 page.push(pdfRect(48,y-166,516,104,'ink'));
 page.push(pdfText('AMOUNT UNDER REVIEW',68,y-91,9,'F2','orange'),pdfText(money(report.valor_total_under_review),68,y-137,31,'F2','white'));
 page.push(pdfText('Prioritize these items before a final payment decision.',326,y-118,9,'F1','white'));
 const metrics=[['INVOICES REVIEWED',report.total_invoices_processed],['FINDINGS',report.total_exceptions],['REPORT DATE',new Date(report.generated_at).toLocaleDateString('en-US',{timeZone:'UTC'})]] as const;
 metrics.forEach(([label,value],index)=>{const x=48+index*176;page.push(pdfRect(x,y-252,164,66,index===1?'paleOrange':'white','ink'),pdfText(label,x+14,y-210,8,'F2',index===1?'orange':'muted'),pdfText(value,x+14,y-235,18,'F2'));});
 page.push(pdfText('FINDINGS REQUIRING REVIEW',48,y-292,9,'F2','orange'),pdfText('Each item includes its source, amount and reason for review.',48,y-311,9,'F1','muted'));
 y-=340;
 if(!report.exceptions.length){
  page.push(pdfRect(48,y-88,516,88,'white','green'),pdfText('No billing risks detected',68,y-32,16,'F2','green'),pdfText('No exceptions were identified in the eligible invoices reviewed.',68,y-56,10));
 }else for(const [index,finding] of report.exceptions.entries()){
  const description=wrap(finding.descricao,76);const cardHeight=Math.max(90,62+description.length*12);
  if(y-cardHeight<70){startPage(true);}
  page.push(pdfRect(48,y-cardHeight,516,cardHeight,'white','ink'),pdfRect(48,y-cardHeight,6,cardHeight,'orange'));
  page.push(pdfText(String(index+1).padStart(2,'0'),68,y-25,9,'F2','orange'),pdfText(finding.rule_label,96,y-26,12,'F2'));
  const source=`${finding.source_reference.file}${finding.source_reference.page?` - page ${finding.source_reference.page}`:''}`;
  page.push(pdfText(source,96,y-45,8,'F1','muted'),pdfText(money(finding.valor_envolvido),450,y-26,11,'F2','green'));
  description.forEach((line,lineIndex)=>page.push(pdfText(line,68,y-67-lineIndex*12,9)));
  y-=cardHeight+12;
 }
 pages.forEach((commands,index)=>{
  commands.push(`q ${pdfColor.ink} RG .6 w 48 48 m 564 48 l S Q`,pdfText('Automated findings require human review. Documents are deleted after 30 days.',48,29,7,'F1','muted'),pdfText(`Page ${index+1} of ${pages.length}`,519,29,7,'F2','muted'));
 });
 const pageStart=3,contentStart=pageStart+pages.length,fontRef=contentStart+pages.length,boldFontRef=fontRef+1;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,index)=>`${pageStart+index} 0 R`).join(' ')}] /Count ${pages.length} >>`,...pages.map((_,index)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> >> /Contents ${contentStart+index} 0 R >>`),...pages.map(commands=>{const stream=commands.join('\n');return `<< /Length ${Buffer.byteLength(stream,'ascii')} >>\nstream\n${stream}\nendstream`; }),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
 let output='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output,'ascii'));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(output,'ascii');output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(output,'ascii');
}
