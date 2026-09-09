import type {PodEvidence,PodField} from '../pod/types.js';

export interface RateConfirmationAccessorial {
 type:string;
 description:string;
 amount:number;
 confidence:number;
 evidence:PodEvidence|null;
}

export interface RateConfirmationFields {
 load_number:PodField<string>;
 bol_number:PodField<string>;
 carrier_name:PodField<string>;
 origin:PodField<string>;
 destination:PodField<string>;
 linehaul_amount:PodField<number>;
 total_amount:PodField<number>;
 accessorials:RateConfirmationAccessorial[];
}

export interface RateConfirmationExtractionResult {
 source_file:string;
 fields:RateConfirmationFields;
 requires_human_review:boolean;
 raw:Record<string,unknown>;
}
