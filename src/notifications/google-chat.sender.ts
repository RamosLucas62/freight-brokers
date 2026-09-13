type Fetcher=typeof fetch;
type LeadStage='audit_requested'|'audit_received'|'trial_started'|'trial_ended'|'client_signed'|'followup_sent'|'cancel_requested'|'plan_changed';

const retryDelays=[250,1000,2500];

const planLabels:Record<string,string>={core:'Core',growth:'Growth',scale:'Scale'};
const periodLabels:Record<string,string>={monthly:'Mensal',semiannual:'Semestral',annual:'Anual'};
const errorLocations:Record<string,string>={
 'checkout.public.failed':'Checkout público',
 'free_audit.checkout.failed':'Checkout da auditoria gratuita',
 'free_audit.submission.failed':'Envio da auditoria gratuita',
 'free_audit.worker.failed':'Processamento da auditoria gratuita',
 'free_audit.followup.failed':'Envio de follow-up',
 'inbound.worker.failed':'Processamento de documentos',
 'stripe.event.failed':'Atualização da assinatura Stripe',
 'stripe.event.completion_record_failed':'Confirmação do evento Stripe na fila',
 'stripe.event.failure_record_failed':'Registro da nova tentativa do evento Stripe',
 'billing.maintenance.tick_failed':'Rotina de manutenção de cobranças',
 'stripe.webhook.enqueue_failed':'Recebimento do webhook Stripe',
 'resend.webhook.failed':'Recebimento do webhook Resend',
 'notification.delivery.failed':'Envio de relatório ou alerta',
 'stripe.onboarding_email.failed':'Envio do onboarding',
 'portal.request.failed':'Portal do cliente',
 'google_chat.lead_notification.failed':'Aviso comercial do Google Chat',
};

function compact(value:unknown):string|undefined{
 if(value===null||value===undefined||value==='')return undefined;
 return String(value);
}

function webhook(kind:'leads'|'errors'):string{
 return kind==='leads'?process.env.GOOGLE_CHAT_LEADS_WEBHOOK_URL??'':process.env.GOOGLE_CHAT_ERRORS_WEBHOOK_URL??'';
}

export async function postGoogleChatMessage(url:string,text:string,request:Fetcher=fetch):Promise<void>{
 if(!url)throw new Error('GOOGLE_CHAT_WEBHOOK_MISSING');
 let lastError:unknown;
 for(let attempt=0;attempt<retryDelays.length;attempt++){
  try{
   const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(5000)});
   if(response.ok)return;
   lastError=new Error(`GOOGLE_CHAT_SEND_FAILED_${response.status}`);
   if(response.status<500&&response.status!==429)throw lastError;
  }catch(error){lastError=error;if(error instanceof Error&&/^GOOGLE_CHAT_SEND_FAILED_4(?!29)/.test(error.message))throw error;}
  if(attempt<retryDelays.length-1)await new Promise(resolve=>setTimeout(resolve,retryDelays[attempt]));
 }
 throw lastError instanceof Error?lastError:new Error('GOOGLE_CHAT_SEND_FAILED');
}

export async function notifyLeadFunnel(input:{stage:LeadStage;requestId?:string|null;email?:string|null;company?:string|null;name?:string|null;follow?:string|number|null;metadata?:Record<string,unknown>},request?:Fetcher):Promise<void>{
 const url=webhook('leads');
 const name=compact(input.name)??compact(input.email)??'Lead';const company=compact(input.company);const email=compact(input.email);const follow=compact(input.follow);const metadata=input.metadata??{};
 const heading:Record<LeadStage,string>={audit_requested:'👋 *Opa, novo lead!*',audit_received:'✅ *Auditoria entregue*',trial_started:'🧪 *Período de teste iniciado*',trial_ended:'✅ *Período de teste encerrado*',client_signed:'🎉 *Novo cliente!*',followup_sent:`📩 *Follow-up D+${follow??'?'} enviado*`,cancel_requested:'⚠️ *Pedido de cancelamento*',plan_changed:'🔄 *Plano atualizado*'};
 const stage:Record<LeadStage,string>={audit_requested:'Auditoria gratuita solicitada',audit_received:'Auditoria gratuita recebida',trial_started:'Teste gratuito de 7 dias iniciado',trial_ended:'Cliente saiu do teste gratuito de 7 dias',client_signed:'Cliente assinou',followup_sent:`${name} acaba de receber o follow-up D+${follow??'?'}.`,cancel_requested:'Cliente solicitou cancelamento',plan_changed:'Cliente alterou o plano'};
 const detailLines=[
  compact(metadata.loads_per_month)?`*Volume informado:* ${compact(metadata.loads_per_month)}`:undefined,
  compact(metadata.invoice_count)?`*Faturas analisadas:* ${compact(metadata.invoice_count)}`:undefined,
  compact(metadata.exception_count)?`*Achados:* ${compact(metadata.exception_count)}`:undefined,
  compact(metadata.recommended_plan)?`*Plano recomendado:* ${planLabels[String(metadata.recommended_plan)]??compact(metadata.recommended_plan)}`:undefined,
  compact(metadata.plan)?`*Plano:* ${planLabels[String(metadata.plan)]??compact(metadata.plan)}`:undefined,
  compact(metadata.period)?`*Período:* ${periodLabels[String(metadata.period)]??compact(metadata.period)}`:undefined,
  compact(metadata.utm_source)?`*Origem:* ${compact(metadata.utm_source)}${compact(metadata.utm_medium)?` / ${compact(metadata.utm_medium)}`:''}${compact(metadata.utm_campaign)?` / ${compact(metadata.utm_campaign)}`:''}`:undefined,
 ];
 const lines=[heading[input.stage],'',`*Nome:* ${name}`,company?`*Empresa:* ${company}`:undefined,email?`*E-mail:* ${email}`:undefined,`*Etapa:* ${stage[input.stage]}`,...detailLines,'',`_ID interno: ${compact(input.requestId)??'não disponível'}_`].filter(Boolean).join('\n');
 await postGoogleChatMessage(url,lines,request);
}

export async function notifyOperationalError(record:Record<string,unknown>,request?:Fetcher):Promise<void>{
 const url=webhook('errors');
 const id=compact(record.request_id)??compact(record.audit_request_id)??compact(record.job_id)??compact(record.event_id)??compact(record.delivery_id)??compact(record.deletion_job_id)??compact(record.tenant_id)??'sem id';
 const code=compact(record.error_code)??compact(record.event)??'UNCLASSIFIED_ERROR';
 const event=compact(record.event)??'unknown';const location=errorLocations[event]??event;
 const lines=[
  '🚨 *Erro no Freight Audit*','',
  `*Onde aconteceu:* ${location}`,
  `*Código:* ${code}`,
  `*Referência:* ${id}`,
  compact(record.stage)?`*Etapa técnica:* ${compact(record.stage)}`:undefined,
  compact(record.upstream_status)?`*Resposta externa:* HTTP ${compact(record.upstream_status)}`:undefined,
  compact(record.attempt)?`*Tentativa:* ${compact(record.attempt)}`:undefined,
  `*Horário:* ${compact(record.timestamp)??new Date().toISOString()}`,'',
  '_Ação: abra os logs usando a referência acima. Dados sensíveis não são enviados para este canal._',
 ].filter(Boolean).join('\n');
 await postGoogleChatMessage(url,lines,request);
}
