import {createHmac} from 'node:crypto';
import Redis from 'ioredis';

export interface RateLimitRule {scope:string;key:string;limit:number;windowSeconds:number;failClosed?:boolean;}
export interface RateLimitResult {allowed:boolean;limit:number;remaining:number;retryAfter:number;}
export interface RateLimiter {consume(rule:RateLimitRule):Promise<RateLimitResult>;close():Promise<void>;}

const script=`
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

export function privacyKey(value:string):string {
 const secret=process.env.RATE_LIMIT_KEY_SECRET;
 if(!secret && process.env.NODE_ENV==='production')throw new Error('RATE_LIMIT_KEY_SECRET_REQUIRED');
 return createHmac('sha256',secret??'local-development-only').update(value.trim().toLowerCase()).digest('hex');
}

export function clientIp(headers:Record<string,string|string[]|undefined>,remote:string|undefined):string {
 if(process.env.TRUST_PROXY==='cloudflare'){
  const forwarded=headers['cf-connecting-ip'];
  if(typeof forwarded==='string'&&forwarded.length<=64)return forwarded;
 }
 return remote??'unknown';
}

export function createRateLimiter(url=process.env.REDIS_URL):RateLimiter {
 if(!url){
  if(process.env.NODE_ENV==='production')throw new Error('REDIS_URL_REQUIRED');
  const memory=new Map<string,{count:number,expires:number}>();
  return {
   async consume(rule){
    const now=Date.now();const id=`${rule.scope}:${rule.key}`;let value=memory.get(id);
    if(!value||value.expires<=now)value={count:0,expires:now+rule.windowSeconds*1000};
    value.count++;memory.set(id,value);
    return {allowed:value.count<=rule.limit,limit:rule.limit,remaining:Math.max(0,rule.limit-value.count),retryAfter:Math.max(1,Math.ceil((value.expires-now)/1000))};
   },async close(){memory.clear();},
  };
 }
 const redis=new Redis(url,{enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:3000,lazyConnect:true,retryStrategy:times=>Math.min(times*200,2000)});
 redis.on('error',error=>console.error('[rate-limit] Redis unavailable',error.message));
 return {
  async consume(rule){
   try{
    if(redis.status==='wait')await redis.connect();
    const id=`freight-audit:rl:${rule.scope}:${privacyKey(rule.key)}`;
    const result=await redis.eval(script,1,id,String(rule.windowSeconds)) as [number,number];
    const count=Number(result[0]);return {allowed:count<=rule.limit,limit:rule.limit,remaining:Math.max(0,rule.limit-count),retryAfter:Math.max(1,Number(result[1]))};
   }catch(error){
    console.error('[rate-limit] Check failed',error instanceof Error?error.message:'unknown');
    return {allowed:!rule.failClosed,limit:rule.limit,remaining:0,retryAfter:5};
   }
  },
  async close(){if(redis.status!=='end')await redis.quit().catch(()=>redis.disconnect());},
 };
}
