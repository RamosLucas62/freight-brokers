import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:()=>({rpc:mocks.rpc})}));

import {replaceAttachments} from '../../src/free-audit/repository.js';

const attachment={request_id:'11111111-1111-4111-8111-111111111111',attachment_id:'22222222-2222-4222-8222-222222222222',filename:'invoice.pdf',storage_path:'free-audits/request/invoice.pdf',document_hash:'a'.repeat(64),size_bytes:128};

beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:true,error:null});});

describe('free audit attachment persistence',()=>{
 it('replaces the complete attachment set through one atomic database call',async()=>{
  await expect(replaceAttachments(attachment.request_id,[attachment])).resolves.toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledWith('replace_free_audit_attachments',{p_request:attachment.request_id,p_attachments:[attachment]});
 });
 it('rejects an empty replacement before touching the database',async()=>{
  await expect(replaceAttachments(attachment.request_id,[])).rejects.toThrow('FREE_AUDIT_ATTACHMENTS_REQUIRED');expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('surfaces a refused or failed atomic replacement',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:false,error:null});await expect(replaceAttachments(attachment.request_id,[attachment])).rejects.toThrow('FREE_AUDIT_ATTACHMENT_REPLACE_FAILED');
  mocks.rpc.mockResolvedValueOnce({data:null,error:new Error('database offline')});await expect(replaceAttachments(attachment.request_id,[attachment])).rejects.toThrow('FREE_AUDIT_ATTACHMENT_REPLACE_FAILED');
 });
});
