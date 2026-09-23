import {z} from 'zod';
const evidence=z.object({page:z.number().int().positive(),text:z.string().min(1).max(1000)}).nullable();
const field=<T extends z.ZodTypeAny>(value:T)=>z.object({value:value.nullable(),confidence:z.number().min(0).max(1),evidence});
export const AccessorialFieldsSchema=z.object({
 carrier_name:field(z.string().max(300)).optional(),
 authorized_by:field(z.string().max(300)).optional(),
 hourly_rate:field(z.number().finite().nonnegative()).optional(),
 free_minutes:field(z.number().int().nonnegative()).optional(),
 rounding_minutes:field(z.number().int().positive().max(1440)).optional(),
 maximum_amount:field(z.number().finite().nonnegative()).optional(),
 load_number:field(z.string().max(200)),
 charge_type:field(z.enum(['LUMPER','DETENTION','LAYOVER','LIFTGATE','REDELIVERY','TONU','OTHER'])),
 record_kind:field(z.enum(['receipt','time_record','authorization','other'])),
 amount:field(z.number().finite().nonnegative()),currency:field(z.enum(['USD','CAD','OTHER'])),
 service_date:field(z.string().date()),
 arrival_at:field(z.string().datetime({offset:true})),departure_at:field(z.string().datetime({offset:true})),
});
export const AccessorialExtractionSchema=z.object({source_file:z.string().min(1),fields:AccessorialFieldsSchema,requires_human_review:z.boolean(),raw:z.record(z.unknown())});
export type AccessorialExtractionResult=z.infer<typeof AccessorialExtractionSchema>;
