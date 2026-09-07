import {afterEach,describe,expect,it,vi} from 'vitest';
import {clientIp,createRateLimiter,privacyKey} from '../../src/security/rate-limit.js';

afterEach(()=>vi.unstubAllEnvs());
describe('shared rate-limit boundary',()=>{
 it('denies after the configured local-development allowance',async()=>{const limiter=createRateLimiter(undefined);expect((await limiter.consume({scope:'test',key:'client',limit:2,windowSeconds:60})).allowed).toBe(true);expect((await limiter.consume({scope:'test',key:'client',limit:2,windowSeconds:60})).allowed).toBe(true);const denied=await limiter.consume({scope:'test',key:'client',limit:2,windowSeconds:60});expect(denied.allowed).toBe(false);expect(denied.remaining).toBe(0);await limiter.close();});
 it('hashes private identifiers deterministically',()=>{vi.stubEnv('RATE_LIMIT_KEY_SECRET','a'.repeat(32));expect(privacyKey('Owner@Example.com')).toBe(privacyKey('owner@example.com'));expect(privacyKey('owner@example.com')).not.toContain('owner');});
 it('trusts Cloudflare client IP only when explicitly configured',()=>{expect(clientIp({'cf-connecting-ip':'203.0.113.10'},'127.0.0.1')).toBe('127.0.0.1');vi.stubEnv('TRUST_PROXY','cloudflare');expect(clientIp({'cf-connecting-ip':'203.0.113.10'},'127.0.0.1')).toBe('203.0.113.10');});
});
