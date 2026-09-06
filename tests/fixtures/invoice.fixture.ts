import type { InvoiceRecord } from '../../src/types/invoice.types.js';
import type { InvoiceExtractionResult } from '../../src/types/invoice.types.js';
import { v4 as uuidv4 } from 'uuid';

export function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id:               uuidv4(),
    source_file:      'invoices/sample.pdf',
    numero_fatura:    'INV-2024-001',
    numero_carga:     'LOAD-9876',
    carrier_name:     'SWIFT TRANSPORT LLC',
    mc_number:        '123456',
    dot_number:       '9876543',
    data_carga:       '2024-01-15',
    data_fatura:      '2024-01-20',
    valor_total:      2500.00,
    origem:           'Chicago, IL',
    destino:          'Dallas, TX',
    dados_bancarios:  {
      bank_name:      'First National Bank',
      account_number: '123456789',
      routing_number: '021000021',
      account_type:   'checking',
      payee_name:     'SWIFT TRANSPORT LLC',
    },
    accessorials: [
      {
        tipo:       'FUEL_SURCHARGE',
        descricao:  'Fuel surcharge 25%',
        valor:      500.00,
        confidence: 0.97,
        pagina:     1,
        posicao:    { x: 100, y: 450, width: 300, height: 20 },
      },
    ],
    confidence_scores: {
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
    },
    extraction_raw: { provider: 'stub' },
    created_at:     new Date().toISOString(),
    ...overrides,
  };
}

export function makeExtractionResult(overrides: Partial<InvoiceExtractionResult> = {}): InvoiceExtractionResult {
  return {
    source_file: 'invoices/sample.pdf',
    fields: {
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
    },
    confidence_scores: {
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
    },
    accessorials: [
      {
        tipo:       'FUEL_SURCHARGE',
        descricao:  'Fuel surcharge 25%',
        valor:      500.00,
        confidence: 0.97,
        pagina:     1,
        posicao:    { x: 100, y: 450, width: 300, height: 20 },
      },
    ],
    extraction_raw: { provider: 'stub' },
    ...overrides,
  };
}
