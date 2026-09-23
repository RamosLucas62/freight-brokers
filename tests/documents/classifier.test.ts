import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {OpenRouterDocumentClassifier} from '../../src/documents/classifier.js';
let dir:string|undefined;afterEach(async()=>{vi.unstubAllEnvs();if(dir)await rm(dir,{recursive:true,force:true});dir=undefined;});
describe('supporting document classification',()=>{
 it('classifies explicit filenames locally without sending document contents',async()=>{const request=vi.fn();const classifier=new OpenRouterDocumentClassifier(request as any);expect(await classifier.classify('/private/pod.pdf','proof-of-delivery.pdf')).toBe('pod');expect(await classifier.classify('/private/rate.pdf','rate_confirmation.pdf')).toBe('rate_confirmation');expect(request).not.toHaveBeenCalled();});
 it('accepts only a high-confidence provider classification for ambiguous filenames',async()=>{dir=await mkdtemp(join(tmpdir(),'document-classifier-'));const file=join(dir,'scan.pdf');await writeFile(file,'%PDF-test');vi.stubEnv('OPENROUTER_API_KEY','key');const response={ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({document_type:'invoice',confidence:0.98}),refusal:null}}]})));controller.close();}})} as Response;const classifier=new OpenRouterDocumentClassifier(vi.fn().mockResolvedValue(response));await expect(classifier.classify(file,'scan.pdf')).resolves.toBe('invoice');});
 it('routes uncertain classification to manual review',async()=>{dir=await mkdtemp(join(tmpdir(),'document-classifier-'));const file=join(dir,'scan.pdf');await writeFile(file,'%PDF-test');vi.stubEnv('OPENROUTER_API_KEY','key');const response={ok:true,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({document_type:'pod',confidence:0.6}),refusal:null}}]})));controller.close();}})} as Response;const classifier=new OpenRouterDocumentClassifier(vi.fn().mockResolvedValue(response));await expect(classifier.classify(file,'scan.pdf')).rejects.toThrow('unverifiable');});
});
it.each(['accessorial_evidence','other'])('distinguishes %s from a payable carrier invoice',async(document_type)=>{
 dir=await mkdtemp(join(tmpdir(),'receipt-classifier-'));const file=join(dir,'scan.pdf');await writeFile(file,'%PDF-test');vi.stubEnv('OPENROUTER_API_KEY','key');
 const classifier=new OpenRouterDocumentClassifier(vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({document_type,confidence:.99})}}]})));
 if(document_type==='other')await expect(classifier.classify(file,'scan.pdf')).rejects.toThrow('manual review');
 else await expect(classifier.classify(file,'scan.pdf')).resolves.toBe('accessorial_evidence');
});
