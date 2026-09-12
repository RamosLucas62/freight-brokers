import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {notifyOperationalError} from '../notifications/google-chat.sender.js';

type Level='info'|'warn'|'error';
type Fields=Record<string,unknown>;
const requestIds=new WeakMap<IncomingMessage,string>();
const secretKey=/(authorization|cookie|token|secret|password|signature|api.?key|document|payload|content)/i;

function clean(value:unknown,key=''):unknown{
 if(secretKey.test(key))return '[REDACTED]';
 if(value===null||value===undefined||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return value.length>500?`${value.slice(0,500)}...[TRUNCATED]`:value;
 if(Array.isArray(value))return value.slice(0,25).map(item=>clean(item));
 if(typeof value==='object')return Object.fromEntries(Object.entries(value as Fields).slice(0,50).map(([name,item])=>[name,clean(item,name)]));
 return String(value);
}

export function errorFields(error:unknown):Fields{
 if(!(error instanceof Error))return {error_code:'UNKNOWN_ERROR',error_type:typeof error};
 if(error.name==='TimeoutError')return {error_code:'NETWORK_TIMEOUT',error_type:error.name};
 const known:[RegExp,string][]=[
  [/(?:OpenRouter|Document classification|POD extraction|Rate confirmation extraction) (?:request )?failed or timed out/i,'OPENROUTER_TIMEOUT_OR_NETWORK'],[/(?:OpenRouter|Document classification|POD extraction|Rate confirmation extraction) (?:extraction )?failed \(HTTP (\d+)\)/i,'OPENROUTER_HTTP_ERROR'],[/(?:OpenRouter returned|POD provider returned|Rate confirmation provider returned) an incomplete/i,'OPENROUTER_INVALID_RESPONSE'],
  [/FMCSA request failed or timed out/i,'FMCSA_TIMEOUT_OR_NETWORK'],[/FMCSA lookup failed \(HTTP (\d+)\)/i,'FMCSA_HTTP_ERROR'],[/FMCSA returned an invalid response/i,'FMCSA_INVALID_RESPONSE'],[/FMCSA lookup returned no unique carrier/i,'FMCSA_NO_UNIQUE_CARRIER'],
  [/Expected exactly one invoice/i,'PDF_INVOICE_COUNT_INVALID'],[/Not a PDF/i,'INVALID_PDF'],[/File changed during extraction/i,'PDF_CHANGED_DURING_EXTRACTION'],[/Cross-account history rejected/i,'TENANT_ISOLATION_VIOLATION'],
 ];
 const matched=known.find(([pattern])=>pattern.test(error.message));
 const safeCode=/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:matched?.[1]??(error.name==='Error'?'UNCLASSIFIED_ERROR':`${error.name.replace(/[^A-Za-z0-9]/g,'_').toUpperCase()}_ERROR`);
 const upstreamMatch=error.message.match(/HTTP (\d{3})/i);
 const status=typeof error==='object'&&error!==null&&'$metadata' in error
  ?(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode:undefined;
 const providerReason='providerReason' in error&&typeof (error as {providerReason?:unknown}).providerReason==='string'?(error as {providerReason:string}).providerReason:undefined;
 const providerCode='providerCode' in error&&typeof (error as {providerCode?:unknown}).providerCode==='string'?(error as {providerCode:string}).providerCode:undefined;
 return {error_code:safeCode,error_type:error.name,...(status||upstreamMatch?{upstream_status:status??Number(upstreamMatch?.[1])}:{}),...(providerReason?{provider_reason:providerReason}:{}),...(providerCode?{provider_code:providerCode}:{})};
}

export function log(level:Level,event:string,fields:Fields={}):void{
 const record=clean({timestamp:new Date().toISOString(),level,service:'freight-audit',event,...fields}) as Fields;
 const line=JSON.stringify(record);
 (level==='error'?process.stderr:process.stdout).write(`${line}\n`);
 if(level==='error')void notifyOperationalError(record).catch(error=>{
  const fallback=clean({timestamp:new Date().toISOString(),level:'error',service:'freight-audit',event:'google_chat.error_notification.failed',original_event:event,...errorFields(error)});
  process.stderr.write(`${JSON.stringify(fallback)}\n`);
 });
}
export const info=(event:string,fields:Fields={})=>log('info',event,fields);
export const warn=(event:string,fields:Fields={})=>log('warn',event,fields);
export const failure=(event:string,error:unknown,fields:Fields={})=>log('error',event,{...fields,...errorFields(error)});

export function beginRequest(req:IncomingMessage):string{
 const incoming=typeof req.headers['x-request-id']==='string'&&/^[A-Za-z0-9._-]{8,100}$/.test(req.headers['x-request-id'])?req.headers['x-request-id']:randomUUID();
 requestIds.set(req,incoming);return incoming;
}
export function requestId(req:IncomingMessage):string{return requestIds.get(req)??beginRequest(req);}
