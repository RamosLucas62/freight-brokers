import type { InvoiceExtractionResult } from '../types/invoice.types.js';
import type {CostContext} from '../costs/telemetry.js';

export interface IExtractionProvider {
  extract(filePath: string,context?:CostContext): Promise<InvoiceExtractionResult>;
}
