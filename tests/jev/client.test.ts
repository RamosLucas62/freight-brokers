import {afterEach,describe,expect,it,vi} from 'vitest';
import {JevClient} from '../../src/jev/client.js';

describe('Jev OpenRouter client',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('uses the Decisions API with English typed questions',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','secret');
  const request=vi.fn(async(url:string,init:RequestInit)=>{
   expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
   const body=JSON.parse(String(init.body));expect(body.model).toBe('typesafe/jev-1.13');expect(body.state.record).toBe('invoice');expect(body.questions.review.type).toBe('noul');
   return new Response(JSON.stringify({id:'decision-1',model:'typesafe/jev-1.13',answers:{review:{noul:0.91,confidence:0.88}},usage:{prompt_tokens:50,total_tokens:50,cost:0.0000021}}),{status:200});
  });
  const result=await new JevClient(request as typeof fetch).decide({record:'invoice'},{review:{type:'noul',instructions:'Does this require review?'}});
  expect(result.answers.review.noul).toBe(0.91);expect(result.requestId).toBe('decision-1');
 });
 it('fails closed on missing answers and provider errors',async()=>{vi.stubEnv('OPENROUTER_API_KEY','secret');const request=vi.fn(async()=>new Response(JSON.stringify({answers:{}}),{status:200}));await expect(new JevClient(request as typeof fetch).decide({},{review:{type:'noul',instructions:'Review?'}})).rejects.toThrow('incomplete');const rejected=vi.fn(async()=>new Response('{}',{status:500}));await expect(new JevClient(rejected as typeof fetch).decide({},{})).rejects.toThrow('HTTP 500');});
});
