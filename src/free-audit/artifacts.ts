import type {AuditReport,ReportException} from '../types/report.types.js';

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
export function failureEmail(name:string,kind:FreeAuditFailureKind,offerUrl:string){
 const copy={
  invalid_document:{heading:'We could not read one of your invoice files',body:'One or more files were not a valid, readable PDF. Export the original document again as a standard, unencrypted PDF and submit the audit again.'},
  unsafe_document:{heading:'We could not safely process one of your files',body:'Our document security check rejected one or more files. Remove passwords, embedded files, scripts or other active content, export a clean PDF, and submit the audit again.'},
  too_large:{heading:'One or more files exceeded the upload limits',body:'Each PDF must be 20 MB or smaller, with no more than 100 MB total. Reduce or split the files and submit the audit again.'},
  temporary_error:{heading:'We could not complete your audit',body:'A temporary processing problem stopped this audit. Your free audit was not consumed. Please submit the files again; if the problem continues, reply to this email and our team will help.'},
 }[kind];
 return {subject:`Action needed for your Olympian free audit`,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:640px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN FREE AUDIT</p><h1 style="font-size:25px">${copy.heading}</h1><p>Hi ${escapeHtml(name)}, ${copy.body}</p><p style="margin:28px 0"><a href="${escapeHtml(offerUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">Return to Olympian</a></p><p style="font-size:12px;color:#666">For security, we do not include internal system details or document contents in email. Files remain subject to the stated retention period.</p></body></html>`};
}

function exceptionRows(exceptions:ReportException[]):string{
 if(!exceptions.length)return '<p style="padding:16px;background:#edf8f2;color:#267859;border-radius:6px">No billing risks were detected in the eligible invoices.</p>';
 return `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${['File','Finding','Amount'].map(h=>`<th style="text-align:left;padding:9px;border-bottom:1px solid #ddd">${h}</th>`).join('')}</tr></thead><tbody>${exceptions.map(e=>`<tr><td style="padding:9px;border-bottom:1px solid #eee">${escapeHtml(e.source_reference.file)}</td><td style="padding:9px;border-bottom:1px solid #eee"><strong>${escapeHtml(e.rule_label)}</strong><br>${escapeHtml(e.descricao)}</td><td style="padding:9px;border-bottom:1px solid #eee">${money(e.valor_envolvido)}</td></tr>`).join('')}</tbody></table>`;
}

export function resultEmail(name:string,company:string,report:AuditReport,offerUrl:string){
 return {subject:`Your free invoice audit · ${company}`,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:760px;margin:auto;padding:24px"><p style="color:#ef5427;font-weight:bold">OLYMPIAN FREE AUDIT</p><h1 style="font-size:25px">Your audit is ready</h1><p>Hi ${escapeHtml(name)}, we reviewed <strong>${report.total_invoices_processed}</strong> eligible invoice${report.total_invoices_processed===1?'':'s'} from ${escapeHtml(company)} and found <strong>${report.total_exceptions}</strong> item${report.total_exceptions===1?'':'s'} requiring review, representing <strong>${money(report.valor_total_under_review)}</strong>.</p>${exceptionRows(report.exceptions)}<p style="margin:28px 0"><a href="${escapeHtml(offerUrl)}" style="background:#ef5427;color:white;padding:13px 18px;border-radius:5px;text-decoration:none;font-weight:bold">Protect every invoice with Olympian</a></p><p style="font-size:12px;color:#666">Your PDF report and CSV details are attached. This automated audit supports review and does not prove that an invoice is legitimate. Submitted documents are deleted after 30 days.</p></body></html>`};
}

export function freeAuditCsv(report:AuditReport):Buffer{
 const header=['source_file','finding','description','amount_involved'];
 return Buffer.from('\uFEFF'+[header,...report.exceptions.map(e=>[e.source_reference.file,e.rule_label,e.descricao,e.valor_envolvido])].map(row=>row.map(csv).join(',')).join('\r\n'),'utf8');
}

function pdfEscape(value:string){return value.normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/[\\()]/g,'\\$&');}
function wrap(value:string,width=82){const lines:string[]=[];let line='';for(const word of value.split(/\s+/)){const next=line?`${line} ${word}`:word;if(next.length<=width)line=next;else{if(line)lines.push(line);line=word;}}if(line)lines.push(line);return lines;}
export function freeAuditPdf(company:string,report:AuditReport):Buffer{
 const lines=[`Company: ${company}`,`Invoices reviewed: ${report.total_invoices_processed}`,`Findings: ${report.total_exceptions}`,`Amount under review: ${money(report.valor_total_under_review)}`,'',...report.exceptions.flatMap((e,index)=>wrap(`${index+1}. ${e.rule_label} | ${e.source_reference.file} | ${money(e.valor_envolvido)} | ${e.descricao}`)),...(report.exceptions.length?[]:['No billing risks were detected in the eligible invoices.']),'','Automated findings require human review. Submitted documents are deleted after 30 days.'];
 const pages:string[][]=[[]];for(const line of lines){if(pages.at(-1)!.length>=42)pages.push([]);pages.at(-1)!.push(line);}
 const pageStart=3,contentStart=pageStart+pages.length,fontRef=contentStart+pages.length,boldFontRef=fontRef+1;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${pageStart+i} 0 R`).join(' ')}] /Count ${pages.length} >>`,...pages.map((_,i)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> >> /Contents ${contentStart+i} 0 R >>`),...pages.map((page,pageIndex)=>{const body=page.map((line,i)=>`${i?'T* ':''}(${pdfEscape(line)}) Tj`).join('\n');const stream=`BT /F2 15 Tf 48 760 Td (OLYMPIAN FREE INVOICE AUDIT) Tj /F1 9 Tf 0 -28 Td 14 TL ${body} ET\nBT /F1 9 Tf 48 28 Td (Page ${pageIndex+1} of ${pages.length}) Tj ET`;return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`; }),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
 let output='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(output,'ascii');
}
