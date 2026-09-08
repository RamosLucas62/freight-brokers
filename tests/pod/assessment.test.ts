import {describe,expect,it} from 'vitest';
import {assessPod} from '../../src/pod/assessment.js';
import type {PodExtractionResult} from '../../src/pod/types.js';
const f=<T>(value:T|null,confidence=0.99)=>({value,confidence,evidence:null});
const result=(confidence=0.99):PodExtractionResult=>({source_file:'pod.pdf',source_kind:'ocr',fields:{load_number:f('L-1',confidence),bol_number:f('B-1',confidence),delivery_date:f('2026-09-08',confidence),delivery_time:f('10:30',confidence),receiver_name:f('Ana',confidence),delivery_location:f('Miami, FL',confidence),signature_present:f(true,confidence),damage_or_shortage_noted:f(false,confidence),exception_notes:f<string>(null,0)},quality:{score:0.95,rotation_degrees:0,perspective_distortion:false,blur:false,glare_or_shadow:false,cropped:false,reasons:[]},requires_human_review:false,raw:{}});
describe('POD assessment',()=>{
 it('confirms matching high-confidence evidence',()=>expect(assessPod(result(),{load_number:'L-1',signature_required:true}).status).toBe('confirmed'));
 it('reports only high-confidence divergence',()=>expect(assessPod(result(),{load_number:'OTHER'})).toMatchObject({status:'divergent',divergent_fields:['load_number']}));
 it('never turns an uncertain mismatch into divergence',()=>{const assessment=assessPod(result(0.5),{load_number:'OTHER'});expect(assessment.status).toBe('unverifiable');expect(assessment.divergent_fields).toEqual([]);expect(assessment.unverifiable_fields).toContain('load_number');});
 it('makes poor document quality unverifiable',()=>{const value=result();value.quality.score=0.5;expect(assessPod(value).status).toBe('unverifiable');});
 it('requires identity, delivery date and signature evidence even without a reference',()=>{const value=result();value.fields.signature_present=f<boolean>(null,0);expect(assessPod(value).status).toBe('unverifiable');});
});
