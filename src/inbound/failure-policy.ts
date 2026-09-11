import {errorFields} from '../observability/logger.js';

const PROVIDER_STAGES=new Set(['classify_document','extract_pod','extract_rate_confirmation','audit_pipeline']);

export interface InboundFailureDecision {
  retry:boolean;
  errorCode:string;
  delaySeconds:number;
  attempt:number;
}

export function inboundFailureDecision(error:unknown,stage:string,attempt=1):InboundFailureDecision{
  const fields=errorFields(error);const code=String(fields.error_code??'UNKNOWN_ERROR');const status=Number(fields.upstream_status??0);
  const message=error instanceof Error?error.message:'';
  const temporaryCode=new Set([
    'NETWORK_TIMEOUT','OPENROUTER_TIMEOUT_OR_NETWORK','OPENROUTER_INVALID_RESPONSE','FMCSA_TIMEOUT_OR_NETWORK','FMCSA_INVALID_RESPONSE',
  ]).has(code);
  const temporaryHttp=PROVIDER_STAGES.has(stage)&&
    (status===408||status===425||status===429||status>=500);
  const temporaryProviderMessage=PROVIDER_STAGES.has(stage)&&
    /(timed? ?out|timeout|temporar|network|fetch failed|socket|connection|incomplete|invalid (?:response|extraction))/i.test(message);
  const delays=[60,300,900];
  const retry=(temporaryCode||temporaryHttp||temporaryProviderMessage)&&attempt<=delays.length;
  return {retry,errorCode:code,delaySeconds:delays[Math.min(Math.max(attempt-1,0),delays.length-1)],attempt};
}
