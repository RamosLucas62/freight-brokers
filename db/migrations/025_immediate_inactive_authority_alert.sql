-- Inactive carrier authority is a confirmed operational risk and must not wait
-- for the next daily digest. Unverifiable identifiers remain immediate as well.
CREATE OR REPLACE FUNCTION public.enqueue_carrier_verification_alert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.tipo_regra IN ('CARRIER_VERIFICATION_REQUIRED','AUTHORITY_INACTIVE') THEN
  INSERT INTO public.audit_notification_deliveries(tenant_id,kind,period_key,period_start,period_end,exception_id)
  SELECT NEW.tenant_id,'immediate','exception:'||NEW.id::text,NEW.created_at,NEW.created_at,NEW.id
  FROM public.audit_notification_settings s JOIN public.audit_tenants t ON t.id=s.tenant_id
  WHERE s.tenant_id=NEW.tenant_id AND s.immediate_enabled AND t.status='active'
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_carrier_verification_alert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_carrier_verification_alert() TO service_role;
