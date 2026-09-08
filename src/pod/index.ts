import {extname} from 'node:path';
import {OpenRouterPodExtractor} from './openrouter.extractor.js';
import {StructuredPodImporter} from './structured.importer.js';
import {ConsensusPodExtractor} from './consensus.extractor.js';
import type {PodExtractionResult} from './types.js';

export async function processPodFile(file:string):Promise<PodExtractionResult[]>{
 const extension=extname(file).toLowerCase();
 if(extension==='.csv'||extension==='.xlsx')return new StructuredPodImporter().import(file);
 const primary=new OpenRouterPodExtractor();
 const secondaryModel=process.env.POD_SECONDARY_OPENROUTER_MODEL?.trim();
 if(!secondaryModel)return [await primary.extract(file)];
 const secondary=new OpenRouterPodExtractor(async(url,options)=>{const body=JSON.parse(String(options?.body));body.model=secondaryModel;return fetch(url,options?{...options,body:JSON.stringify(body)}:options);});
 return [await new ConsensusPodExtractor([primary,secondary]).extract(file)];
}
export {assessPod} from './assessment.js';
export {OpenRouterPodExtractor} from './openrouter.extractor.js';
export {StructuredPodImporter} from './structured.importer.js';
export {ConsensusPodExtractor} from './consensus.extractor.js';
export {PodExtractionSchema,PodFieldsSchema,PodQualitySchema} from './schema.js';
export type * from './types.js';
