ALTER TABLE public.audit_tms_connections ADD COLUMN intake_validated_at timestamptz;
ALTER TABLE public.audit_inbound_jobs ADD COLUMN evidence_issues jsonb;
-- A credential test is not a document-delivery test. Keep email usable until an
-- actual TMS job has committed an audit with validated basic freight evidence.
CREATE OR REPLACE FUNCTION public.email_intake_enabled(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.audit_tms_connections
 WHERE tenant_id=p_tenant AND status='verified' AND sync_enabled AND intake_validated_at IS NOT NULL);
$$;
CREATE FUNCTION public.reset_tms_intake_validation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.connection_version IS DISTINCT FROM OLD.connection_version OR NEW.credentials_ciphertext IS DISTINCT FROM OLD.credentials_ciphertext THEN NEW.intake_validated_at=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reset_tms_intake_validation BEFORE UPDATE ON public.audit_tms_connections
FOR EACH ROW EXECUTE FUNCTION public.reset_tms_intake_validation();
CREATE FUNCTION public.validate_tms_document_intake(p_job uuid) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_tms_connections c SET intake_validated_at=coalesce(c.intake_validated_at,now())
 FROM public.audit_inbound_jobs j JOIN public.audit_runs r ON r.run_id=j.id AND r.tenant_id=j.tenant_id
 WHERE j.id=p_job AND j.source='tms' AND j.status='completed'
 AND r.report->'document_coverage'->>'scope'='basic_freight_evidence'
 AND (r.report->'document_coverage'->>'validated_invoices')::integer>0
 AND c.tenant_id=j.tenant_id AND c.provider=j.tms_provider AND c.connection_version=j.tms_connection_version
 AND c.status='verified' AND c.sync_enabled;
$$;
REVOKE ALL ON FUNCTION public.reset_tms_intake_validation(),public.validate_tms_document_intake(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tms_document_intake(uuid) TO service_role;
