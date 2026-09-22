-- Durable polling and source-tagged audit jobs. Existing verified credentials
-- stay paused until the owner explicitly enables automatic import.
ALTER TABLE public.audit_tms_connections
 ADD COLUMN sync_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN connection_version uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN next_sync_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN sync_claim uuid,
 ADD COLUMN last_synced_at timestamptz,
 ADD COLUMN sync_error text,
 ADD COLUMN imported_batches integer NOT NULL DEFAULT 0;
-- Replace the original provider-specific verification constraint.
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='public.audit_tms_connections'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%credentials_ciphertext%';
 EXECUTE format('ALTER TABLE public.audit_tms_connections DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE public.audit_tms_connections DROP CONSTRAINT audit_tms_connections_provider_check;
ALTER TABLE public.audit_tms_connections ADD CHECK(provider IN ('rose-rocket','tai','mcleod','turvo','aljex','ascendtms','mercurygate'));
ALTER TABLE public.audit_tms_connections ADD CHECK (
 (status='verified' AND provider IN ('rose-rocket','tai','mcleod') AND credentials_ciphertext IS NOT NULL AND verified_at IS NOT NULL)
 OR (status<>'verified' AND credentials_ciphertext IS NULL AND verified_at IS NULL));
ALTER TABLE public.audit_inbound_jobs
 ADD COLUMN source text NOT NULL DEFAULT 'email' CHECK(source IN ('email','tms')),
 ADD COLUMN tms_provider text,
 ADD COLUMN tms_connection_version uuid,
 ADD COLUMN tms_record_id text,
 ADD COLUMN tms_documents jsonb,
 ADD CHECK(source='email' OR (tms_provider IS NOT NULL AND tms_documents IS NOT NULL AND tms_provider IN ('rose-rocket','tai','mcleod') AND tms_connection_version IS NOT NULL AND tms_record_id IS NOT NULL AND jsonb_typeof(tms_documents)='array'));

CREATE FUNCTION public.claim_tms_sync() RETURNS SETOF public.audit_tms_connections
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_tms_connections c SET sync_claim=gen_random_uuid(),next_sync_at=now()+interval '15 minutes'
 WHERE (c.tenant_id,c.provider)=(SELECT q.tenant_id,q.provider FROM public.audit_tms_connections q
 JOIN public.audit_tenants t ON t.id=q.tenant_id
 WHERE q.sync_enabled AND q.status='verified' AND t.status='active' AND q.next_sync_at<=now()
 ORDER BY q.next_sync_at FOR UPDATE OF q SKIP LOCKED LIMIT 1) RETURNING c.*;
$$;
CREATE FUNCTION public.enqueue_tms_documents(p_tenant uuid,p_provider text,p_version uuid,p_claim uuid,p_batch uuid,p_record text,p_documents jsonb)
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
 IF (SELECT count(*) FROM public.audit_inbound_jobs WHERE tenant_id=p_tenant AND created_at>=date_trunc('day',now()))>=100
 THEN RAISE EXCEPTION 'TMS_DAILY_QUOTA'; END IF;
 INSERT INTO public.audit_inbound_jobs(tenant_id,email_id,source,tms_provider,tms_connection_version,tms_record_id,tms_documents)
 VALUES(p_tenant,p_batch,'tms',p_provider,p_version,p_record,p_documents);
 UPDATE public.audit_tms_connections SET imported_batches=imported_batches+1 WHERE tenant_id=p_tenant AND provider=p_provider;
 RETURN true;
END $$;
CREATE FUNCTION public.finish_tms_sync(p_tenant uuid,p_provider text,p_version uuid,p_claim uuid,p_error text)
RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_tms_connections SET sync_claim=NULL,next_sync_at=now()+interval '5 minutes',sync_error=p_error,
 last_synced_at=CASE WHEN p_error IS NULL THEN now() ELSE last_synced_at END
 WHERE tenant_id=p_tenant AND provider=p_provider AND connection_version=p_version AND sync_claim=p_claim AND sync_enabled;
$$;
REVOKE ALL ON FUNCTION public.claim_tms_sync(),public.enqueue_tms_documents(uuid,text,uuid,uuid,uuid,text,jsonb),public.finish_tms_sync(uuid,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tms_sync(),public.enqueue_tms_documents(uuid,text,uuid,uuid,uuid,text,jsonb),public.finish_tms_sync(uuid,text,uuid,uuid,text) TO service_role;

-- Repeated status events should not crowd out previously seen orders during polling.
CREATE INDEX IF NOT EXISTS idx_rose_document_orders ON public.audit_rose_events(org_id,order_id);
CREATE VIEW public.audit_rose_document_orders AS SELECT DISTINCT org_id,order_id FROM public.audit_rose_events;
REVOKE ALL ON public.audit_rose_document_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.audit_rose_document_orders TO service_role;

-- Keep the legacy webhook gate and the document worker gate consistent. A slow
-- remote webhook registration must not reactivate a disconnected/replaced account.
CREATE FUNCTION public.activate_rose_document_sync(p_tenant uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.audit_tms_connections WHERE tenant_id=p_tenant AND provider='rose-rocket'
 AND connection_version=p_version AND status='verified' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TMS_CONNECTION_CHANGED'; END IF;
 UPDATE public.audit_rose_connections SET enabled=true,connection_state='connected'
 WHERE tenant_id=p_tenant AND credentials_ciphertext IS NOT NULL AND connection_state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'TMS_CONNECTION_CHANGED'; END IF;
 UPDATE public.audit_tms_connections SET sync_enabled=true WHERE tenant_id=p_tenant AND provider='rose-rocket';
END $$;
CREATE FUNCTION public.disconnect_rose_document_sync(p_tenant uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_tms_connections SET status='disconnected',sync_enabled=false,sync_claim=NULL,
 connection_version=gen_random_uuid(),credentials_ciphertext=NULL,verified_at=NULL
 WHERE tenant_id=p_tenant AND provider='rose-rocket';
 UPDATE public.audit_rose_connections SET enabled=false,connection_state='disconnected',
 credentials_ciphertext=NULL,connected_at=NULL,connected_by=NULL WHERE tenant_id=p_tenant;
END $$;
REVOKE ALL ON FUNCTION public.activate_rose_document_sync(uuid,uuid),public.disconnect_rose_document_sync(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rose_document_sync(uuid,uuid),public.disconnect_rose_document_sync(uuid) TO service_role;
