import {z} from 'zod';

const evidence=z.object({page:z.number().int().positive().nullable(),text:z.string().max(1000).nullable(),bounding_box:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).nullable()}).nullable();
const field=<T extends z.ZodTypeAny>(value:T)=>z.object({value:value.nullable(),confidence:z.number().min(0).max(1),evidence});

export const PodFieldsSchema=z.object({
 load_number:field(z.string().max(200)),bol_number:field(z.string().max(200)),
 delivery_date:field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),delivery_time:field(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)),
 receiver_name:field(z.string().max(300)),delivery_location:field(z.string().max(500)),
 signature_present:field(z.boolean()),damage_or_shortage_noted:field(z.boolean()),exception_notes:field(z.string().max(2000)),
});
export const PodQualitySchema=z.object({score:z.number().min(0).max(1),rotation_degrees:z.number().min(-180).max(180),perspective_distortion:z.boolean(),blur:z.boolean(),glare_or_shadow:z.boolean(),cropped:z.boolean(),reasons:z.array(z.string().max(300)).max(20)});
export const PodExtractionSchema=z.object({source_file:z.string().min(1),source_kind:z.enum(['ocr','csv','xlsx']),fields:PodFieldsSchema,quality:PodQualitySchema,requires_human_review:z.boolean(),raw:z.record(z.unknown())});
