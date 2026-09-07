import type {NotificationData,NotificationException} from './types.js';

const money=(value:number|null|undefined)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value??0));
const date=(value:string,timeZone:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone}).format(new Date(value));
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const csv=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;

function riskRows(risks:NotificationException[],timeZone:string):string{
 if(!risks.length)return '<p style="padding:18px;background:#edf8f2;color:#267859;border-radius:6px">No risks were detected during this period.</p>';
 return `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${['Invoice','Carrier','Risk','Amount','Detected'].map(h=>`<th style="text-align:left;padding:10px;border-bottom:1px solid #dfe4ea">${h}</th>`).join('')}</tr></thead><tbody>${risks.map(r=>`<tr><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(r.invoice?.numero_fatura??r.invoice_id)}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(r.invoice?.carrier_name??'—')}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(r.tipo_regra)}<br><small>${escapeHtml(r.descricao)}</small></td><td style="padding:10px;border-bottom:1px solid #eef0f3">${money(r.valor_envolvido)}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${date(r.created_at,timeZone)}</td></tr>`).join('')}</tbody></table>`;
}

export function composeEmail(data:NotificationData,portalUrl:string):{subject:string;html:string}{
 const {delivery,companyName,risks,avoided}=data;
 const riskTotal=risks.reduce((sum,r)=>sum+Number(r.valor_envolvido??0),0);
 const savings=avoided.reduce((sum,r)=>sum+Number(r.avoided_amount??0),0);
 const period=`${date(delivery.period_start,data.timezone)} – ${date(new Date(new Date(delivery.period_end).getTime()-1).toISOString(),data.timezone)}`;
 const subject=delivery.kind==='immediate'
  ? `[Action required] ${risks[0]?.tipo_regra??'Invoice risk'} · ${companyName}`
  : delivery.kind==='daily'?`Daily invoice risk summary · ${companyName}`:`Monthly audit impact · ${companyName}`;
 const monthly=delivery.kind==='monthly'?`<div style="display:flex;gap:12px"><p style="padding:14px;background:#f4f6fa"><strong>${risks.length}</strong><br>risks detected</p><p style="padding:14px;background:#edf8f2"><strong>${money(savings)}</strong><br>confirmed loss avoided</p></div>`:'';
 const outcomes=delivery.kind==='monthly'&&avoided.length?`<h2 style="font-size:18px;margin-top:28px">Confirmed avoided losses</h2>${riskRows(avoided,data.timezone)}`:'';
 return {subject,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1d2e40;line-height:1.5;max-width:760px;margin:auto;padding:24px"><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p>${escapeHtml(period)}</p>${monthly}<p><strong>${risks.length}</strong> risk${risks.length===1?'':'s'} detected · <strong>${money(riskTotal)}</strong> under review.</p>${riskRows(risks,data.timezone)}${outcomes}<p style="margin-top:24px"><a href="${escapeHtml(portalUrl)}" style="background:#334155;color:white;padding:11px 16px;border-radius:5px;text-decoration:none">Open customer portal</a></p><p style="color:#607080;font-size:12px">Attached: a PDF summary and a CSV spreadsheet with the report details. Confirmed loss avoided includes only customer-reviewed cases marked as avoided.</p></body></html>`};
}

export function createCsv(data:NotificationData):Buffer{
 const header=['invoice','load','carrier','risk_type','description','amount_involved','detected_at','resolution','avoided_amount'];
 const lines=[header.map(csv).join(','),...data.risks.map(r=>[
  r.invoice?.numero_fatura??r.invoice_id,r.invoice?.numero_carga,r.invoice?.carrier_name,r.tipo_regra,r.descricao,
  r.valor_envolvido,r.created_at,r.resolution_status,r.avoided_amount,
 ].map(csv).join(','))];
 if(data.delivery.kind==='monthly')for(const r of data.avoided.filter(a=>!data.risks.some(x=>x.id===a.id)))lines.push([
  r.invoice?.numero_fatura??r.invoice_id,r.invoice?.numero_carga,r.invoice?.carrier_name,r.tipo_regra,r.descricao,
  r.valor_envolvido,r.created_at,r.resolution_status,r.avoided_amount,
 ].map(csv).join(','));
 return Buffer.from('\uFEFF'+lines.join('\r\n'),'utf8');
}

function pdfEscape(value:string):string{return value.normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/[\\()]/g,'\\$&');}
function wrapText(value:string,width=72):string[]{
 const words=value.split(/\s+/);const lines:string[]=[];let line='';
 for(const word of words){const next=line?`${line} ${word}`:word;if(next.length<=width)line=next;else{if(line)lines.push(line);line=word;}}
 if(line)lines.push(line);return lines;
}
export function createPdf(data:NotificationData):Buffer{
 const savings=data.avoided.reduce((sum,r)=>sum+Number(r.avoided_amount??0),0);
 const summary=[
  `Risks detected: ${data.risks.length}`,
  `Amount under review: ${money(data.risks.reduce((s,r)=>s+Number(r.valor_envolvido??0),0))}`,
  ...(data.delivery.kind==='monthly'?[`Confirmed loss avoided: ${money(savings)}`]:[]),'',
 ];
 const riskBlocks=data.risks.length?data.risks.map((r,i)=>[
   `${i+1}. Invoice ${r.invoice?.numero_fatura??r.invoice_id} | ${r.tipo_regra} | ${money(r.valor_envolvido)}`,
   ...wrapText(r.descricao||'').map(line=>`   ${line}`),
  ]):[['No risks were detected during this period.']];
 const outcomeBlock=data.delivery.kind==='monthly'&&data.avoided.length?['','CONFIRMED AVOIDED LOSSES',...data.avoided.map((r,i)=>
  `${i+1}. Invoice ${r.invoice?.numero_fatura??r.invoice_id} | ${r.tipo_regra} | ${money(r.avoided_amount)}`)]:[];
 const blocks=[summary,...riskBlocks,...(outcomeBlock.length?[outcomeBlock]:[]),['','Confirmed loss avoided includes only customer-reviewed cases marked as avoided.']];
 const pages:string[][]=[[]];for(const block of blocks){if(pages.at(-1)!.length&&pages.at(-1)!.length+block.length>42)pages.push([]);pages.at(-1)!.push(...block);}
 const pageStart=3,contentStart=pageStart+pages.length,fontRef=contentStart+pages.length,boldFontRef=fontRef+1;
 const reportPeriod=`${date(data.delivery.period_start,data.timezone)} - ${date(new Date(new Date(data.delivery.period_end).getTime()-1).toISOString(),data.timezone)}`;
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${pages.map((_,i)=>`${pageStart+i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ...pages.map((_,i)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> >> /Contents ${contentStart+i} 0 R >>`),
  ...pages.map((page,pageIndex)=>{const body=page.map((line,i)=>`${i?'T* ':''}(${pdfEscape(line)}) Tj`).join('\n');const stream=`BT /F2 14 Tf 48 760 Td (INVOICE AUDIT REPORT) Tj /F1 10 Tf 0 -20 Td (${pdfEscape(data.companyName)}) Tj 0 -14 Td (${pdfEscape(reportPeriod)}) Tj 0 -20 Td 14 TL ${body} ET\nBT /F1 9 Tf 48 28 Td (Page ${pageIndex+1} of ${pages.length}) Tj ET`;return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;}),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
 ];
 let output='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(output,'ascii');
}
