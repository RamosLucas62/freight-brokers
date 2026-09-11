ALTER TABLE public.audit_inbound_jobs
 ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

UPDATE public.audit_inbound_jobs SET claimed_at=coalesce(claimed_at,started_at,created_at)
 WHERE status='processing';

DROP INDEX IF EXISTS public.idx_inbound_queue;
CREATE INDEX idx_inbound_queue ON public.audit_inbound_jobs(next_attempt_at,created_at)
 WHERE status='queued';

CREATE OR REPLACE FUNCTION public.claim_audit_email()
RETURNS SETOF public.audit_inbound_jobs LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_inbound_jobs
 SET status='needs_review',finished_at=now(),error_code='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '20 minutes' AND attempts>=4;

 UPDATE public.audit_inbound_jobs
 SET status='queued',started_at=NULL,claimed_at=NULL,next_attempt_at=now(),error_code='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '20 minutes' AND attempts<4;

 RETURN QUERY
 UPDATE public.audit_inbound_jobs SET status='processing',started_at=now(),claimed_at=now(),finished_at=NULL,
  attempts=attempts+1,error_code=NULL
 WHERE id=(SELECT id FROM public.audit_inbound_jobs
  WHERE status='queued' AND next_attempt_at<=now() AND attempts<4
  ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_audit_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audit_email() TO service_role;

CREATE OR REPLACE FUNCTION public.portal_job_action(p_user uuid,p_tenant uuid,p_job uuid,p_action text,p_note text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_status text; account_status text; is_admin boolean; email text;
BEGIN
 SELECT EXISTS(SELECT 1 FROM public.audit_admins WHERE user_id=p_user) INTO is_admin;
 IF EXISTS(SELECT 1 FROM public.audit_portal_users WHERE user_id=p_user AND NOT enabled) THEN RAISE EXCEPTION 'Portal access disabled'; END IF;
 IF NOT is_admin AND NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Membership required'; END IF;
 SELECT status INTO account_status FROM public.audit_tenants WHERE id=p_tenant FOR UPDATE;
 SELECT status INTO current_status FROM public.audit_inbound_jobs WHERE id=p_job AND tenant_id=p_tenant FOR UPDATE;
 IF current_status IS NULL OR current_status NOT IN ('needs_review','blocked','completed','ignored') THEN RAISE EXCEPTION 'Job cannot be changed'; END IF;
 IF p_action='retry' THEN
  IF account_status<>'active' OR current_status NOT IN ('needs_review','blocked') THEN RAISE EXCEPTION 'Retry not allowed'; END IF;
  UPDATE public.audit_inbound_jobs SET status='queued',error_code=NULL,started_at=NULL,claimed_at=NULL,finished_at=NULL,
   attempts=0,next_attempt_at=now() WHERE id=p_job AND tenant_id=p_tenant;
 ELSIF p_action<>'review' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=p_user;
 INSERT INTO public.audit_job_reviews(tenant_id,job_id,user_id,action,note,actor_email,actor_role)
 VALUES(p_tenant,p_job,p_user,p_action,p_note,email,CASE WHEN is_admin THEN 'admin' ELSE 'customer' END);
 IF is_admin THEN INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,tenant_id,company_name,details)
 VALUES(p_user,email,'job.'||p_action,p_tenant,(SELECT name FROM public.audit_tenants WHERE id=p_tenant),jsonb_build_object('job_id',p_job,'note',p_note)); END IF;
END $$;
REVOKE ALL ON FUNCTION public.portal_job_action(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_job_action(uuid,uuid,uuid,text,text) TO service_role;

ALTER TABLE public.carrier_lookups
 DROP CONSTRAINT IF EXISTS carrier_lookups_authority_status_check;
ALTER TABLE public.carrier_lookups
 ADD CONSTRAINT carrier_lookups_authority_status_check
 CHECK(authority_status IN ('ACTIVE','INACTIVE','REVOKED','UNVERIFIABLE')),
 ADD COLUMN IF NOT EXISTS verification_reason text
 CHECK(verification_reason IS NULL OR verification_reason IN ('NO_UNIQUE_CARRIER','INVALID_RESPONSE','IDENTIFIER_MISMATCH','AUTHORITY_UNAVAILABLE'));

CREATE OR REPLACE FUNCTION public.enqueue_carrier_verification_alert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.tipo_regra='CARRIER_VERIFICATION_REQUIRED' THEN
  INSERT INTO public.audit_notification_deliveries(tenant_id,kind,period_key,period_start,period_end,exception_id)
  SELECT NEW.tenant_id,'immediate','exception:'||NEW.id::text,NEW.created_at,NEW.created_at,NEW.id
  FROM public.audit_notification_settings s JOIN public.audit_tenants t ON t.id=s.tenant_id
  WHERE s.tenant_id=NEW.tenant_id AND s.immediate_enabled AND t.status='active'
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enqueue_carrier_verification_alert ON public.exceptions;
CREATE TRIGGER enqueue_carrier_verification_alert AFTER INSERT ON public.exceptions
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_carrier_verification_alert();

REVOKE ALL ON FUNCTION public.enqueue_carrier_verification_alert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_carrier_verification_alert() TO service_role;
