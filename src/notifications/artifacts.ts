import type {NotificationData,NotificationException} from './types.js';
import {ruleLabel} from '../report/rule-labels.js';

const money=(value:number|null|undefined)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value??0));
const date=(value:string,timeZone:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone}).format(new Date(value));
const dateTime=(value:string,timeZone:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone}).format(new Date(value));
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const csv=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
const reportPeriod=(data:NotificationData)=>`${date(data.delivery.period_start,data.timezone)} - ${date(new Date(new Date(data.delivery.period_end).getTime()-1).toISOString(),data.timezone)}`;

function riskRows(risks:NotificationException[],timeZone:string):string{
 if(!risks.length)return '<p style="padding:18px;background:#edf8f2;color:#267859;border-radius:6px">No risks were detected during this period.</p>';
 return `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${['Invoice','Carrier','Risk','Amount','Detected'].map(h=>`<th style="text-align:left;padding:10px;border-bottom:1px solid #dfe4ea">${h}</th>`).join('')}</tr></thead><tbody>${risks.map(r=>`<tr><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(r.invoice?.numero_fatura??r.invoice_id)}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(r.invoice?.carrier_name??'—')}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${escapeHtml(ruleLabel(r.tipo_regra))}<br><small>${escapeHtml(r.descricao)}</small></td><td style="padding:10px;border-bottom:1px solid #eef0f3">${money(r.valor_envolvido)}</td><td style="padding:10px;border-bottom:1px solid #eef0f3">${date(r.created_at,timeZone)}</td></tr>`).join('')}</tbody></table>`;
}

export function composeEmail(data:NotificationData,portalUrl:string):{subject:string;html:string}{
 const {delivery,companyName,risks,avoided}=data;
 const riskTotal=risks.reduce((sum,r)=>sum+Number(r.valor_envolvido??0),0);
 const savings=avoided.reduce((sum,r)=>sum+Number(r.avoided_amount??0),0);
 const period=reportPeriod(data).replace(' - ',' – ');
 const subject=delivery.kind==='immediate'
  ? `[Action required] ${ruleLabel(risks[0]?.tipo_regra)} · ${companyName}`
  : delivery.kind==='daily'?`Daily invoice risk summary · ${companyName}`:`Monthly audit impact · ${companyName}`;
 const monthly=delivery.kind==='monthly'?`<div style="display:flex;gap:12px"><p style="padding:14px;background:#f4f6fa"><strong>${risks.length}</strong><br>risks detected</p><p style="padding:14px;background:#edf8f2"><strong>${money(savings)}</strong><br>confirmed loss avoided</p></div>`:'';
 const outcomes=delivery.kind==='monthly'&&avoided.length?`<h2 style="font-size:18px;margin-top:28px">Confirmed avoided losses</h2>${riskRows(avoided,data.timezone)}`:'';
 return {subject,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1d2e40;line-height:1.5;max-width:760px;margin:auto;padding:24px"><h1 style="font-size:24px">${escapeHtml(subject)}</h1><p>${escapeHtml(period)}</p>${monthly}<p><strong>${risks.length}</strong> risk${risks.length===1?'':'s'} detected · <strong>${money(riskTotal)}</strong> under review.</p>${riskRows(risks,data.timezone)}${outcomes}<p style="margin-top:24px"><a href="${escapeHtml(portalUrl)}" style="background:#334155;color:white;padding:11px 16px;border-radius:5px;text-decoration:none">Open customer portal</a></p><p style="color:#607080;font-size:12px">Attached: a visual PDF summary and a spreadsheet with analysis-ready report details. Confirmed loss avoided includes only customer-reviewed cases marked as avoided.</p></body></html>`};
}

function resolutionLabel(value:NotificationException['resolution_status']):string{
 return value==='avoided'?'Confirmed avoided':value==='no_loss'?'Reviewed - no loss':'Pending review';
}

function csvRow(r:NotificationException,data:NotificationData):unknown[]{
 return [
  reportPeriod(data),r.invoice?.numero_fatura??r.invoice_id,r.invoice?.numero_carga??'',r.invoice?.carrier_name??'',
  ruleLabel(r.tipo_regra),r.descricao,Number(r.valor_envolvido??0).toFixed(2),dateTime(r.created_at,data.timezone),
  resolutionLabel(r.resolution_status),r.avoided_amount===null?'':Number(r.avoided_amount).toFixed(2),r.source_file,r.source_page??'',
 ];
}

export function createCsv(data:NotificationData):Buffer{
 const header=['Report period','Invoice number','Load number','Carrier','Finding','What was detected','Amount under review (USD)','Detected at','Review status','Confirmed avoided amount (USD)','Source file','Source page'];
 const rows=[...data.risks];
 if(data.delivery.kind==='monthly')rows.push(...data.avoided.filter(a=>!rows.some(x=>x.id===a.id)));
 const lines=[header.map(csv).join(','),...rows.map(r=>csvRow(r,data).map(csv).join(','))];
 return Buffer.from('\uFEFF'+lines.join('\r\n'),'utf8');
}

function pdfEscape(value:string):string{return value.normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/[\\()]/g,'\\$&');}
function wrapText(value:string,width=78):string[]{
 const words=value.trim().split(/\s+/).filter(Boolean);const lines:string[]=[];let line='';
 for(const word of words){const next=line?`${line} ${word}`:word;if(next.length<=width)line=next;else{if(line)lines.push(line);line=word;}}
 if(line)lines.push(line);return lines.length?lines:['No additional details were provided.'];
}
function rgb(hex:string):string{
 const value=hex.replace('#','');return [0,2,4].map(index=>(Number.parseInt(value.slice(index,index+2),16)/255).toFixed(3)).join(' ');
}
function text(x:number,y:number,value:string,size=10,font='F1',color='#1d2e40'):string{
 return `BT /${font} ${size} Tf ${rgb(color)} rg ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;
}
function rect(x:number,y:number,width:number,height:number,fill:string,stroke?:string):string{
 const border=stroke?`${rgb(stroke)} RG 1 w `:'';return `${rgb(fill)} rg ${border}${x} ${y} ${width} ${height} re ${stroke?'B':'f'}`;
}
function line(x1:number,y1:number,x2:number,y2:number,color='#dfe4ea',width=1):string{return `${rgb(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;}
function reportTitle(kind:NotificationData['delivery']['kind']):string{return kind==='immediate'?'Immediate risk alert':kind==='monthly'?'Monthly audit impact':'Daily invoice risk summary';}

interface PdfCard {risk:NotificationException;description:string[];height:number;outcome:boolean}
function cardFor(risk:NotificationException,outcome=false):PdfCard{
 const description=wrapText(risk.descricao,82).slice(0,5);return {risk,description,height:112+Math.max(0,description.length-1)*12,outcome};
}

export function createPdf(data:NotificationData):Buffer{
 const riskTotal=data.risks.reduce((sum,r)=>sum+Number(r.valor_envolvido??0),0);
 const savings=data.avoided.reduce((sum,r)=>sum+Number(r.avoided_amount??0),0);
 const cards=[...data.risks.map(r=>cardFor(r)),...(data.delivery.kind==='monthly'?data.avoided.filter(a=>!data.risks.some(r=>r.id===a.id)).map(r=>cardFor(r,true)):[])];
 const pages:PdfCard[][]=[[]];let available=446;
 for(const card of cards){if(pages.at(-1)!.length&&card.height+12>available){pages.push([]);available=574;}pages.at(-1)!.push(card);available-=card.height+12;}
 const pageStart=3,contentStart=pageStart+pages.length,fontRef=contentStart+pages.length,boldFontRef=fontRef+1;
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  `<< /Type /Pages /Kids [${pages.map((_,i)=>`${pageStart+i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ...pages.map((_,i)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldFontRef} 0 R >> >> /Contents ${contentStart+i} 0 R >>`),
  ...pages.map((page,pageIndex)=>{
   const commands:string[]=[];
   commands.push(rect(0,696,612,96,'#1d2e40'));
   commands.push(rect(48,754,18,5,'#2f5bd3'));
   commands.push(text(74,750,'OLYMPIAN  /  INVOICE AUDIT',9,'F2','#ffffff'));
   commands.push(text(48,718,reportTitle(data.delivery.kind),22,'F2','#ffffff'));
   commands.push(text(48,700,`${data.companyName}  |  ${reportPeriod(data)}`,9,'F1','#d9e2ec'));
   let cursor:number;
   if(pageIndex===0){
    const cardWidth=data.delivery.kind==='monthly'?160:246;
    const stats:string[][]=[['RISKS DETECTED',String(data.risks.length),'#fff4dc','#a76200'],['AMOUNT UNDER REVIEW',money(riskTotal),'#eef3ff','#214fc1'],...(data.delivery.kind==='monthly'?[['CONFIRMED AVOIDED',money(savings),'#edf8f2','#267859']]:[])];
    stats.forEach((stat,index)=>{const x=48+index*(cardWidth+12);commands.push(rect(x,608,cardWidth,66,stat[2],'#dfe4ea'));commands.push(text(x+14,652,stat[0],7,'F2','#607080'));commands.push(text(x+14,625,stat[1],18,'F2',stat[3]));});
    commands.push(text(48,578,data.risks.length?'What needs attention':'Audit status',12,'F2'));
    commands.push(text(48,562,data.risks.length?'Review each finding below before approving payment.':'No findings require review for this period.',9,'F1','#607080'));
    cursor=542;
   }else{
    commands.push(text(48,668,'Findings continued',12,'F2'));
    commands.push(text(500,668,`Page ${pageIndex+1}`,9,'F1','#607080'));
    cursor=648;
   }
   if(!cards.length){
    commands.push(rect(48,458,516,80,'#edf8f2','#c8e6d6'));commands.push(text(68,505,'No risks detected',15,'F2','#267859'));commands.push(text(68,481,'The invoices reviewed in this period did not produce an exception.',9,'F1','#356b58'));
   }
   for(const [index,card] of page.entries()){
    const y=cursor-card.height;const r=card.risk;const accent=card.outcome||r.resolution_status==='avoided'?'#267859':r.resolution_status==='pending'?'#d77b00':'#607080';
    commands.push(rect(48,y,516,card.height,'#ffffff','#dfe4ea'));commands.push(rect(48,y,5,card.height,accent));
    commands.push(text(68,y+card.height-23,ruleLabel(r.tipo_regra),12,'F2'));
    commands.push(text(456,y+card.height-23,money(card.outcome?r.avoided_amount:r.valor_envolvido),11,'F2',accent));
    const invoice=r.invoice?.numero_fatura??r.invoice_id;const carrier=r.invoice?.carrier_name??'Carrier not identified';
    commands.push(text(68,y+card.height-43,`Invoice ${invoice}  |  ${carrier}`,9,'F2','#40556b'));
    if(r.invoice?.numero_carga)commands.push(text(68,y+card.height-57,`Load ${r.invoice.numero_carga}`,8,'F1','#607080'));
    const descriptionY=y+card.height-(r.invoice?.numero_carga?74:60);
    card.description.forEach((value,lineIndex)=>commands.push(text(68,descriptionY-lineIndex*12,value,8,'F1','#334155')));
    commands.push(line(68,y+22,544,y+22));
    commands.push(text(68,y+9,`Detected ${date(r.created_at,data.timezone)}  |  ${resolutionLabel(r.resolution_status)}`,7,'F1','#607080'));
    commands.push(text(526,y+9,`#${index+1+pages.slice(0,pageIndex).reduce((sum,p)=>sum+p.length,0)}`,7,'F2','#607080'));
    cursor=y-12;
   }
   commands.push(line(48,48,564,48));
   commands.push(text(48,31,'Customer review is required before a finding is treated as a confirmed avoided loss.',7,'F1','#607080'));
   commands.push(text(510,31,`${pageIndex+1} / ${pages.length}`,7,'F2','#607080'));
   const stream=commands.join('\n');return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
 ];
 let output='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(output,'ascii');
}
