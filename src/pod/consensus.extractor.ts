import type {PodExtractionResult,PodField,PodFields} from './types.js';
import {PodExtractionSchema} from './schema.js';

export interface PodExtractor {extract(file:string):Promise<PodExtractionResult>}
const normalized=(value:unknown)=>typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase():value;

export class ConsensusPodExtractor implements PodExtractor {
 constructor(private readonly extractors:PodExtractor[]){if(extractors.length<2)throw new Error('POD consensus requires at least two extractors.');}
 async extract(file:string):Promise<PodExtractionResult>{
  const results=await Promise.all(this.extractors.map(extractor=>extractor.extract(file)));
  const names=Object.keys(results[0].fields) as (keyof PodFields)[];
  const mutableFields:Record<string,PodField<unknown>>={};const disagreements:string[]=[];
  for(const name of names){const candidates=results.map(result=>result.fields[name] as PodField<unknown>);const values=candidates.map(field=>normalized(field.value));const agrees=values.every(value=>value===values[0]);
   if(agrees){const chosen=candidates.reduce((best,current)=>current.confidence<best.confidence?current:best);mutableFields[name]={value:candidates[0].value,confidence:Math.min(...candidates.map(field=>field.confidence)),evidence:chosen.evidence};}
   else{disagreements.push(name);mutableFields[name]={value:null,confidence:0,evidence:null};}
  }
  const fields=mutableFields as unknown as PodFields;
  const qualityScore=Math.min(...results.map(result=>result.quality.score));
  return PodExtractionSchema.parse({source_file:file,source_kind:'ocr',fields,quality:{score:qualityScore,rotation_degrees:results[0].quality.rotation_degrees,perspective_distortion:results.some(result=>result.quality.perspective_distortion),blur:results.some(result=>result.quality.blur),glare_or_shadow:results.some(result=>result.quality.glare_or_shadow),cropped:results.some(result=>result.quality.cropped),reasons:[...new Set(results.flatMap(result=>result.quality.reasons).concat(disagreements.length?[`OCR readers disagreed on: ${disagreements.join(', ')}`]:[]))]},requires_human_review:results.some(result=>result.requires_human_review)||disagreements.length>0,raw:{provider:'consensus',reader_count:results.length,disagreements}});
 }
}
