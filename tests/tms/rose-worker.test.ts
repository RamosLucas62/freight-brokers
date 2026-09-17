import {describe,it,expect,vi,beforeEach} from 'vitest';
import {processRoseEvent} from '../../src/tms/rose-rocket.worker.js';
import type {RoseRocketClient} from '../../src/tms/rose-rocket.js';
vi.mock('../../src/tms/rose-rocket.repository.js',()=>({
 completeRoseDiscovery:vi.fn(async()=>{}),failRoseEvent:vi.fn(async()=>{}),claimRoseEvent:vi.fn(async()=>null),
}));
import * as repository from '../../src/tms/rose-rocket.repository.js';

const org='11111111-1111-4111-8111-111111111111';
const job={id:'11111111-1111-4111-8111-111111111111',org_id:org,tenant_id:'22222222-2222-4222-8222-222222222222',event_id:'33333333-3333-4333-8333-333333333333',order_id:'44444444-4444-4444-8444-444444444444',attempts:1};
const doc='55555555-5555-4555-8555-555555555555';
beforeEach(()=>vi.clearAllMocks());
describe('Rose Rocket discovery worker',()=>{
 it('refetches a scoped order and records only document IDs, not payloads',async()=>{
  const getObject=vi.fn(async()=>({id:job.order_id,orgId:org,objectKey:'order',documents:[{id:doc},{id:doc}]}));
  await processRoseEvent(job,{orgId:org,getObject} as unknown as RoseRocketClient);
  expect(getObject).toHaveBeenCalledWith('order',job.order_id);
  expect(repository.completeRoseDiscovery).toHaveBeenCalledWith(job,expect.objectContaining({orderId:job.order_id,documentCount:1,documentIds:[doc]}));
  expect(repository.failRoseEvent).not.toHaveBeenCalled();
 });
 it('does not fetch an event scoped to another organization',async()=>{
  const getObject=vi.fn();
  await processRoseEvent(job,{orgId:'99999999-9999-4999-8999-999999999999',getObject} as unknown as RoseRocketClient);
  expect(getObject).not.toHaveBeenCalled();
  expect(repository.failRoseEvent).toHaveBeenCalledWith(job,'ROSE_OBJECT_SCOPE_MISMATCH');
 });
});
