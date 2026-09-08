import type {PodAssessment,PodExtractionResult,PodReference} from './types.js';

const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase().replace(/[.,]/g,'');

export function assessPod(result:PodExtractionResult,reference:PodReference={},minimumConfidence=0.9):PodAssessment {
 if(!Number.isFinite(minimumConfidence)||minimumConfidence<0||minimumConfidence>1)throw new Error('POD minimum confidence must be between 0 and 1.');
 const matched:string[]=[];const divergent:string[]=[];const unverifiable:string[]=[];const reasons:string[]=[];
 const compare=(name:keyof Pick<PodReference,'load_number'|'bol_number'|'delivery_date'|'receiver_name'|'delivery_location'>)=>{
  const expected=reference[name];if(expected==null||expected.trim()==='')return;
  const field=result.fields[name];
  if(field.value==null||field.confidence<minimumConfidence){unverifiable.push(name);return;}
  (normalize(field.value)===normalize(expected)?matched:divergent).push(name);
 };
 compare('load_number');compare('bol_number');compare('delivery_date');compare('receiver_name');compare('delivery_location');
 if(reference.signature_required){const field=result.fields.signature_present;if(field.value==null||field.confidence<minimumConfidence)unverifiable.push('signature_present');else if(field.value)matched.push('signature_present');else divergent.push('signature_present');}
 if(result.quality.score<0.7){reasons.push(`Document quality is ${(result.quality.score*100).toFixed(0)}%; human review required.`);}
 const identity=[result.fields.load_number,result.fields.bol_number];
 if(!identity.some(field=>field.value!=null&&field.confidence>=minimumConfidence))unverifiable.push('load_or_bol_number');
 for(const name of ['delivery_date','signature_present'] as const){const field=result.fields[name];if(field.value==null||field.confidence<minimumConfidence)unverifiable.push(name);}
 const uniqueUnverifiable=[...new Set(unverifiable)];unverifiable.splice(0,unverifiable.length,...uniqueUnverifiable);
 if(unverifiable.length)reasons.push(`Insufficient evidence: ${unverifiable.join(', ')}.`);
 if(divergent.length)reasons.push(`High-confidence divergence: ${divergent.join(', ')}.`);
 // Never turn uncertainty into a divergence. Any uncertain compared field wins over mismatches.
 const status=unverifiable.length||result.quality.score<0.7?'unverifiable':divergent.length?'divergent':'confirmed';
 return {status,reasons,matched_fields:matched,divergent_fields:status==='divergent'?divergent:[],unverifiable_fields:unverifiable};
}
