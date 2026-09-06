ALTER TABLE public.carrier_lookups ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS document_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_document_hash ON public.invoices(document_hash);
CREATE TABLE IF NOT EXISTS public.audit_runs (
  run_id UUID PRIMARY KEY,
  report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.commit_audit(p_invoices JSONB, p_exceptions JSONB, p_report JSONB, p_history_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE current_ids UUID[];
BEGIN
  -- Serialize audit writes and reject results calculated against stale history.
  LOCK TABLE public.invoices IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]) INTO current_ids FROM public.invoices;
  IF current_ids IS DISTINCT FROM ARRAY(SELECT unnest(p_history_ids) ORDER BY 1) THEN
    RAISE EXCEPTION 'Invoice history changed during this audit. Retry the batch.';
  END IF;
  INSERT INTO public.invoices SELECT * FROM jsonb_populate_recordset(NULL::public.invoices, p_invoices);
  INSERT INTO public.exceptions(invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,metadata)
    SELECT invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,metadata
    FROM jsonb_populate_recordset(NULL::public.exceptions, p_exceptions);
  INSERT INTO public.audit_runs(run_id,report) VALUES ((p_report->>'run_id')::UUID,p_report);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_audit(JSONB,JSONB,JSONB,UUID[]) FROM PUBLIC;
-- Supabase backend access only; no anonymous access to invoice/banking data.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON public.invoices,public.exceptions,public.carrier_lookups,public.audit_runs TO service_role;
    GRANT EXECUTE ON FUNCTION public.commit_audit(JSONB,JSONB,JSONB,UUID[]) TO service_role;
  END IF;
END $$;
