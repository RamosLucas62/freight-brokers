ALTER TABLE public.exceptions
 ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'pending'
  CHECK (resolution_status IN ('pending','avoided','no_loss')),
 ADD COLUMN IF NOT EXISTS avoided_amount numeric CHECK (avoided_amount IS NULL OR avoided_amount >= 0),
 ADD COLUMN IF NOT EXISTS resolution_note text,
 ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
 ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_exceptions_tenant_created ON public.exceptions(tenant_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exceptions_tenant_id ON public.exceptions(tenant_id,id);
CREATE INDEX IF NOT EXISTS idx_exceptions_tenant_resolved ON public.exceptions(tenant_id,resolved_at)
 WHERE resolution_status='avoided';

CREATE TABLE IF NOT EXISTS public.audit_notification_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.audit_tenants(id),
 timezone text NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 100),
 daily_hour smallint NOT NULL DEFAULT 7 CHECK (daily_hour BETWEEN 0 AND 23),
 daily_enabled boolean NOT NULL DEFAULT true,
 monthly_enabled boolean NOT NULL DEFAULT true,
 immediate_enabled boolean NOT NULL DEFAULT true,
 immediate_threshold numeric NOT NULL DEFAULT 5000 CHECK (immediate_threshold >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_notification_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 kind text NOT NULL CHECK (kind IN ('immediate','daily','monthly')),
 period_key text NOT NULL,
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 exception_id uuid,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
 attempts smallint NOT NULL DEFAULT 0,
 claimed_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,kind,period_key),
 FOREIGN KEY (tenant_id,exception_id) REFERENCES public.exceptions(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_queue
 ON public.audit_notification_deliveries(next_attempt_at,created_at)
 WHERE status IN ('queued','failed');

ALTER TABLE public.audit_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_notification_settings,public.audit_notification_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_notification_settings,public.audit_notification_deliveries TO service_role;
GRANT SELECT ON public.audit_notification_settings,public.audit_notification_deliveries TO authenticated;
CREATE POLICY audit_member_read ON public.audit_notification_settings FOR SELECT TO authenticated
 USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_notification_settings AS RESTRICTIVE FOR SELECT TO authenticated
 USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_read ON public.audit_notification_deliveries FOR SELECT TO authenticated
 USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_notification_deliveries AS RESTRICTIVE FOR SELECT TO authenticated
 USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.audit_valid_timezone(p_timezone text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
 UPDATE public.audit_notification_deliveries SET status='failed',last_error='WORKER_INTERRUPTED',next_attempt_at=p_now
 WHERE status='sending' AND claimed_at<p_now-interval '15 minutes';
 PERFORM now() AT TIME ZONE p_timezone;
 RETURN true;
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.audit_valid_timezone(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.audit_valid_timezone(text) TO service_role;

DROP FUNCTION IF EXISTS public.portal_complete_onboarding(text,text,text,uuid,text,text,text);
CREATE FUNCTION public.portal_complete_onboarding(
 p_session_id text,p_company_name text,p_alias text,p_user_id uuid,p_email text,
 p_stripe_customer_id text,p_stripe_subscription_id text,p_timezone text,p_report_emails text[]
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE tenant uuid; existing uuid; report_email text;
BEGIN
 IF NOT public.audit_valid_timezone(p_timezone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 IF coalesce(array_length(p_report_emails,1),0)<1 OR array_length(p_report_emails,1)>20 THEN
  RAISE EXCEPTION 'One to twenty report emails are required';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_session_id));
 SELECT tenant_id INTO existing FROM public.audit_billing_customers WHERE stripe_checkout_session_id=p_session_id;
 IF existing IS NOT NULL THEN SELECT id INTO tenant FROM public.audit_tenants WHERE id=existing;
 ELSE INSERT INTO public.audit_tenants(name,alias,status) VALUES(trim(p_company_name),lower(trim(p_alias)),'active') RETURNING id INTO tenant;
 END IF;
 INSERT INTO public.audit_portal_users(user_id,enabled) VALUES(p_user_id,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true;
 INSERT INTO public.audit_memberships(tenant_id,user_id) VALUES(tenant,p_user_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_billing_customers(tenant_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,billing_email,status,onboarding_completed_at)
 VALUES(tenant,p_stripe_customer_id,p_stripe_subscription_id,p_session_id,lower(trim(p_email)),'active',now())
 ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET tenant_id=excluded.tenant_id,stripe_customer_id=excluded.stripe_customer_id,
 stripe_subscription_id=excluded.stripe_subscription_id,billing_email=excluded.billing_email,status='active',onboarding_completed_at=coalesce(public.audit_billing_customers.onboarding_completed_at,now()),updated_at=now();
 INSERT INTO public.audit_notification_settings(tenant_id,timezone) VALUES(tenant,p_timezone)
 ON CONFLICT(tenant_id) DO UPDATE SET timezone=excluded.timezone,updated_at=now();
 FOREACH report_email IN ARRAY p_report_emails LOOP
  report_email:=lower(trim(report_email));
  IF report_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'Invalid report email'; END IF;
  INSERT INTO public.audit_report_contacts(tenant_id,email,enabled,verified_at) VALUES(tenant,report_email,true,now())
  ON CONFLICT(tenant_id,email) DO UPDATE SET enabled=true,verified_at=coalesce(public.audit_report_contacts.verified_at,now());
 END LOOP;
 RETURN jsonb_build_object('tenant_id',tenant,'alias',(SELECT alias FROM public.audit_tenants WHERE id=tenant),'audit_email',(SELECT alias FROM public.audit_tenants WHERE id=tenant)||'@audit.aiolympian.com');
END $$;
REVOKE ALL ON FUNCTION public.portal_complete_onboarding(text,text,text,uuid,text,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_complete_onboarding(text,text,text,uuid,text,text,text,text,text[]) TO service_role;

CREATE FUNCTION public.portal_resolve_exception(
 p_user uuid,p_tenant uuid,p_exception uuid,p_outcome text,p_avoided_amount numeric,p_note text
) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Membership required'; END IF;
 IF p_outcome NOT IN ('avoided','no_loss') OR length(trim(p_note)) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Invalid resolution'; END IF;
 IF p_outcome='avoided' AND (p_avoided_amount IS NULL OR p_avoided_amount<=0) THEN RAISE EXCEPTION 'Avoided amount required'; END IF;
 UPDATE public.exceptions SET resolution_status=p_outcome,avoided_amount=CASE WHEN p_outcome='avoided' THEN p_avoided_amount ELSE 0 END,
  resolution_note=trim(p_note),resolved_at=now(),resolved_by=p_user
 WHERE id=p_exception AND tenant_id=p_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exception not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.portal_resolve_exception(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_resolve_exception(uuid,uuid,uuid,text,numeric,text) TO service_role;

CREATE FUNCTION public.enqueue_due_audit_notifications(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE inserted integer:=0; n integer;
BEGIN
 INSERT INTO public.audit_notification_deliveries(tenant_id,kind,period_key,period_start,period_end)
 SELECT s.tenant_id,'daily','daily:'||report_day::date::text,
  (report_day::timestamp AT TIME ZONE s.timezone),
  ((report_day::date+1)::timestamp AT TIME ZONE s.timezone)
 FROM public.audit_notification_settings s JOIN public.audit_tenants t ON t.id=s.tenant_id
 CROSS JOIN LATERAL generate_series(
  greatest((s.created_at AT TIME ZONE s.timezone)::date,coalesce((SELECT max((delivery.period_end AT TIME ZONE s.timezone)::date)
   FROM public.audit_notification_deliveries delivery WHERE delivery.tenant_id=s.tenant_id AND delivery.kind='daily'),(s.created_at AT TIME ZONE s.timezone)::date))::timestamp,
  ((p_now AT TIME ZONE s.timezone)::date-1)::timestamp,interval '1 day'
 ) AS days(report_day)
 WHERE t.status='active' AND s.daily_enabled AND extract(hour FROM p_now AT TIME ZONE s.timezone)>=s.daily_hour
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; inserted:=inserted+n;

 INSERT INTO public.audit_notification_deliveries(tenant_id,kind,period_key,period_start,period_end)
 SELECT s.tenant_id,'monthly','monthly:'||to_char(date_trunc('month',p_now AT TIME ZONE s.timezone)-interval '1 month','YYYY-MM'),
  ((date_trunc('month',p_now AT TIME ZONE s.timezone)-interval '1 month') AT TIME ZONE s.timezone),
  (date_trunc('month',p_now AT TIME ZONE s.timezone) AT TIME ZONE s.timezone)
 FROM public.audit_notification_settings s JOIN public.audit_tenants t ON t.id=s.tenant_id
 WHERE t.status='active' AND s.monthly_enabled
  AND (p_now AT TIME ZONE s.timezone)::date >= date_trunc('month',p_now AT TIME ZONE s.timezone)::date+
   CASE extract(isodow FROM date_trunc('month',p_now AT TIME ZONE s.timezone)) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END::integer
  AND extract(hour FROM p_now AT TIME ZONE s.timezone)>=s.daily_hour
  AND s.created_at<(date_trunc('month',p_now AT TIME ZONE s.timezone) AT TIME ZONE s.timezone)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; inserted:=inserted+n;

 INSERT INTO public.audit_notification_deliveries(tenant_id,kind,period_key,period_start,period_end,exception_id)
 SELECT e.tenant_id,'immediate','exception:'||e.id::text,e.created_at,e.created_at,e.id
 FROM public.exceptions e JOIN public.audit_notification_settings s ON s.tenant_id=e.tenant_id
 JOIN public.audit_tenants t ON t.id=e.tenant_id
 WHERE t.status='active' AND s.immediate_enabled
  AND e.created_at>=s.created_at
  AND (e.tipo_regra IN ('DUPLICATE_EXACT','BANKING_CHANGE') OR coalesce(e.valor_envolvido,0)>=s.immediate_threshold)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; inserted:=inserted+n;
 RETURN inserted;
END $$;

CREATE FUNCTION public.claim_audit_notification() RETURNS SETOF public.audit_notification_deliveries
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_notification_deliveries SET status='sending',attempts=attempts+1,last_error=NULL,claimed_at=now()
 WHERE id=(SELECT id FROM public.audit_notification_deliveries
  WHERE status IN ('queued','failed') AND next_attempt_at<=now() AND attempts<5
  ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.enqueue_due_audit_notifications(timestamptz),public.claim_audit_notification() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_audit_notifications(timestamptz),public.claim_audit_notification() TO service_role;
