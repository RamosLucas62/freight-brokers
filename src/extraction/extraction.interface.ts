import type { InvoiceExtractionResult } from '../types/invoice.types.js';

export interface IExtractionProvider {
  extract(filePath: string): Promise<InvoiceExtractionResult>;
}
