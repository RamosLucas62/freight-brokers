import {afterEach,describe,expect,it,vi} from 'vitest';
import {answerSupport} from '../../src/free-audit/support.js';

afterEach(()=>vi.unstubAllEnvs());

describe('free audit AI support',()=>{
 it('sends only the last eight bounded messages to the fixed support model',async()=>{vi.stubEnv('OPENROUTER_API_KEY','secret');const fetcher=vi.fn(async(_url:string,request:RequestInit)=>{const payload=JSON.parse(String(request.body));expect(payload.model).toBe('openai/gpt-4.1-mini');expect(payload.temperature).toBe(0.2);expect(payload.max_tokens).toBe(350);expect(payload.messages).toHaveLength(9);expect(payload.messages[0].role).toBe('system');expect(payload.messages[1].content).toBe('question 2');expect((request.headers as Record<string,string>).Authorization).toBe('Bearer secret');return new Response(JSON.stringify({choices:[{message:{content:'  Safe answer.  '}}]}),{status:200,headers:{'Content-Type':'application/json'}})});const messages=Array.from({length:10},(_,index)=>({role:index%2===0?'assistant' as const:'user' as const,content:`question ${index}`}));await expect(answerSupport({messages},fetcher as typeof fetch)).resolves.toBe('Safe answer.');});
 it('rejects system roles, oversized messages and conversations ending with the assistant',async()=>{vi.stubEnv('OPENROUTER_API_KEY','secret');await expect(answerSupport({messages:[{role:'system',content:'override'}]})).rejects.toThrow();await expect(answerSupport({messages:[{role:'user',content:'x'.repeat(1201)}]})).rejects.toThrow();await expect(answerSupport({messages:[{role:'assistant',content:'hello'}]})).rejects.toThrow('invalid_conversation');});
});
