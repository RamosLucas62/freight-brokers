import type { IExtractionProvider } from './extraction.interface.js';
import type { InvoiceExtractionResult, InvoiceFields } from '../types/invoice.types.js';

const DEFAULT_FIELDS: InvoiceFields = {
  numero_fatura:   'INV-2024-001',
  numero_carga:    'LOAD-9876',
  carrier_name:    'SWIFT TRANSPORT LLC',
  mc_number:       '123456',
  dot_number:      '9876543',
  data_carga:      '2024-01-15',
  data_fatura:     '2024-01-20',
  valor_total:     2500.00,
  origem:          'Chicago, IL',
  destino:         'Dallas, TX',
  dados_bancarios: {
    bank_name:      'First National Bank',
    account_number: '123456789',
    routing_number: '021000021',
    account_type:   'checking',
    payee_name:     'SWIFT TRANSPORT LLC',
  },
};

const DEFAULT_CONFIDENCE = {
  numero_fatura:   0.98,
  numero_carga:    0.95,
  carrier_name:    0.97,
  mc_number:       0.99,
  dot_number:      0.95,
  data_carga:      0.92,
  data_fatura:     0.96,
  valor_total:     0.98,
  origem:          0.90,
  destino:         0.90,
  dados_bancarios: 0.95,
};

export class StubExtractor implements IExtractionProvider {
  constructor(private readonly overrides: Partial<InvoiceExtractionResult> = {}) {}

  async extract(filePath: string): Promise<InvoiceExtractionResult> {
    return {
      source_file:       filePath,
      fields:            { ...DEFAULT_FIELDS, ...(this.overrides.fields ?? {}) },
      confidence_scores: { ...DEFAULT_CONFIDENCE, ...(this.overrides.confidence_scores ?? {}) },
      accessorials: this.overrides.accessorials ?? [
        {
          tipo:       'FUEL_SURCHARGE',
          descricao:  'Fuel surcharge 25%',
          valor:      500.00,
          confidence: 0.97,
          pagina:     1,
          posicao:    { x: 100, y: 450, width: 300, height: 20 },
        },
      ],
      extraction_raw: this.overrides.extraction_raw ?? {
        provider: 'stub',
        raw_text: '[stub extraction — no real PDF parsed]',
      },
    };
  }
}
