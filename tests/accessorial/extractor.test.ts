import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {OpenRouterAccessorialExtractor} from '../../src/accessorial/openrouter.extractor.js';
let dir:string|undefined;
afterEach(async()=>{vi.unstubAllEnvs();if(dir)await rm(dir,{recursive:true,force:true});});
const field=(value:unknown)=>({value,confidence:value===null?0:.99,evidence:value===null?null:{page:1,text:String(value)}});
const fields=()=>({load_number:field('LOAD-9876'),charge_type:field('LUMPER'),record_kind:field('receipt'),amount:field(150),currency:field('USD'),service_date:field('2026-09-22'),arrival_at:field(null),departure_at:field(null)});
async function setup(payload:unknown,finish_reason='stop'){
 dir=await mkdtemp(join(tmpdir(),'accessorial-'));const file=join(dir,'receipt.pdf');await writeFile(file,'%PDF-test');vi.stubEnv('OPENROUTER_API_KEY','test');
 const request=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason,message:{content:JSON.stringify({fields:payload})}}]}));
 return {file,extractor:new OpenRouterAccessorialExtractor(request),request};
}
describe('additional-charge extraction',()=>{
 it('preserves sourced values without treating a receipt as contractual approval',async()=>{
  const {file,extractor,request}=await setup(fields());const result=await extractor.extract(file);
  expect(result.fields.amount.value).toBe(150);expect(result.fields.amount.evidence?.text).toBe('150');expect(result.requires_human_review).toBe(true);
  expect(request.mock.calls[0][1].redirect).toBe('error');
 });
 it.each(['negative amount','invalid date','missing timezone','missing field'])('rejects %s',async(reason)=>{
  const f=fields();if(reason==='negative amount')f.amount=field(-1);if(reason==='invalid date')f.service_date=field('2026-02-30');if(reason==='missing timezone')f.arrival_at=field('2026-09-22T10:00:00');if(reason==='missing field')delete (f as any).load_number;
  const {file,extractor}=await setup(f);await expect(extractor.extract(file)).rejects.toThrow('invalid evidence');
 });
 it('rejects truncated model output',async()=>{const {file,extractor}=await setup(fields(),'length');await expect(extractor.extract(file)).rejects.toThrow('invalid evidence');});
});
