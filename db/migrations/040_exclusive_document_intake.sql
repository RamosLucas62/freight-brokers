-- Derive the intake channel from active connections; transient sync failures do
-- not silently reopen email. Pending/unavailable connections never close it.
CREATE FUNCTION public.email_intake_enabled(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.audit_tms_connections
 WHERE tenant_id=p_tenant AND status='verified' AND sync_enabled);
$$;
REVOKE ALL ON FUNCTION public.email_intake_enabled(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_intake_enabled(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_audit_email(p_event_id text,p_email_id uuid,p_aliases text[])
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.audit_inbound_events(event_id,email_id) VALUES(p_event_id,p_email_id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO public.audit_inbound_jobs(tenant_id,email_id,status,error_code)
 SELECT id,p_email_id,CASE WHEN status='active' AND public.email_intake_enabled(id) THEN 'queued' ELSE 'blocked' END,
 CASE WHEN status<>'active' THEN 'ACCOUNT_NOT_ACTIVE' WHEN NOT public.email_intake_enabled(id) THEN 'EMAIL_INTAKE_DISABLED_TMS' ELSE NULL END
 FROM public.audit_tenants WHERE alias=ANY(p_aliases)
 ON CONFLICT (tenant_id,email_id) DO NOTHING;
 SELECT count(*) INTO n FROM public.audit_tenants WHERE alias=ANY(p_aliases);
 UPDATE public.audit_inbound_events SET matched_accounts=n WHERE event_id=p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_inbound_processing(p_tenant uuid,p_sender text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE allowed boolean; daily_count integer;
BEGIN
 IF NOT public.email_intake_enabled(p_tenant) THEN RETURN false; END IF;
 SELECT EXISTS(SELECT 1 FROM public.audit_inbound_sender_rules WHERE tenant_id=p_tenant AND sender_email=lower(trim(p_sender)) AND enabled) INTO allowed;
 IF NOT allowed THEN
  INSERT INTO public.audit_security_activity(tenant_id,action,target_email,details) VALUES(p_tenant,'inbound_sender_rejected',left(lower(trim(p_sender)),254),'{}');
  RETURN false;
 END IF;
 SELECT count(*) INTO daily_count FROM public.audit_inbound_jobs WHERE tenant_id=p_tenant AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND error_code IS DISTINCT FROM 'EMAIL_INTAKE_DISABLED_TMS';
 IF daily_count>100 THEN
  INSERT INTO public.audit_security_activity(tenant_id,action,target_email,details) VALUES(p_tenant,'inbound_quota_exceeded',left(lower(trim(p_sender)),254),jsonb_build_object('daily_jobs',daily_count));
  RETURN false;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_inbound_processing(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_inbound_processing(uuid,text) TO service_role;


CREATE OR REPLACE FUNCTION public.enqueue_tms_documents(p_tenant uuid,p_provider text,p_version uuid,p_claim uuid,p_batch uuid,p_record text,p_documents jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.audit_tms_connections c JOIN public.audit_tenants t ON t.id=c.tenant_id
 WHERE c.tenant_id=p_tenant AND c.provider=p_provider AND c.connection_version=p_version AND c.sync_claim=p_claim
 AND c.sync_enabled AND c.status='verified' AND t.status='active' FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'TMS_CONNECTION_CHANGED'; END IF;
 IF jsonb_typeof(p_documents)<>'array' OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 100 OR length(p_record)>200
 THEN RAISE EXCEPTION 'TMS_INVALID_DOCUMENT_BATCH'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_inbound_jobs WHERE tenant_id=p_tenant AND email_id=p_batch) THEN
  UPDATE public.audit_inbound_jobs SET tms_connection_version=p_version,status='queued',error_code=NULL,next_attempt_at=now()
  WHERE tenant_id=p_tenant AND email_id=p_batch AND source='tms' AND tms_connection_version<>p_version
  AND (status='queued' OR (status='blocked' AND error_code='TMS_CONNECTION_INACTIVE'));
  RETURN false;
 END IF;
 IF (SELECT count(*) FROM public.audit_inbound_jobs WHERE tenant_id=p_tenant AND created_at>=date_trunc('day',now()) AND error_code IS DISTINCT FROM 'EMAIL_INTAKE_DISABLED_TMS')>=100
 THEN RAISE EXCEPTION 'TMS_DAILY_QUOTA'; END IF;
 INSERT INTO public.audit_inbound_jobs(tenant_id,email_id,source,tms_provider,tms_connection_version,tms_record_id,tms_documents)
 VALUES(p_tenant,p_batch,'tms',p_provider,p_version,p_record,p_documents);
 UPDATE public.audit_tms_connections SET imported_batches=imported_batches+1 WHERE tenant_id=p_tenant AND provider=p_provider;
 RETURN true;
END $$;
