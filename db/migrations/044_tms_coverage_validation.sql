-- A single successful audit cannot prove a collection is ready. Seal a complete
-- discovery snapshot and require every discovered load's current bundle to pass.
ALTER TABLE public.audit_tms_connections ADD COLUMN coverage_records jsonb, ADD COLUMN coverage_version uuid;
UPDATE public.audit_tms_connections SET intake_validated_at=NULL;
CREATE OR REPLACE FUNCTION public.reset_tms_intake_validation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.connection_version IS DISTINCT FROM OLD.connection_version OR NEW.credentials_ciphertext IS DISTINCT FROM OLD.credentials_ciphertext THEN
  NEW.intake_validated_at=NULL;NEW.coverage_records=NULL;NEW.coverage_version=NULL;
 END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.email_intake_enabled(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id=p_tenant AND status='verified' AND sync_enabled)
 OR EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id=p_tenant AND status='verified' AND sync_enabled AND intake_validated_at IS NULL);
$$;
CREATE FUNCTION public.refresh_tms_intake(p_tenant uuid) RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_tms_connections c SET intake_validated_at=now()
 WHERE c.tenant_id=p_tenant AND c.status='verified' AND c.sync_enabled AND c.intake_validated_at IS NULL
 AND c.coverage_version=c.connection_version AND c.sync_claim IS NULL AND c.sync_error IS NULL
 AND jsonb_array_length(c.coverage_records)>0
 AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(c.coverage_records) observed
  WHERE NOT EXISTS(
   SELECT 1 FROM public.audit_inbound_jobs j
   WHERE j.tenant_id=c.tenant_id AND j.source='tms' AND j.tms_provider=c.provider
   AND j.tms_record_id=observed->>'record' AND j.email_id=(observed->>'batch')::uuid AND j.status='completed'
   AND j.result->'document_coverage'->>'scope'='basic_freight_evidence'
   AND (j.result->'document_coverage'->>'validated_invoices')::integer>0
  )
 );
$$;
CREATE OR REPLACE FUNCTION public.validate_tms_document_intake(p_job uuid) RETURNS void LANGUAGE sql SET search_path=public AS $$
 SELECT public.refresh_tms_intake(j.tenant_id) FROM public.audit_inbound_jobs j WHERE j.id=p_job AND j.source='tms';
$$;
CREATE FUNCTION public.finish_tms_coverage(p_tenant uuid,p_provider text,p_version uuid,p_claim uuid,p_error text,p_records jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_error IS NULL AND (p_records IS NULL OR jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records)>10000) THEN RAISE EXCEPTION 'TMS_INVALID_COVERAGE'; END IF;
 IF p_error IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) r WHERE coalesce(length(r->>'record'),0) NOT BETWEEN 1 AND 200 OR (r->>'batch' IS NOT NULL AND (r->>'batch')::uuid IS NULL)) THEN RAISE EXCEPTION 'TMS_INVALID_COVERAGE'; END IF;
 UPDATE public.audit_tms_connections SET coverage_records=CASE WHEN p_error IS NULL THEN p_records ELSE NULL END,
 coverage_version=CASE WHEN p_error IS NULL THEN p_version ELSE NULL END
 WHERE tenant_id=p_tenant AND provider=p_provider AND connection_version=p_version AND sync_claim=p_claim AND sync_enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'TMS_CONNECTION_CHANGED'; END IF;
 PERFORM public.finish_tms_sync(p_tenant,p_provider,p_version,p_claim,p_error);
 PERFORM public.refresh_tms_intake(p_tenant);
END $$;
REVOKE ALL ON FUNCTION public.refresh_tms_intake(uuid),public.finish_tms_coverage(uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tms_intake(uuid),public.finish_tms_coverage(uuid,text,uuid,uuid,text,jsonb) TO service_role;
