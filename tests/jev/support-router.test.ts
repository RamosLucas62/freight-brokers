import {afterEach,describe,expect,it,vi} from 'vitest';
import {routeSupportWithJev} from '../../src/jev/support-router.js';
import {JevClient} from '../../src/jev/client.js';

describe('Jev support routing',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('offers human support for a high-confidence security request',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');
  const request=vi.fn(async()=>Response.json({answers:{category:{choice:'security',probabilities:{security:0.96}},needs_human:{noul:0.97}}}));
  await expect(routeSupportWithJev('I see suspicious activity.','settings',undefined,new JevClient(request as typeof fetch))).resolves.toMatchObject({offerHuman:true,category:'security',confidence:0.97});
 });
 it('keeps general guidance with the AI below the configured threshold',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');vi.stubEnv('JEV_SUPPORT_THRESHOLD','0.85');
  const request=vi.fn(async()=>Response.json({answers:{category:{choice:'product_guidance',probabilities:{product_guidance:0.98}},needs_human:{noul:0.05}}}));
  await expect(routeSupportWithJev('Where can I download a report?','reports',undefined,new JevClient(request as typeof fetch))).resolves.toMatchObject({offerHuman:false,category:'product_guidance',confidence:0.98});
 });
});
