-- Stripe is the source of truth for the paid account lifecycle. Webhook events are
-- recorded once and applied atomically so retries cannot corrupt account state.
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_status_check;
ALTER TABLE public.audit_billing_customers
 ADD CONSTRAINT audit_billing_customers_status_check
 CHECK (status IN ('pending_payment','active','past_due','paused','canceling','canceled')),
 ADD COLUMN IF NOT EXISTS retention_discount_used_at timestamptz,
 ADD COLUMN IF NOT EXISTS pause_used_at timestamptz,
 ADD COLUMN IF NOT EXISTS paused_until timestamptz,
 ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
 ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz,
 ADD COLUMN IF NOT EXISTS deletion_completed_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_stripe_event_created bigint NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_stripe_subscription_unique
 ON public.audit_billing_customers(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_tenant_unique
 ON public.audit_billing_customers(tenant_id) WHERE tenant_id IS NOT NULL;

CREATE TABLE public.audit_stripe_events (
 event_id text PRIMARY KEY,
 event_type text NOT NULL,
 event_created bigint NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_billing_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 user_id uuid REFERENCES auth.users(id),
 action text NOT NULL CHECK (action IN ('retention_discount','pause_one_month','cancel_at_period_end')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_actions_tenant_created ON public.audit_billing_actions(tenant_id,created_at DESC);

CREATE TABLE public.audit_data_deletions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL UNIQUE REFERENCES public.audit_tenants(id),
 scheduled_for timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','deleting','failed','completed')),
 attempts smallint NOT NULL DEFAULT 0,
 claimed_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 deleted_counts jsonb,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_data_deletion_queue ON public.audit_data_deletions(next_attempt_at,scheduled_for)
 WHERE status IN ('queued','failed');

ALTER TABLE public.audit_stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_billing_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_data_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_stripe_events,public.audit_billing_actions,public.audit_data_deletions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_stripe_events,public.audit_billing_actions,public.audit_data_deletions TO service_role;

-- Migration 007 originally carried an interrupted-delivery statement in this
-- validator. Keep validation side-effect free.
CREATE OR REPLACE FUNCTION public.audit_valid_timezone(p_timezone text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
 PERFORM now() AT TIME ZONE p_timezone;
 RETURN true;
EXCEPTION WHEN invalid_parameter_value THEN RETURN false;
END $$;

CREATE FUNCTION public.portal_save_notification_settings(p_user uuid,p_tenant uuid,p_timezone text,p_report_emails text[])
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE report_email text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN
  RAISE EXCEPTION 'Membership required';
 END IF;
 IF NOT public.audit_valid_timezone(p_timezone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 IF coalesce(array_length(p_report_emails,1),0)<1 OR array_length(p_report_emails,1)>20 THEN
  RAISE EXCEPTION 'One to twenty report emails are required';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_report_emails) value WHERE lower(trim(value)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
  RAISE EXCEPTION 'Invalid report email';
 END IF;
 INSERT INTO public.audit_notification_settings(tenant_id,timezone) VALUES(p_tenant,p_timezone)
 ON CONFLICT(tenant_id) DO UPDATE SET timezone=excluded.timezone,updated_at=now();
 UPDATE public.audit_report_contacts SET enabled=false WHERE tenant_id=p_tenant;
 FOREACH report_email IN ARRAY p_report_emails LOOP
  INSERT INTO public.audit_report_contacts(tenant_id,email,enabled,verified_at)
  VALUES(p_tenant,lower(trim(report_email)),true,now())
  ON CONFLICT(tenant_id,email) DO UPDATE SET enabled=true;
 END LOOP;
END $$;

CREATE FUNCTION public.portal_record_billing_action(p_user uuid,p_tenant uuid,p_action text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE billing public.audit_billing_customers%ROWTYPE; requester_email text;
BEGIN
 SELECT lower(email) INTO requester_email FROM auth.users WHERE id=p_user;
 SELECT * INTO billing FROM public.audit_billing_customers WHERE tenant_id=p_tenant FOR UPDATE;
 IF billing.id IS NULL OR requester_email IS DISTINCT FROM billing.billing_email THEN RAISE EXCEPTION 'Billing owner required'; END IF;
 IF p_action='retention_discount' THEN
  IF billing.retention_discount_used_at IS NOT NULL THEN RAISE EXCEPTION 'Discount already used'; END IF;
  UPDATE public.audit_billing_customers SET retention_discount_used_at=now(),updated_at=now() WHERE id=billing.id;
 ELSIF p_action='pause_one_month' THEN
  IF billing.pause_used_at>now()-interval '12 months' THEN RAISE EXCEPTION 'Pause already used'; END IF;
  UPDATE public.audit_billing_customers SET pause_used_at=now(),paused_until=now()+interval '30 days',status='paused',updated_at=now() WHERE id=billing.id;
  UPDATE public.audit_tenants SET status='paused' WHERE id=p_tenant;
 ELSIF p_action='cancel_at_period_end' THEN
  UPDATE public.audit_billing_customers SET cancel_at_period_end=true,status='canceling',updated_at=now() WHERE id=billing.id;
 ELSE RAISE EXCEPTION 'Invalid billing action'; END IF;
 INSERT INTO public.audit_billing_actions(tenant_id,user_id,action) VALUES(p_tenant,p_user,p_action);
END $$;

CREATE FUNCTION public.process_stripe_billing_event(p_event_id text,p_event_type text,p_event_created bigint,p_object jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE billing public.audit_billing_customers%ROWTYPE; subscription_id text; stripe_status text;
DECLARE pause_until timestamptz; canceling boolean; next_status text; tenant_status text;
BEGIN
 INSERT INTO public.audit_stripe_events(event_id,event_type,event_created) VALUES(p_event_id,p_event_type,p_event_created)
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;

 IF p_event_type='checkout.session.completed' THEN
  INSERT INTO public.audit_billing_customers(stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,billing_email,status,last_stripe_event_created)
  VALUES(p_object->>'id',p_object->>'customer',p_object->>'subscription',lower(coalesce(p_object#>>'{customer_details,email}',p_object->>'customer_email')),
   CASE WHEN p_object->>'payment_status'='paid' THEN 'active' ELSE 'pending_payment' END,p_event_created)
  ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,
   stripe_subscription_id=excluded.stripe_subscription_id,billing_email=excluded.billing_email,status=excluded.status,
   last_stripe_event_created=greatest(public.audit_billing_customers.last_stripe_event_created,excluded.last_stripe_event_created),updated_at=now();
  RETURN true;
 END IF;

 subscription_id:=coalesce(p_object->>'subscription',p_object#>>'{subscription_details,subscription}',CASE WHEN p_event_type LIKE 'customer.subscription.%' THEN p_object->>'id' END);
 SELECT * INTO billing FROM public.audit_billing_customers WHERE stripe_subscription_id=subscription_id FOR UPDATE;
 IF billing.id IS NULL THEN RAISE EXCEPTION 'Unknown Stripe subscription'; END IF;
 IF p_event_created<billing.last_stripe_event_created THEN RETURN true; END IF;
 IF billing.status='canceled' AND p_event_type<>'customer.subscription.deleted' THEN RETURN true; END IF;

 IF p_event_type='invoice.payment_failed' THEN next_status:='past_due';tenant_status:='paused';
 ELSIF p_event_type='invoice.paid' THEN
  IF billing.paused_until>now() THEN next_status:='paused';tenant_status:='paused';
  ELSIF billing.cancel_at_period_end THEN next_status:='canceling';tenant_status:='active';
  ELSE next_status:='active';tenant_status:='active'; END IF;
 ELSIF p_event_type='customer.subscription.deleted' THEN next_status:='canceled';tenant_status:='inactive';
 ELSIF p_event_type='customer.subscription.updated' THEN
  stripe_status:=p_object->>'status';canceling:=coalesce((p_object->>'cancel_at_period_end')::boolean,false);
  pause_until:=CASE WHEN nullif(p_object#>>'{pause_collection,resumes_at}','') IS NULL THEN NULL
   ELSE to_timestamp((p_object#>>'{pause_collection,resumes_at}')::double precision) END;
  IF stripe_status IN ('unpaid','incomplete_expired','canceled') THEN next_status:='canceled';tenant_status:='inactive';
  ELSIF stripe_status IN ('past_due','incomplete') THEN next_status:='past_due';tenant_status:='paused';
  ELSIF stripe_status='paused' OR pause_until>now() THEN next_status:='paused';tenant_status:='paused';
  ELSIF canceling THEN next_status:='canceling';tenant_status:='active';
  ELSE next_status:='active';tenant_status:='active'; END IF;
 ELSE RETURN true; END IF;

 UPDATE public.audit_billing_customers SET status=next_status,last_stripe_event_created=p_event_created,
  cancel_at_period_end=CASE WHEN p_event_type='customer.subscription.updated' THEN canceling WHEN p_event_type='customer.subscription.deleted' THEN false ELSE cancel_at_period_end END,
  paused_until=CASE WHEN p_event_type='customer.subscription.updated' THEN pause_until ELSE paused_until END,
  canceled_at=CASE WHEN next_status='canceled' THEN coalesce(canceled_at,now()) ELSE canceled_at END,
  deletion_scheduled_at=CASE WHEN p_event_type='customer.subscription.deleted' THEN now()+interval '30 days' ELSE deletion_scheduled_at END,
  updated_at=now() WHERE id=billing.id;
 IF billing.tenant_id IS NOT NULL THEN
  UPDATE public.audit_tenants SET status=tenant_status WHERE id=billing.tenant_id;
  IF p_event_type='customer.subscription.deleted' THEN
   INSERT INTO public.audit_data_deletions(tenant_id,scheduled_for) VALUES(billing.tenant_id,now()+interval '30 days')
   ON CONFLICT(tenant_id) DO UPDATE SET scheduled_for=excluded.scheduled_for,status='queued',next_attempt_at=now(),last_error=NULL;
  END IF;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.resume_due_customer_pauses(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 WITH due AS (
  UPDATE public.audit_billing_customers SET status='active',paused_until=NULL,updated_at=p_now
  WHERE status='paused' AND paused_until<=p_now AND cancel_at_period_end=false AND canceled_at IS NULL
  RETURNING tenant_id
 ) UPDATE public.audit_tenants t SET status='active' FROM due WHERE t.id=due.tenant_id;
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $$;

CREATE FUNCTION public.claim_due_data_deletion() RETURNS SETOF public.audit_data_deletions
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_data_deletions SET status='deleting',attempts=attempts+1,claimed_at=now(),last_error=NULL
 WHERE id=(SELECT id FROM public.audit_data_deletions WHERE status IN ('queued','failed') AND scheduled_for<=now()
  AND next_attempt_at<=now() AND attempts<10 ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
$$;

CREATE FUNCTION public.complete_tenant_data_deletion(p_job uuid,p_deleted_counts jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE tenant uuid; deleted_alias text;
BEGIN
 SELECT tenant_id INTO tenant FROM public.audit_data_deletions WHERE id=p_job AND status='deleting' FOR UPDATE;
 IF tenant IS NULL THEN RAISE EXCEPTION 'Deletion job not claimed'; END IF;
 DELETE FROM public.audit_notification_deliveries WHERE tenant_id=tenant;
 DELETE FROM public.audit_notification_settings WHERE tenant_id=tenant;
 DELETE FROM public.audit_report_contacts WHERE tenant_id=tenant;
 DELETE FROM public.audit_job_reviews WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_attachments WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_jobs WHERE tenant_id=tenant;
 DELETE FROM public.audit_runs WHERE tenant_id=tenant;
 DELETE FROM public.exceptions WHERE tenant_id=tenant;
 DELETE FROM public.invoices WHERE tenant_id=tenant;
 DELETE FROM public.audit_memberships WHERE tenant_id=tenant;
 UPDATE public.audit_billing_actions SET user_id=NULL WHERE tenant_id=tenant;
 UPDATE public.audit_admin_activity SET tenant_id=NULL,target_user_id=NULL,company_name='Deleted account',target_email=NULL,details='{"redacted":true}'::jsonb WHERE tenant_id=tenant;
 DELETE FROM public.audit_inbound_events e WHERE NOT EXISTS (SELECT 1 FROM public.audit_inbound_jobs j WHERE j.email_id=e.email_id);
 deleted_alias:='deleted-'||replace(tenant::text,'-','');
 UPDATE public.audit_tenants SET name='Deleted account',alias=deleted_alias,status='inactive' WHERE id=tenant;
 UPDATE public.audit_billing_customers SET billing_email='deleted+'||replace(tenant::text,'-','')||'@invalid.local',
  stripe_checkout_session_id=NULL,deletion_completed_at=now(),updated_at=now() WHERE tenant_id=tenant;
 UPDATE public.audit_data_deletions SET status='completed',deleted_counts=p_deleted_counts,completed_at=now() WHERE id=p_job;
END $$;

CREATE FUNCTION public.fail_tenant_data_deletion(p_job uuid,p_error text) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_data_deletions SET status='failed',last_error=left(p_error,500),
  next_attempt_at=now()+least(interval '24 hours',interval '5 minutes'*power(2,greatest(attempts-1,0))) WHERE id=p_job
$$;

REVOKE ALL ON FUNCTION public.portal_save_notification_settings(uuid,uuid,text,text[]),public.portal_record_billing_action(uuid,uuid,text),
 public.process_stripe_billing_event(text,text,bigint,jsonb),public.resume_due_customer_pauses(timestamptz),public.claim_due_data_deletion(),
 public.complete_tenant_data_deletion(uuid,jsonb),public.fail_tenant_data_deletion(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_save_notification_settings(uuid,uuid,text,text[]),public.portal_record_billing_action(uuid,uuid,text),
 public.process_stripe_billing_event(text,text,bigint,jsonb),public.resume_due_customer_pauses(timestamptz),public.claim_due_data_deletion(),
 public.complete_tenant_data_deletion(uuid,jsonb),public.fail_tenant_data_deletion(uuid,text) TO service_role;
