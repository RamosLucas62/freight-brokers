type Fetcher=typeof fetch;
type LeadStage='audit_requested'|'audit_received'|'client_signed'|'followup_sent'|'cancel_requested'|'plan_changed';

const stageLabels:Record<LeadStage,string>={
 audit_requested:'cliente pediu a auditoria gratuita',
 audit_received:'cliente recebeu a auditoria gratuita',
 client_signed:'cliente assinou',
 followup_sent:'cliente recebeu follow',
 cancel_requested:'cliente pediu para cancelar',
 plan_changed:'cliente mudou de plano',
};

function compact(value:unknown):string|undefined{
 if(value===null||value===undefined||value==='')return undefined;
 return String(value);
}

function webhook(kind:'leads'|'errors'):string{
 return kind==='leads'?process.env.GOOGLE_CHAT_LEADS_WEBHOOK_URL??'':process.env.GOOGLE_CHAT_ERRORS_WEBHOOK_URL??'';
}

export async function postGoogleChatMessage(url:string,text:string,request:Fetcher=fetch):Promise<void>{
 if(!url)return;
 const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw new Error(`GOOGLE_CHAT_SEND_FAILED_${response.status}`);
}

export async function notifyLeadFunnel(input:{stage:LeadStage;requestId?:string|null;email?:string|null;company?:string|null;name?:string|null;follow?:string|number|null;metadata?:Record<string,unknown>},request?:Fetcher):Promise<void>{
 const url=webhook('leads');if(!url)return;
 const lines=[
  'Lead - funil',
  `ID: ${compact(input.requestId)??'sem id'}`,
  `Etapa: ${stageLabels[input.stage]}`,
  input.follow!==undefined&&input.follow!==null?`Qual follow: D+${input.follow}`:undefined,
  compact(input.company)?`Empresa: ${input.company}`:undefined,
  compact(input.name)?`Contato: ${input.name}`:undefined,
  compact(input.email)?`Email: ${input.email}`:undefined,
  input.metadata&&Object.keys(input.metadata).length?`Detalhes: ${JSON.stringify(input.metadata)}`:undefined,
 ].filter(Boolean).join('\n');
 await postGoogleChatMessage(url,lines,request);
}

export async function notifyOperationalError(record:Record<string,unknown>,request?:Fetcher):Promise<void>{
 const url=webhook('errors');if(!url)return;
 const id=compact(record.request_id)??compact(record.audit_request_id)??compact(record.job_id)??compact(record.event_id)??compact(record.delivery_id)??compact(record.deletion_job_id)??compact(record.tenant_id)??'sem id';
 const code=compact(record.error_code)??compact(record.event)??'UNCLASSIFIED_ERROR';
 const lines=[
  'Erro - Freight Audit',
  `ID: ${id}`,
  `Erro: ${compact(record.event)??'unknown'} (${code})`,
  `Horário: ${compact(record.timestamp)??new Date().toISOString()}`,
 ].join('\n');
 await postGoogleChatMessage(url,lines,request);
}
