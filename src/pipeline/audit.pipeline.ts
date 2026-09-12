import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { IExtractionProvider } from '../extraction/extraction.interface.js';
import type { GetCarrierFn, RuleException } from '../types/rule.types.js';
import type { AuditContext } from '../types/carrier.types.js';
import type { InvoiceRecord } from '../types/invoice.types.js';
import type { AuditReport } from '../types/report.types.js';
import { normalizeFields } from '../normalization/index.js';
import { createAuditStore, type AuditStore } from '../db/audit.repo.js';
import { ALL_RULES } from '../rules/index.js';
import { buildReport } from '../report/report.builder.js';
import type {PodExtractionResult} from '../pod/types.js';
import type {RateConfirmationExtractionResult} from '../rate-confirmation/types.js';
import {reconcileDocuments} from '../reconciliation/reconcile.js';
import {confidenceSummary,verifyInvoice} from '../confidence/engine.js';
import {info} from '../observability/logger.js';

export interface PipelineOptions {
  tenantId: string;
  filePaths: string[];
  sourceLabels?: Record<string,string>;
  ctx: AuditContext;
  extractor: IExtractionProvider;
  getCarrier: GetCarrierFn;
  store?: AuditStore;
  minimumInvoiceDate?: string;
  maximumInvoiceDate?: string;
  pods?:PodExtractionResult[];
  rateConfirmations?:RateConfirmationExtractionResult[];
  reconcileSupportingDocuments?:boolean;
}

export async function runAuditPipeline(options: PipelineOptions): Promise<AuditReport> {
  const { filePaths, ctx, extractor, getCarrier, tenantId, store = createAuditStore(options.tenantId) } = options;
  await store.assertActive();
  const history = await store.history();
  if (history.some(i => i.tenant_id !== tenantId)) throw new Error('Cross-account history rejected.');
  const known = new Set(history.map(inv => inv.document_hash).filter(Boolean));
  const invoices: InvoiceRecord[] = [];
  const skipped: string[] = [];
  for (const file of filePaths) {
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error(`Not a PDF: ${file}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (known.has(hash)) { skipped.push(options.sourceLabels?.[file] ?? file); continue; }
    await store.assertActive();
    const result = await extractor.extract(file);
    // Detect modification during extraction before attaching a content identity.
    if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash) throw new Error(`File changed during extraction: ${file}`);
    const fields = normalizeFields(result.fields);
    const documentDate = fields.data_fatura ?? fields.data_carga;
    if (documentDate && ((options.minimumInvoiceDate && documentDate < options.minimumInvoiceDate) || (options.maximumInvoiceDate && documentDate > options.maximumInvoiceDate))) {
      skipped.push(options.sourceLabels?.[file] ?? file);
      continue;
    }
    const verification=verifyInvoice({fields,evidence:result.field_evidence,history,tenantId,sourceId:hash});
    const confidence = Object.fromEntries(Object.entries(verification.fields).map(([field,value])=>[field,value.confidence]));
    for (const key of ['data_carga', 'data_fatura'] as const) {
      if (result.fields[key] && !fields[key]) confidence[key] = 0;
    }
    invoices.push({ ...fields, tenant_id: tenantId, id: randomUUID(), source_file: options.sourceLabels?.[file] ?? file, document_hash: hash,
      numero_fatura: fields.numero_fatura ?? '', confidence_scores: confidence,verification,
      accessorials: result.accessorials, extraction_raw: result.extraction_raw, created_at: new Date().toISOString() });
    known.add(hash);
  }
  const currentIds = new Set(invoices.map(inv => inv.id));
  const ruleContext:AuditContext={...ctx,currentInvoiceIds:currentIds};
  const exceptions: RuleException[] = [];
  const historicalRules = new Set(['DUPLICATE_EXACT', 'DUPLICATE_PROBABLE', 'BANKING_CHANGE']);
  if (invoices.length) for (const rule of ALL_RULES) {
    const input = historicalRules.has(rule.name) ? [...history, ...invoices] : invoices;
    exceptions.push(...(await rule.evaluate(input, getCarrier, ruleContext)).filter(ex => currentIds.has(ex.invoice_id)));
  }
  const hasSupportingDocuments=Boolean((options.pods?.length??0)+(options.rateConfirmations?.length??0));
  const reconciliation=options.reconcileSupportingDocuments&&hasSupportingDocuments
   ?reconcileDocuments(invoices,options.pods??[],options.rateConfirmations??[],Number(process.env.SUPPORTING_DOCUMENT_CONFIDENCE_THRESHOLD??0.9))
   :{exceptions:[],summary:{matched:0,divergent:0,unverifiable:0,unbilled_revenue:0,supporting_documents:0},warnings:[]};
  exceptions.push(...reconciliation.exceptions);
  const report = buildReport(invoices, exceptions, ctx);
  report.confidence=confidenceSummary(invoices);
  info('audit.confidence.measured',{tenant_id:tenantId,run_id:ctx.run_id,invoices:invoices.length,...report.confidence});
  report.reconciliation=reconciliation.summary;
  report.tenant_id = tenantId;
  report.skipped_files = skipped;
  report.warnings = ['Carrier checks describe lookup-time status; historical load-date authority is not verified.'];
  report.warnings.push(...reconciliation.warnings);
  const invoicesWithoutBanking=invoices.filter(inv=>!inv.dados_bancarios?.account_number?.trim()||!inv.dados_bancarios?.routing_number?.trim()).length;
  if(invoicesWithoutBanking)report.warnings.push(`${invoicesWithoutBanking} invoice${invoicesWithoutBanking===1?'':'s'} did not include complete banking details; banking-change comparison was not performed for ${invoicesWithoutBanking===1?'this invoice':'these invoices'}.`);
  if (invoices.some(inv => inv.extraction_raw.provider === 'stub')) report.warnings.push('SIMULATION: invoice fields were generated by the stub extractor.');
  if (report.confidence.review||report.confidence.unverifiable) report.warnings.push('Only documents supported by verifiable field evidence are automated; ambiguous or incomplete documents require review.');
  if (process.env.CARRIER_PROVIDER !== 'fmcsa') report.warnings.push('SIMULATION: carrier provider is not configured for live FMCSA data.');
  if (invoices.length) await store.assertActive();
  if (invoices.length) await store.commit(invoices, exceptions, report, history.map(inv => inv.id));
  return report;
}
