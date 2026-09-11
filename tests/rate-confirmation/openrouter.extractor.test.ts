import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OpenRouterRateConfirmationExtractor} from '../../src/rate-confirmation/openrouter.extractor.js';

const field=(value:unknown)=>({value,confidence:value==null?0:0.98,evidence:value==null?null:{page:1,text:String(value),bounding_box:null}});
const fields={load_number:field('LOAD-42'),bol_number:field(null),carrier_name:field('Carrier LLC'),origin:field('A'),destination:field('B'),linehaul_amount:field(900),total_amount:field(1025),accessorials:[{type:'DETENTION',description:'Detention',amount:125,confidence:0.98,evidence:{page:1,text:'Detention $125',bounding_box:null}}]};
const success=(content=JSON.stringify({fields}))=>Response.json({id:'req-1',model:'model',choices:[{finish_reason:'stop',message:{content,refusal:null}}]});
let dir:string|undefined;

afterEach(async()=>{vi.unstubAllEnvs();if(dir)await rm(dir,{recursive:true,force:true});dir=undefined;});
async function pdf(){dir=await mkdtemp(join(tmpdir(),'rate-confirmation-'));const file=join(dir,'rate.pdf');await writeFile(file,'%PDF-test');vi.stubEnv('OPENROUTER_API_KEY','key');return file;}

describe('rate confirmation extraction',()=>{
 it('returns structured authorized charges with evidence',async()=>{
  const file=await pdf();const request=vi.fn().mockResolvedValue(success());
  const result=await new OpenRouterRateConfirmationExtractor(request).extract(file);
  expect(result.fields.accessorials[0]).toMatchObject({type:'DETENTION',amount:125});expect(result.requires_human_review).toBe(false);
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.response_format.json_schema.name).toBe('rate_confirmation');expect(JSON.stringify(body.response_format.json_schema.schema)).not.toContain('exclusiveMinimum');
 });
 it('retries a rejected structured-output request with validated prompt JSON',async()=>{
  const file=await pdf();const rejected=Response.json({error:{code:400,message:'Invalid response_format JSON schema'}},{status:400});
  const request=vi.fn().mockResolvedValueOnce(rejected).mockResolvedValueOnce(success('```json\n'+JSON.stringify({fields})+'\n```'));
  const result=await new OpenRouterRateConfirmationExtractor(request).extract(file);
  expect(request).toHaveBeenCalledTimes(2);expect(JSON.parse(request.mock.calls[1][1].body).response_format).toBeUndefined();
  expect(result.raw).toMatchObject({structured_output_fallback:true,initial_provider_reason:'STRUCTURED_OUTPUT_REJECTED'});
 });
 it('keeps a sanitized provider reason when both attempts are rejected',async()=>{
  const file=await pdf();const request=vi.fn()
   .mockResolvedValueOnce(Response.json({error:{message:'JSON schema is unsupported'}},{status:400}))
   .mockResolvedValueOnce(Response.json({error:{code:'payment_required',message:'Insufficient credits for this request'}},{status:402}));
  await expect(new OpenRouterRateConfirmationExtractor(request).extract(file)).rejects.toMatchObject({providerReason:'INSUFFICIENT_CREDITS',providerCode:'payment_required'});
 });
 it('rejects malformed provider output',async()=>{
  const file=await pdf();const request=vi.fn().mockResolvedValue(success('{}'));
  await expect(new OpenRouterRateConfirmationExtractor(request).extract(file)).rejects.toThrow('invalid extraction');
 });
});
