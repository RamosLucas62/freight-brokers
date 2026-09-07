-- Roles make tenant authorization explicit. Existing billing owners become owners;
-- other existing members retain operational access without settings privileges.
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated;
CREATE SCHEMA IF NOT EXISTS api;
REVOKE ALL ON SCHEMA api FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA api TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.audit_stripe_webhook_queue (
 event_id text PRIMARY KEY,event_type text NOT NULL,event_created bigint NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed')),
 attempts smallint NOT NULL DEFAULT 0,claimed_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_queue ON public.audit_stripe_webhook_queue(next_attempt_at,created_at) WHERE status IN ('queued','failed');
ALTER TABLE public.audit_stripe_webhook_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_stripe_webhook_queue FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_stripe_webhook_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_stripe_webhook(p_event_id text,p_event_type text,p_event_created bigint,p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_stripe_webhook_queue(event_id,event_type,event_created,payload) VALUES(p_event_id,p_event_type,p_event_created,p_payload) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.claim_stripe_webhook() RETURNS SETOF public.audit_stripe_webhook_queue
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_stripe_webhook_queue SET status='failed',next_attempt_at=now(),last_error='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes';
 RETURN QUERY UPDATE public.audit_stripe_webhook_queue SET status='processing',attempts=attempts+1,claimed_at=now(),last_error=NULL
 WHERE event_id=(SELECT event_id FROM public.audit_stripe_webhook_queue WHERE status IN ('queued','failed') AND next_attempt_at<=now() AND attempts<12 ORDER BY event_created,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END;
$$;
CREATE OR REPLACE FUNCTION public.finish_stripe_webhook(p_event_id text,p_success boolean,p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_stripe_webhook_queue SET status=CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
  completed_at=CASE WHEN p_success THEN now() ELSE NULL END,last_error=CASE WHEN p_success THEN NULL ELSE left(p_error,200) END,
  next_attempt_at=CASE WHEN p_success THEN next_attempt_at ELSE now()+least(interval '6 hours',interval '1 minute'*power(2,greatest(attempts-1,0))) END
 WHERE event_id=p_event_id AND status='processing';
$$;
REVOKE ALL ON FUNCTION public.enqueue_stripe_webhook(text,text,bigint,jsonb),public.claim_stripe_webhook(),public.finish_stripe_webhook(text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_stripe_webhook(text,text,bigint,jsonb),public.claim_stripe_webhook(),public.finish_stripe_webhook(text,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_audit_email() RETURNS SETOF public.audit_inbound_jobs
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_inbound_jobs SET status='needs_review',finished_at=now(),error_code='WORKER_INTERRUPTED'
 WHERE status='processing' AND started_at<now()-interval '15 minutes';
 RETURN QUERY UPDATE public.audit_inbound_jobs SET status='processing',started_at=now(),error_code=NULL
 WHERE id=(SELECT id FROM public.audit_inbound_jobs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.claim_audit_notification() RETURNS SETOF public.audit_notification_deliveries
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_notification_deliveries SET status='failed',last_error='WORKER_INTERRUPTED',next_attempt_at=now()
 WHERE status='sending' AND claimed_at<now()-interval '15 minutes';
 RETURN QUERY UPDATE public.audit_notification_deliveries SET status='sending',attempts=attempts+1,last_error=NULL,claimed_at=now()
 WHERE id=(SELECT id FROM public.audit_notification_deliveries WHERE status IN ('queued','failed') AND next_attempt_at<=now() AND attempts<5 ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END $$;
ALTER TABLE public.audit_memberships ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'operator';
ALTER TABLE public.audit_memberships DROP CONSTRAINT IF EXISTS audit_memberships_role_check;
ALTER TABLE public.audit_memberships ADD CONSTRAINT audit_memberships_role_check CHECK(role IN ('owner','billing_admin','operator','viewer'));
UPDATE public.audit_memberships m SET role='owner'
FROM public.audit_billing_customers b,auth.users u
WHERE b.tenant_id=m.tenant_id AND u.id=m.user_id AND lower(u.email)=b.billing_email;

ALTER TABLE public.audit_report_contacts
 ADD COLUMN IF NOT EXISTS verification_token_hash text,
 ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id),
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_contact_verification_hash ON public.audit_report_contacts(verification_token_hash) WHERE verification_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.audit_inbound_sender_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 sender_email text NOT NULL CHECK(sender_email=lower(trim(sender_email))),enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,sender_email)
);
ALTER TABLE public.audit_inbound_sender_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_inbound_sender_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_inbound_sender_rules TO service_role;
GRANT SELECT ON public.audit_inbound_sender_rules TO authenticated;
CREATE POLICY audit_member_read ON public.audit_inbound_sender_rules FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_inbound_sender_rules AS RESTRICTIVE FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

GRANT SELECT ON public.audit_billing_customers TO authenticated;
CREATE POLICY audit_member_read ON public.audit_billing_customers FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_billing_customers AS RESTRICTIVE FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

CREATE TABLE IF NOT EXISTS public.audit_security_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid REFERENCES public.audit_tenants(id),actor_user_id uuid REFERENCES auth.users(id),
 action text NOT NULL,target_email text,ip_fingerprint text,details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_security_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_security_activity FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_security_activity TO service_role;

CREATE OR REPLACE FUNCTION public.portal_save_notification_settings_v2(
 p_user uuid,p_tenant uuid,p_timezone text,p_contacts jsonb,p_ip_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE member_role text; item jsonb; normalized text; changed text[]:=ARRAY[]::text[];
BEGIN
 SELECT role INTO member_role FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF member_role NOT IN ('owner','billing_admin') THEN RAISE EXCEPTION 'Settings administrator required'; END IF;
 IF NOT public.audit_valid_timezone(p_timezone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 IF jsonb_typeof(p_contacts)<>'array' OR jsonb_array_length(p_contacts)<1 OR jsonb_array_length(p_contacts)>20 THEN RAISE EXCEPTION 'One to twenty contacts required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_contacts) x WHERE lower(trim(x->>'email')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR coalesce(x->>'token_hash','') !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid contact'; END IF;
 INSERT INTO public.audit_notification_settings(tenant_id,timezone) VALUES(p_tenant,p_timezone)
 ON CONFLICT(tenant_id) DO UPDATE SET timezone=excluded.timezone,updated_at=now();
 UPDATE public.audit_report_contacts SET enabled=false,updated_at=now() WHERE tenant_id=p_tenant AND email NOT IN (SELECT lower(trim(x->>'email')) FROM jsonb_array_elements(p_contacts) x) AND enabled;
 FOR item IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
  normalized:=lower(trim(item->>'email'));
  INSERT INTO public.audit_report_contacts(tenant_id,email,enabled,verification_token_hash,verification_expires_at,requested_by,updated_at)
  VALUES(p_tenant,normalized,true,item->>'token_hash',now()+interval '30 minutes',p_user,now())
  ON CONFLICT(tenant_id,email) DO UPDATE SET enabled=true,
   verification_token_hash=CASE WHEN public.audit_report_contacts.verified_at IS NULL THEN excluded.verification_token_hash ELSE NULL END,
   verification_expires_at=CASE WHEN public.audit_report_contacts.verified_at IS NULL THEN excluded.verification_expires_at ELSE NULL END,
   requested_by=excluded.requested_by,updated_at=now();
  IF (SELECT verified_at IS NULL FROM public.audit_report_contacts WHERE tenant_id=p_tenant AND email=normalized) THEN changed:=array_append(changed,normalized); END IF;
 END LOOP;
 INSERT INTO public.audit_security_activity(tenant_id,actor_user_id,action,ip_fingerprint,details)
 VALUES(p_tenant,p_user,'notification_recipients_changed',left(p_ip_fingerprint,64),jsonb_build_object('pending_verification',changed));
 RETURN jsonb_build_object('pending_verification',changed);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_report_contact(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE contact public.audit_report_contacts%ROWTYPE;
BEGIN
 SELECT * INTO contact FROM public.audit_report_contacts WHERE verification_token_hash=p_token_hash AND enabled AND verified_at IS NULL AND verification_expires_at>now() FOR UPDATE;
 IF contact.id IS NULL THEN RAISE EXCEPTION 'Invalid or expired confirmation'; END IF;
 UPDATE public.audit_report_contacts SET verified_at=now(),verification_token_hash=NULL,verification_expires_at=NULL,updated_at=now() WHERE id=contact.id;
 INSERT INTO public.audit_security_activity(tenant_id,action,target_email,details) VALUES(contact.tenant_id,'report_contact_verified',contact.email,jsonb_build_object('contact_id',contact.id));
 RETURN jsonb_build_object('confirmed',true,'email',contact.email);
END $$;

REVOKE ALL ON FUNCTION public.portal_save_notification_settings_v2(uuid,uuid,text,jsonb,text),public.confirm_report_contact(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_save_notification_settings_v2(uuid,uuid,text,jsonb,text),public.confirm_report_contact(text) TO service_role;

-- New accounts always start with their authenticated billing identity as owner.
CREATE OR REPLACE FUNCTION public.secure_onboarding_owner(p_tenant uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_billing_customers b JOIN auth.users u ON lower(u.email)=b.billing_email WHERE b.tenant_id=p_tenant AND u.id=p_user) THEN RAISE EXCEPTION 'Billing identity mismatch'; END IF;
 UPDATE public.audit_memberships SET role='owner' WHERE tenant_id=p_tenant AND user_id=p_user;
 INSERT INTO public.audit_inbound_sender_rules(tenant_id,sender_email)
 SELECT p_tenant,lower(email) FROM auth.users WHERE id=p_user ON CONFLICT(tenant_id,sender_email) DO UPDATE SET enabled=true;
END $$;
REVOKE ALL ON FUNCTION public.secure_onboarding_owner(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_onboarding_owner(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_inbound_processing(p_tenant uuid,p_sender text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE allowed boolean; daily_count integer;
BEGIN
 SELECT EXISTS(SELECT 1 FROM public.audit_inbound_sender_rules WHERE tenant_id=p_tenant AND sender_email=lower(trim(p_sender)) AND enabled) INTO allowed;
 IF NOT allowed THEN
  INSERT INTO public.audit_security_activity(tenant_id,action,target_email,details) VALUES(p_tenant,'inbound_sender_rejected',left(lower(trim(p_sender)),254),'{}');
  RETURN false;
 END IF;
 SELECT count(*) INTO daily_count FROM public.audit_inbound_jobs WHERE tenant_id=p_tenant AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF daily_count>100 THEN
  INSERT INTO public.audit_security_activity(tenant_id,action,target_email,details) VALUES(p_tenant,'inbound_quota_exceeded',left(lower(trim(p_sender)),254),jsonb_build_object('daily_jobs',daily_count));
  RETURN false;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_inbound_processing(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_inbound_processing(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_save_inbound_senders(p_user uuid,p_tenant uuid,p_senders text[],p_ip_fingerprint text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE member_role text; sender text;
BEGIN
 SELECT role INTO member_role FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF member_role NOT IN ('owner','billing_admin') THEN RAISE EXCEPTION 'Settings administrator required'; END IF;
 IF coalesce(array_length(p_senders,1),0)<1 OR array_length(p_senders,1)>50 OR EXISTS(SELECT 1 FROM unnest(p_senders) value WHERE lower(trim(value)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'Invalid senders'; END IF;
 UPDATE public.audit_inbound_sender_rules SET enabled=false WHERE tenant_id=p_tenant;
 FOREACH sender IN ARRAY p_senders LOOP
  INSERT INTO public.audit_inbound_sender_rules(tenant_id,sender_email,enabled) VALUES(p_tenant,lower(trim(sender)),true)
  ON CONFLICT(tenant_id,sender_email) DO UPDATE SET enabled=true;
 END LOOP;
 INSERT INTO public.audit_security_activity(tenant_id,actor_user_id,action,ip_fingerprint,details)
 VALUES(p_tenant,p_user,'inbound_senders_changed',left(p_ip_fingerprint,64),jsonb_build_object('count',array_length(p_senders,1)));
END $$;
REVOKE ALL ON FUNCTION public.portal_save_inbound_senders(uuid,uuid,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_save_inbound_senders(uuid,uuid,text[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_save_security_settings(
 p_tenant uuid,p_timezone text,p_contacts jsonb,p_senders text[],p_ip_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'AAL2 required'; END IF;
 result:=public.portal_save_notification_settings_v2(actor,p_tenant,p_timezone,p_contacts,p_ip_fingerprint);
 PERFORM public.portal_save_inbound_senders(actor,p_tenant,p_senders,p_ip_fingerprint);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.portal_record_billing_action_secure(p_tenant uuid,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'AAL2 required'; END IF;
 PERFORM public.portal_record_billing_action(auth.uid(),p_tenant,p_action);
END $$;
REVOKE ALL ON FUNCTION public.portal_save_security_settings(uuid,text,jsonb,text[],text),public.portal_record_billing_action_secure(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_save_security_settings(uuid,text,jsonb,text[],text),public.portal_record_billing_action_secure(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_tenant_data_deletion(p_job uuid,p_deleted_counts jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE tenant uuid; deleted_alias text;
BEGIN
 SELECT tenant_id INTO tenant FROM public.audit_data_deletions WHERE id=p_job AND status='deleting' FOR UPDATE;
 IF tenant IS NULL THEN RAISE EXCEPTION 'Deletion job not claimed'; END IF;
 DELETE FROM public.audit_notification_deliveries WHERE tenant_id=tenant;
 DELETE FROM public.audit_notification_settings WHERE tenant_id=tenant;
 DELETE FROM public.audit_report_contacts WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_sender_rules WHERE tenant_id=tenant;
 DELETE FROM public.audit_job_reviews WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_attachments WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_jobs WHERE tenant_id=tenant;
 DELETE FROM public.audit_runs WHERE tenant_id=tenant;
 DELETE FROM public.exceptions WHERE tenant_id=tenant;
 DELETE FROM public.invoices WHERE tenant_id=tenant;
 DELETE FROM public.audit_memberships WHERE tenant_id=tenant;
 UPDATE public.audit_billing_actions SET user_id=NULL WHERE tenant_id=tenant;
 UPDATE public.audit_admin_activity SET tenant_id=NULL,target_user_id=NULL,company_name='Deleted account',target_email=NULL,details='{"redacted":true}'::jsonb WHERE tenant_id=tenant;
 UPDATE public.audit_security_activity SET actor_user_id=NULL,target_email=NULL,ip_fingerprint=NULL,details='{"redacted":true}'::jsonb WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_events e WHERE NOT EXISTS (SELECT 1 FROM public.audit_inbound_jobs j WHERE j.email_id=e.email_id);
 deleted_alias:='deleted-'||replace(tenant::text,'-','');
 UPDATE public.audit_tenants SET name='Deleted account',alias=deleted_alias,status='inactive' WHERE id=tenant;
 UPDATE public.audit_billing_customers SET billing_email='deleted+'||replace(tenant::text,'-','')||'@invalid.local',stripe_checkout_session_id=NULL,deletion_completed_at=now(),updated_at=now() WHERE tenant_id=tenant;
 UPDATE public.audit_data_deletions SET status='completed',deleted_counts=p_deleted_counts,completed_at=now() WHERE id=p_job;
END $$;
