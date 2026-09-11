-- invoices
CREATE TABLE IF NOT EXISTS invoices (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file       TEXT          NOT NULL,
  numero_fatura     TEXT          NOT NULL,
  numero_carga      TEXT,
  carrier_name      TEXT,
  mc_number         TEXT,
  dot_number        TEXT,
  data_carga        DATE,
  data_fatura       DATE,
  valor_total       NUMERIC(15,2),
  origem            TEXT,
  destino           TEXT,
  dados_bancarios   JSONB,
  accessorials      JSONB         DEFAULT '[]'::JSONB,
  confidence_scores JSONB         DEFAULT '{}'::JSONB,
  verification      JSONB         DEFAULT '{}'::JSONB,
  extraction_raw    JSONB,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_numero_fatura       ON invoices (numero_fatura);
CREATE INDEX IF NOT EXISTS idx_invoices_mc_number           ON invoices (mc_number);
CREATE INDEX IF NOT EXISTS idx_invoices_carrier_name        ON invoices (carrier_name);
CREATE INDEX IF NOT EXISTS idx_invoices_data_fatura         ON invoices (data_fatura);
CREATE INDEX IF NOT EXISTS idx_invoices_valor_total         ON invoices (valor_total);
CREATE INDEX IF NOT EXISTS idx_invoices_dados_bancarios_gin ON invoices USING GIN (dados_bancarios);

-- exceptions
CREATE TABLE IF NOT EXISTS exceptions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tipo_regra      TEXT          NOT NULL,
  valor_envolvido NUMERIC(15,2),
  descricao       TEXT          NOT NULL,
  source_file     TEXT          NOT NULL,
  source_page     INT,
  metadata        JSONB         DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exceptions_invoice_id ON exceptions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_tipo_regra ON exceptions (tipo_regra);

-- carrier_lookups (cache ao vivo da FMCSA)
CREATE TABLE IF NOT EXISTS carrier_lookups (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dot_number        TEXT,
  mc_number         TEXT,
  legal_name        TEXT,
  authority_status  TEXT        NOT NULL CHECK (authority_status IN ('ACTIVE','INACTIVE','REVOKED','UNVERIFIABLE')),
  verification_reason TEXT CHECK (verification_reason IS NULL OR verification_reason IN ('NO_UNIQUE_CARRIER','INVALID_RESPONSE','IDENTIFIER_MISMATCH','AUTHORITY_UNAVAILABLE')),
  broker_authority  BOOLEAN     NOT NULL DEFAULT false,
  carrier_authority BOOLEAN     NOT NULL DEFAULT false,
  raw_response      JSONB,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT carrier_lookups_has_identifier CHECK (dot_number IS NOT NULL OR mc_number IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_carrier_lookups_mc_checked  ON carrier_lookups (mc_number, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_carrier_lookups_dot_checked ON carrier_lookups (dot_number, checked_at DESC);
