import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),failure:vi.fn(),warn:vi.fn(),info:vi.fn()}));
vi.mock('../../src/config/supabase.js',async original=>({...await original<typeof import('../../src/config/supabase.js')>(),getSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock('../../src/observability/logger.js',async original=>({...await original<typeof import('../../src/observability/logger.js')>(),failure:mocks.failure,warn:mocks.warn,info:mocks.info}));
import {startTmsSyncWorker} from '../../src/tms/sync.js';
let stop:(()=>Promise<void>)|undefined;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));vi.clearAllMocks();mocks.rpc.mockReset();mocks.rpc.mockResolvedValue({error:{code:'PGRST202',message:'function missing; secret=private'},data:null});});
afterEach(async()=>{await stop?.();stop=undefined;vi.useRealTimers();});
describe('TMS worker failure control',()=>{
 it('backs off instead of polling every five seconds and preserves only safe diagnostics',async()=>{
  stop=startTmsSyncWorker();await vi.advanceTimersByTimeAsync(0);
  expect(mocks.failure).toHaveBeenCalledOnce();const error=mocks.failure.mock.calls[0][1];expect(error).toMatchObject({message:'TMS_CLAIM_FAILED',providerCode:'PGRST202',providerReason:'SUPABASE_QUERY_ERROR'});expect(JSON.stringify(mocks.failure.mock.calls)).not.toContain('private');
  await vi.advanceTimersByTimeAsync(14999);expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(mocks.rpc).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(29999);expect(mocks.rpc).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);expect(mocks.rpc).toHaveBeenCalledTimes(3);
  expect(mocks.failure).toHaveBeenCalledOnce();expect(mocks.warn).toHaveBeenCalledTimes(2);
 });
 it('caps delay at five minutes and sends a periodic reminder instead of unlimited alerts',async()=>{
  stop=startTmsSyncWorker();await vi.advanceTimersByTimeAsync(0);
  for(const delay of [15000,30000,60000,120000,240000,300000])await vi.advanceTimersByTimeAsync(delay);
  expect(mocks.rpc).toHaveBeenCalledTimes(7);expect(mocks.failure).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(300000);expect(mocks.failure).toHaveBeenCalledTimes(2);expect(mocks.failure.mock.calls[1][2]).toMatchObject({retry_in_seconds:300,suppressed_alerts:6});
 });
 it('reports a different database error immediately during the suppression window',async()=>{
  stop=startTmsSyncWorker();await vi.advanceTimersByTimeAsync(0);mocks.rpc.mockResolvedValue({error:{code:'42501',message:'permission denied'}});await vi.advanceTimersByTimeAsync(15000);expect(mocks.failure).toHaveBeenCalledTimes(2);
 });
 it('resets the retry interval after recovery and alerts on a new incident',async()=>{
  stop=startTmsSyncWorker();await vi.advanceTimersByTimeAsync(0);mocks.rpc.mockResolvedValue({data:[],error:null});await vi.advanceTimersByTimeAsync(15000);
  expect(mocks.info).toHaveBeenCalledWith('tms.sync.worker_recovered',expect.objectContaining({failed_attempts:1}));await vi.advanceTimersByTimeAsync(5000);expect(mocks.rpc).toHaveBeenCalledTimes(3);
  mocks.rpc.mockResolvedValue({error:{code:'PGRST202',message:'missing'}});await vi.advanceTimersByTimeAsync(5000);expect(mocks.failure).toHaveBeenCalledTimes(2);expect(mocks.failure.mock.calls[1][2].retry_in_seconds).toBe(15);
 });
 it('does not overlap a slow claim and does not schedule again after shutdown',async()=>{
  let resolve!:(v:unknown)=>void;mocks.rpc.mockReturnValue(new Promise(r=>{resolve=r;}));stop=startTmsSyncWorker();await vi.advanceTimersByTimeAsync(60000);expect(mocks.rpc).toHaveBeenCalledOnce();
  const stopped=stop();resolve({data:[],error:null});await stopped;await vi.advanceTimersByTimeAsync(60000);expect(mocks.rpc).toHaveBeenCalledOnce();
 });
});
