import {describe,it,expect,vi} from 'vitest';
import {parseAuditRecipient} from '../../src/db/tenants.repo.js';
import {createAuditStore} from '../../src/db/audit.repo.js';
vi.mock('../../src/config/supabase.js',()=>({getSupabaseClient:vi.fn(()=>{throw new Error('Unexpected database access');})}));
describe('account routing',()=>{
 it('normalizes a full original recipient',()=>expect(parseAuditRecipient(' SHORE-LOGISTICS@AUDIT.AIOLYMPIAN.COM ')).toBe('shore-logistics'));
 it.each(['shore@evil.com','shore@audit.aiolympian.com.evil.com','Name <shore@audit.aiolympian.com>','shore+other@audit.aiolympian.com','@audit.aiolympian.com'])('rejects ambiguous recipient %s',a=>expect(()=>parseAuditRecipient(a)).toThrow());
 it('requires a valid tenant id',()=>expect(()=>createAuditStore('')).toThrow());
 it('rejects foreign writes before reaching the database',async()=>{
 const store=createAuditStore('00000000-0000-4000-8000-000000000001');
 await expect(store.commit([{tenant_id:'other'}] as any,[],{tenant_id:'other'} as any,[])).rejects.toThrow('Cross-account');
 });
});
