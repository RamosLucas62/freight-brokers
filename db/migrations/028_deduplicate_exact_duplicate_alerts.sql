-- One duplicate group is one customer incident, even though the audit keeps an
-- exception on every affected invoice for traceability.
CREATE OR REPLACE FUNCTION public.normalize_immediate_duplicate_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  exception_type text;
  exception_metadata jsonb;
  group_key text;
BEGIN
  IF NEW.kind <> 'immediate' OR NEW.exception_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tipo_regra,metadata
  INTO exception_type,exception_metadata
  FROM public.exceptions
  WHERE tenant_id=NEW.tenant_id AND id=NEW.exception_id;

  IF exception_type='DUPLICATE_EXACT' THEN
    group_key=coalesce(
      exception_metadata->>'duplicate_group_key',
      coalesce(exception_metadata->>'numero_fatura','')||':'||coalesce(exception_metadata->>'duplicate_ids','')
    );
    NEW.period_key='duplicate_exact:'||md5(NEW.tenant_id::text||':'||group_key);
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS normalize_immediate_duplicate_delivery ON public.audit_notification_deliveries;
CREATE TRIGGER normalize_immediate_duplicate_delivery
BEFORE INSERT ON public.audit_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.normalize_immediate_duplicate_delivery();

REVOKE ALL ON FUNCTION public.normalize_immediate_duplicate_delivery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_immediate_duplicate_delivery() TO service_role;
