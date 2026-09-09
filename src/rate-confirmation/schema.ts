import {z} from 'zod';

const evidence=z.object({page:z.number().int().positive().nullable(),text:z.string().max(1000).nullable(),bounding_box:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).nullable()}).nullable();
const field=<T extends z.ZodTypeAny>(value:T)=>z.object({value:value.nullable(),confidence:z.number().min(0).max(1),evidence});
export const RateConfirmationFieldsSchema=z.object({
 load_number:field(z.string().max(200)),bol_number:field(z.string().max(200)),carrier_name:field(z.string().max(300)),
 origin:field(z.string().max(500)),destination:field(z.string().max(500)),linehaul_amount:field(z.number().nonnegative()),total_amount:field(z.number().nonnegative()),
 accessorials:z.array(z.object({type:z.string().max(100),description:z.string().max(500),amount:z.number().nonnegative(),confidence:z.number().min(0).max(1),evidence})).max(100),
});
export const RateConfirmationExtractionSchema=z.object({source_file:z.string().min(1),fields:RateConfirmationFieldsSchema,requires_human_review:z.boolean(),raw:z.record(z.unknown())});
