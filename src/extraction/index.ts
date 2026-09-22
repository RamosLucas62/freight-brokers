import { AzureInvoiceExtractor } from './azure.extractor.js';
import { ExtractionResultSchema } from './schema.js';
import { OpenRouterInvoiceExtractor } from './openrouter.extractor.js';
import type { IExtractionProvider } from './extraction.interface.js';
import type { InvoiceExtractionResult } from '../types/invoice.types.js';
import { StubExtractor } from './stub.extractor.js';
import type {CostContext} from '../costs/telemetry.js';

export class ValidatingExtractor implements IExtractionProvider {
  constructor(private readonly inner: IExtractionProvider) {}

  async extract(filePath: string,context?:CostContext): Promise<InvoiceExtractionResult> {
    const result = await this.inner.extract(filePath,context);
    const parsed = ExtractionResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `Extraction contract violation for "${filePath}": ${parsed.error.message}`
      );
    }
    return parsed.data as InvoiceExtractionResult;
  }
}

function createExtractor(): IExtractionProvider {
  const provider = process.env.EXTRACTOR_PROVIDER ?? 'openrouter';

  switch (provider) {
    case 'openrouter':
      return new ValidatingExtractor(new OpenRouterInvoiceExtractor());
    case 'azure':
      return new ValidatingExtractor(new AzureInvoiceExtractor());
    case 'stub':
      return new ValidatingExtractor(new StubExtractor());
    default:
      throw new Error(`Unknown EXTRACTOR_PROVIDER: "${provider}". Supported: openrouter, azure, stub`);
  }
}

export const extractor: IExtractionProvider = createExtractor();
export { ExtractionResultSchema };
export type { IExtractionProvider };
