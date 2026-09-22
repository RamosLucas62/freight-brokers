import {afterEach,describe,expect,it,vi} from 'vitest';
import {reviewAuditWithJev} from '../../src/jev/audit-reviewer.js';
import {JevClient} from '../../src/jev/client.js';
import {makeInvoice} from '../fixtures/invoice.fixture.js';

describe('Jev audit decisions',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('adds a real review exception only above the configured threshold',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');vi.stubEnv('JEV_DECISION_THRESHOLD','0.8');
  const request=vi.fn(async()=>new Response(JSON.stringify({id:'j1',answers:{invoice_0_risk:{choice:'critical',probabilities:{routine:0.01,review:0.04,critical:0.95}},invoice_0_consistent:{noul:0.2}}}),{status:200}));
  const invoice=makeInvoice();const result=await reviewAuditWithJev([invoice],[],undefined,new JevClient(request as typeof fetch));
  expect(result).toEqual([expect.objectContaining({invoice_id:invoice.id,tipo_regra:'JEV_SEMANTIC_REVIEW',metadata:expect.objectContaining({risk:'critical'})})]);
 });
 it('does not change the audit for a routine, consistent decision',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');
  const request=vi.fn(async()=>new Response(JSON.stringify({answers:{invoice_0_risk:{choice:'routine',probabilities:{routine:0.96,review:0.03,critical:0.01}},invoice_0_consistent:{noul:0.98}}}),{status:200}));
  await expect(reviewAuditWithJev([makeInvoice()],[],undefined,new JevClient(request as typeof fetch))).resolves.toEqual([]);
 });
 it('splits large audits into bounded batches while preserving invoice indexes',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');vi.stubEnv('JEV_BATCH_SIZE','2');
  const request=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)) as {questions:Record<string,unknown>};
   const answers=Object.fromEntries(Object.keys(body.questions).map(key=>[key,key.endsWith('_risk')?{choice:'routine',probabilities:{routine:0.99}}:{noul:0.99}]));
   return new Response(JSON.stringify({answers}),{status:200});
  });
  const invoices=[makeInvoice({id:'invoice-a'}),makeInvoice({id:'invoice-b'}),makeInvoice({id:'invoice-c'})];
  await expect(reviewAuditWithJev(invoices,[],undefined,new JevClient(request as typeof fetch))).resolves.toEqual([]);
  expect(request).toHaveBeenCalledTimes(2);
  const secondBody=JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {questions:Record<string,unknown>};
  expect(Object.keys(secondBody.questions)).toEqual(['invoice_2_risk','invoice_2_consistent']);
 });
});
