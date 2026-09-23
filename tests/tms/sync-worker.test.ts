import {beforeEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>db}));
vi.mock('../../src/notifications/google-chat.sender.js',()=>({notifyOperationalError:async()=>{}}));
import {syncConnection,TmsReceivingClient} from '../../src/tms/sync.js';
const connection={tenant_id:'11111111-1111-4111-8111-111111111111',provider:'tai',credentials_ciphertext:'encrypted',connection_version:'22222222-2222-4222-8222-222222222222',sync_claim:'33333333-3333-4333-8333-333333333333'};
beforeEach(()=>{vi.resetAllMocks();db.rpc.mockResolvedValue({data:true,error:null});});
it('queues a scoped document snapshot for each nonempty record then records a successful sync',async()=>{
 const client={async *records(){yield {id:'1',documents:[]};yield {id:'2',documents:[{id:'bill',revision:'1',filename:'bill.pdf',download:vi.fn()}]};},record:vi.fn()};
 await syncConnection(connection,client);
 expect(db.rpc).toHaveBeenCalledWith('enqueue_tms_documents',expect.objectContaining({p_tenant:connection.tenant_id,p_provider:'tai',p_version:connection.connection_version,p_claim:connection.sync_claim,p_record:'2',p_documents:[expect.objectContaining({externalId:'bill'})]}));
 expect(db.rpc).toHaveBeenCalledWith('finish_tms_coverage',expect.objectContaining({p_error:null,p_claim:connection.sync_claim,p_records:[{record:'1',batch:null},{record:'2',batch:expect.any(String)}]}));expect(db.rpc).toHaveBeenCalledTimes(2);
});
it('records provider errors without exposing response content or advancing success state',async()=>{
 await syncConnection(connection,{async *records(){throw new Error('secret provider token=abc');},record:vi.fn()});
 expect(db.rpc).not.toHaveBeenCalledWith('enqueue_tms_documents',expect.anything());expect(db.rpc).toHaveBeenCalledWith('finish_tms_coverage',expect.objectContaining({p_error:'TMS_SYNC_FAILED'}));
});
it('does not continue discovery after the connection lease is rejected',async()=>{
 db.rpc.mockImplementation(async name=>name==='enqueue_tms_documents'?{error:{message:'stale'}}:{error:null});let scanned=0;
 await syncConnection(connection,{async *records(){for(let i=0;i<3;i++){scanned++;yield {id:String(i),documents:[{id:'bill',revision:'1',filename:'bill.pdf',download:vi.fn()}]};}},record:vi.fn()});
 expect(scanned).toBe(1);expect(db.rpc).toHaveBeenLastCalledWith('finish_tms_coverage',expect.objectContaining({p_error:'TMS_ENQUEUE_FAILED'}));
});
it.each([{status:'disconnected',sync_enabled:false,connection_version:connection.connection_version},{status:'verified',sync_enabled:true,connection_version:'stale'}])('blocks stale or disconnected queued jobs',async data=>{
 const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data,error:null})};db.from.mockReturnValue(chain);
 const client=new TmsReceivingClient({id:'job',email_id:'batch',tenant_id:connection.tenant_id,source:'tms',tms_provider:'tai',tms_connection_version:connection.connection_version});await expect(client.authorize()).rejects.toThrow('TMS_CONNECTION_INACTIVE');
});
