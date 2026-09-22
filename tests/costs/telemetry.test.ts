import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({upsert:vi.fn(),from:vi.fn()}));
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({from:mocks.from})}));
import {recordOpenRouterUsage} from '../../src/costs/telemetry.js';

describe('cost telemetry',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.upsert.mockResolvedValue({error:null});mocks.from.mockReturnValue({upsert:mocks.upsert});});
 it('attributes actual provider cost and tokens to the full customer process',async()=>{
  await recordOpenRouterUsage({context:{tenantId:'11111111-1111-4111-8111-111111111111',subjectType:'audit_run',subjectId:'run-1'},operation:'invoice_extraction',model:'google/gemini-2.5-flash',requestId:'generation-1',usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,cost:0.00008}});
  expect(mocks.from).toHaveBeenCalledWith('audit_cost_events');expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({tenant_id:'11111111-1111-4111-8111-111111111111',subject_type:'audit_run',operation:'invoice_extraction',input_tokens:100,output_tokens:20,total_tokens:120,cost_usd:0.00008,cost_status:'actual'}),expect.objectContaining({onConflict:'provider,request_id'}));
 });
 it('records a pending reconciliation event when OpenRouter omits cost',async()=>{await recordOpenRouterUsage({context:{subjectType:'free_audit',subjectId:'lead-1'},operation:'jev_audit_review',model:'typesafe/jev-1.13',requestId:'decision-1'});expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({tenant_id:null,cost_usd:null,cost_status:'pending'}),expect.anything());});
});
