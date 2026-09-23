import { z } from 'zod';

// Zod schema for contract validation
const DadosBancariosSchema = z.object({
  bank_name:      z.string().nullish(),
  account_number: z.string().nullish(),
  routing_number: z.string().nullish(),
  account_type:   z.enum(['checking', 'savings']).nullish(),
  payee_name:     z.string().nullish(),
}).nullable();

const AccessorialSchema = z.object({
  evidence:z.object({page:z.number().int().positive().nullable(),text:z.string().max(1000).nullable()}).nullable().optional(),
  tipo:       z.string(),
  descricao:  z.string(),
  valor:      z.number(),
  confidence: z.number().min(0).max(1),
  pagina:     z.number().int(),
  posicao:    z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }).nullable(),
});

const InvoiceFieldsSchema = z.object({
  currency:z.enum(['USD','CAD']).nullable().optional(),
  numero_fatura:   z.string().nullable(),
  numero_carga:    z.string().nullable(),
  carrier_name:    z.string().nullable(),
  mc_number:       z.string().nullable(),
  dot_number:      z.string().nullable(),
  data_carga:      z.string().nullable(),
  data_fatura:     z.string().nullable(),
  valor_total:     z.number().nullable(),
  origem:          z.string().nullable(),
  destino:         z.string().nullable(),
  dados_bancarios: DadosBancariosSchema,
});

const FieldEvidenceSchema = z.object({
  page: z.number().int().positive().nullable(),
  text: z.string().max(500).nullable(),
}).nullable();

export const ExtractionResultSchema = z.object({
  source_file:       z.string(),
  fields:            InvoiceFieldsSchema,
  confidence_scores: z.record(z.number().min(0).max(1)),
  field_evidence:    z.record(FieldEvidenceSchema).optional(),
  accessorials:      z.array(AccessorialSchema),
  extraction_raw:    z.record(z.unknown()),
});
