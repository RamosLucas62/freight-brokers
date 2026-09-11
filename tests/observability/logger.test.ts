import {afterEach,describe,expect,it,vi} from 'vitest';
import {errorFields,info} from '../../src/observability/logger.js';

describe('structured logger',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('redacts secret-shaped fields while retaining correlation data',()=>{
  const write=vi.spyOn(process.stdout,'write').mockImplementation(()=>true);
  info('test.event',{request_id:'req_12345678',authorization:'Bearer private',nested:{api_key:'private',stage:'scan_pdf'}});
  const record=JSON.parse(String(write.mock.calls[0][0]));
  expect(record).toMatchObject({level:'info',service:'freight-audit',event:'test.event',request_id:'req_12345678',authorization:'[REDACTED]',nested:{api_key:'[REDACTED]',stage:'scan_pdf'}});
 });
 it('exposes stable error codes without logging arbitrary error messages',()=>{
  expect(errorFields(new Error('PDF_REJECTED_UNSAFE'))).toMatchObject({error_code:'PDF_REJECTED_UNSAFE'});
  expect(errorFields(new Error('database password leaked'))).toMatchObject({error_code:'UNCLASSIFIED_ERROR'});
  expect(errorFields(new Error('OpenRouter extraction failed (HTTP 429). Rate limit reached; retry later.'))).toMatchObject({error_code:'OPENROUTER_HTTP_ERROR',upstream_status:429});
  expect(errorFields(new Error('Rate confirmation extraction failed (HTTP 400).'))).toMatchObject({error_code:'OPENROUTER_HTTP_ERROR',upstream_status:400});
  const providerError=Object.assign(new Error('Rate confirmation extraction failed (HTTP 402).'),{providerReason:'INSUFFICIENT_CREDITS',providerCode:'payment_required'});
  expect(errorFields(providerError)).toMatchObject({error_code:'OPENROUTER_HTTP_ERROR',upstream_status:402,provider_reason:'INSUFFICIENT_CREDITS',provider_code:'payment_required'});
  expect(errorFields(Object.assign(new Error('The operation timed out'),{name:'TimeoutError'}))).toMatchObject({error_code:'NETWORK_TIMEOUT',error_type:'TimeoutError'});
 });
});
