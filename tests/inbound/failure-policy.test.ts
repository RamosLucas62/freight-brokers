import {describe,expect,it} from 'vitest';
import {inboundFailureDecision} from '../../src/inbound/failure-policy.js';

describe('inbound failure policy',()=>{
 it('uses 1, 5 and 15 minute provider backoff',()=>{
  const error=new Error('OpenRouter request failed or timed out. No extraction returned.');
  expect([1,2,3].map(attempt=>inboundFailureDecision(error,'audit_pipeline',attempt))).toEqual([
   expect.objectContaining({retry:true,delaySeconds:60}),expect.objectContaining({retry:true,delaySeconds:300}),expect.objectContaining({retry:true,delaySeconds:900}),
  ]);
 });
 it('stops after three automatic retries',()=>expect(inboundFailureDecision(new Error('FMCSA request failed or timed out.'),'audit_pipeline',4).retry).toBe(false));
 it('retries native timeout errors from storage and database clients',()=>{
  const timeout=Object.assign(new Error('The operation timed out'),{name:'TimeoutError'});
  expect(inboundFailureDecision(timeout,'store_attachment',1)).toMatchObject({retry:true,errorCode:'NETWORK_TIMEOUT'});
 });
 it('retries rate limits and server errors but not invalid customer documents',()=>{
  expect(inboundFailureDecision(new Error('OpenRouter extraction failed (HTTP 429). Rate limit reached; retry later.'),'audit_pipeline',1).retry).toBe(true);
  expect(inboundFailureDecision(new Error('Expected exactly one invoice per PDF; split the document and retry.'),'audit_pipeline',1).retry).toBe(false);
 });
});
