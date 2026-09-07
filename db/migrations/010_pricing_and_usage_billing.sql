-- Two commercial plans, six prepaid base prices, calendar-month invoice usage,
-- monthly overage settlement and a three-day payment grace period.
ALTER TABLE public.audit_billing_customers
 ADD COLUMN IF NOT EXISTS plan_code text NOT NULL DEFAULT 'core',
 ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly',
 ADD COLUMN IF NOT EXISTS included_invoices integer NOT NULL DEFAULT 500,
 ADD COLUMN IF NOT EXISTS overage_unit_amount_cents integer NOT NULL DEFAULT 75,
 ADD COLUMN IF NOT EXISTS payment_grace_until timestamptz;
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_plan_code_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_plan_code_check CHECK(plan_code IN ('core','scale'));
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_billing_period_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_billing_period_check CHECK(billing_period IN ('monthly','semiannual','annual'));
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_included_invoices_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_included_invoices_check CHECK(included_invoices IN (500,1500));
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_overage_amount_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_overage_amount_check CHECK(overage_unit_amount_cents IN (50,75));

ALTER TABLE public.audit_inbound_attachments ADD COLUMN IF NOT EXISTS document_hash text;
CREATE INDEX IF NOT EXISTS idx_billable_document_hash ON public.audit_inbound_attachments(tenant_id,document_hash) WHERE document_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.audit_invoice_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 job_id uuid NOT NULL,attachment_id uuid NOT NULL,document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'),
 usage_month date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,document_hash),FOREIGN KEY(tenant_id,job_id,attachment_id) REFERENCES public.audit_inbound_attachments(tenant_id,job_id,attachment_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invoice_usage_month ON public.audit_invoice_usage(tenant_id,usage_month);
ALTER TABLE public.audit_invoice_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_invoice_usage FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.audit_invoice_usage TO service_role;
GRANT SELECT ON public.audit_invoice_usage TO authenticated;
DROP POLICY IF EXISTS audit_member_read ON public.audit_invoice_usage;
DROP POLICY IF EXISTS audit_member_guard ON public.audit_invoice_usage;
CREATE POLICY audit_member_read ON public.audit_invoice_usage FOR SELECT TO authenticated USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_invoice_usage AS RESTRICTIVE FOR SELECT TO authenticated USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

CREATE TABLE IF NOT EXISTS public.audit_usage_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),usage_month date NOT NULL,
 usage_count integer NOT NULL,overage_count integer NOT NULL,unit_amount_cents integer NOT NULL,amount_cents integer NOT NULL,
 stripe_customer_id text NOT NULL,stripe_subscription_id text NOT NULL,stripe_invoice_id text,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','billed','failed')),
 attempts smallint NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),billed_at timestamptz,
 UNIQUE(tenant_id,usage_month)
);
CREATE INDEX IF NOT EXISTS idx_usage_settlement_queue ON public.audit_usage_settlements(next_attempt_at,created_at) WHERE status IN ('queued','failed');
ALTER TABLE public.audit_usage_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_usage_settlements FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_usage_settlements TO service_role;
GRANT SELECT ON public.audit_usage_settlements TO authenticated;
DROP POLICY IF EXISTS audit_member_read ON public.audit_usage_settlements;
DROP POLICY IF EXISTS audit_member_guard ON public.audit_usage_settlements;
CREATE POLICY audit_member_read ON public.audit_usage_settlements FOR SELECT TO authenticated USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_usage_settlements AS RESTRICTIVE FOR SELECT TO authenticated USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.assign_billing_plan(p_tenant uuid,p_session_id text,p_plan text,p_period text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_plan NOT IN ('core','scale') OR p_period NOT IN ('monthly','semiannual','annual') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
 UPDATE public.audit_billing_customers SET plan_code=p_plan,billing_period=p_period,
  included_invoices=CASE WHEN p_plan='scale' THEN 1500 ELSE 500 END,
  overage_unit_amount_cents=CASE WHEN p_plan='scale' THEN 50 ELSE 75 END,updated_at=now()
 WHERE tenant_id=p_tenant AND stripe_checkout_session_id=p_session_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout not linked'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_billing_plan_from_stripe(p_subscription_id text,p_plan text,p_period text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_plan NOT IN ('core','scale') OR p_period NOT IN ('monthly','semiannual','annual') THEN RETURN; END IF;
 UPDATE public.audit_billing_customers SET plan_code=p_plan,billing_period=p_period,
  included_invoices=CASE WHEN p_plan='scale' THEN 1500 ELSE 500 END,
  overage_unit_amount_cents=CASE WHEN p_plan='scale' THEN 50 ELSE 75 END,updated_at=now()
 WHERE stripe_subscription_id=p_subscription_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_billable_invoice(p_tenant uuid,p_job uuid,p_attachment uuid,p_document_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE zone text; month_key date;
BEGIN
 IF p_document_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid document hash'; END IF;
 SELECT coalesce(timezone,'UTC') INTO zone FROM public.audit_notification_settings WHERE tenant_id=p_tenant;
 month_key:=date_trunc('month',now() AT TIME ZONE coalesce(zone,'UTC'))::date;
 UPDATE public.audit_inbound_attachments SET document_hash=p_document_hash WHERE tenant_id=p_tenant AND job_id=p_job AND attachment_id=p_attachment;
 IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found'; END IF;
 INSERT INTO public.audit_invoice_usage(tenant_id,job_id,attachment_id,document_hash,usage_month)
 VALUES(p_tenant,p_job,p_attachment,p_document_hash,month_key) ON CONFLICT(tenant_id,document_hash) DO NOTHING;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.claim_due_usage_settlement() RETURNS SETOF public.audit_usage_settlements
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_usage_settlements(tenant_id,usage_month,usage_count,overage_count,unit_amount_cents,amount_cents,stripe_customer_id,stripe_subscription_id)
 SELECT b.tenant_id,u.usage_month,count(*)::integer,(count(*)-b.included_invoices)::integer,b.overage_unit_amount_cents,
  ((count(*)-b.included_invoices)*b.overage_unit_amount_cents)::integer,b.stripe_customer_id,b.stripe_subscription_id
 FROM public.audit_invoice_usage u JOIN public.audit_billing_customers b ON b.tenant_id=u.tenant_id
 LEFT JOIN public.audit_notification_settings s ON s.tenant_id=b.tenant_id
 WHERE u.usage_month<date_trunc('month',now() AT TIME ZONE coalesce(s.timezone,'UTC'))::date
  AND b.stripe_customer_id IS NOT NULL AND b.stripe_subscription_id IS NOT NULL
 GROUP BY b.tenant_id,u.usage_month,b.included_invoices,b.overage_unit_amount_cents,b.stripe_customer_id,b.stripe_subscription_id
 HAVING count(*)>b.included_invoices ON CONFLICT(tenant_id,usage_month) DO NOTHING;
 UPDATE public.audit_usage_settlements SET status='failed',next_attempt_at=now(),last_error='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes';
 RETURN QUERY UPDATE public.audit_usage_settlements SET status='processing',attempts=attempts+1,claimed_at=now(),last_error=NULL
 WHERE id=(SELECT id FROM public.audit_usage_settlements WHERE status IN ('queued','failed') AND next_attempt_at<=now() AND attempts<12 ORDER BY usage_month,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.finish_usage_settlement(p_id uuid,p_invoice_id text,p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_usage_settlements SET status=CASE WHEN p_invoice_id IS NOT NULL THEN 'billed' ELSE 'failed' END,
 stripe_invoice_id=p_invoice_id,billed_at=CASE WHEN p_invoice_id IS NOT NULL THEN now() ELSE NULL END,
 last_error=CASE WHEN p_invoice_id IS NULL THEN left(p_error,200) ELSE NULL END,
 next_attempt_at=CASE WHEN p_invoice_id IS NULL THEN now()+least(interval '12 hours',interval '5 minutes'*power(2,greatest(attempts-1,0))) ELSE next_attempt_at END
 WHERE id=p_id AND status='processing'
$$;

CREATE OR REPLACE FUNCTION public.billing_payment_grace() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='past_due' AND OLD.status IS DISTINCT FROM 'past_due' THEN NEW.payment_grace_until:=now()+interval '3 days'; END IF;
 IF NEW.status IN ('active','canceling') THEN NEW.payment_grace_until:=NULL; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS billing_payment_grace ON public.audit_billing_customers;
CREATE TRIGGER billing_payment_grace BEFORE UPDATE ON public.audit_billing_customers FOR EACH ROW EXECUTE FUNCTION public.billing_payment_grace();

CREATE OR REPLACE FUNCTION public.preserve_payment_grace() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='paused' AND EXISTS(SELECT 1 FROM public.audit_billing_customers WHERE tenant_id=NEW.id AND status='past_due' AND payment_grace_until>now()) THEN NEW.status:='active'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS preserve_payment_grace ON public.audit_tenants;
CREATE TRIGGER preserve_payment_grace BEFORE UPDATE OF status ON public.audit_tenants FOR EACH ROW EXECUTE FUNCTION public.preserve_payment_grace();
CREATE OR REPLACE FUNCTION public.suspend_expired_payment_grace() RETURNS integer LANGUAGE plpgsql SET search_path=public AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.audit_tenants t SET status='paused' FROM public.audit_billing_customers b
 WHERE b.tenant_id=t.id AND b.status='past_due' AND b.payment_grace_until<=now() AND t.status='active';
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_plan_membership_limit() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=NEW.tenant_id),'core')='core'
  AND (SELECT count(*) FROM public.audit_memberships WHERE tenant_id=NEW.tenant_id)>=3 THEN RAISE EXCEPTION 'Core supports up to three users'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_plan_membership_limit ON public.audit_memberships;
CREATE TRIGGER enforce_plan_membership_limit BEFORE INSERT ON public.audit_memberships FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_membership_limit();

CREATE OR REPLACE FUNCTION public.enforce_scale_reprocessing() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.action='retry' AND coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=NEW.tenant_id),'core')<>'scale' THEN RAISE EXCEPTION 'Reprocessing requires Scale'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_scale_reprocessing ON public.audit_job_reviews;
CREATE TRIGGER enforce_scale_reprocessing BEFORE INSERT ON public.audit_job_reviews FOR EACH ROW EXECUTE FUNCTION public.enforce_scale_reprocessing();

CREATE OR REPLACE FUNCTION public.portal_save_notification_settings_v2(
 p_user uuid,p_tenant uuid,p_timezone text,p_contacts jsonb,p_ip_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE member_role text; item jsonb; normalized text; changed text[]:=ARRAY[]::text[]; contact_limit integer;
BEGIN
 SELECT role INTO member_role FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF member_role NOT IN ('owner','billing_admin') THEN RAISE EXCEPTION 'Settings administrator required'; END IF;
 IF NOT public.audit_valid_timezone(p_timezone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 contact_limit:=CASE WHEN coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=p_tenant),'core')='scale' THEN 500 ELSE 3 END;
 IF jsonb_typeof(p_contacts)<>'array' OR jsonb_array_length(p_contacts)<1 OR jsonb_array_length(p_contacts)>contact_limit THEN RAISE EXCEPTION 'Plan contact limit exceeded'; END IF;
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

CREATE OR REPLACE FUNCTION public.portal_save_inbound_senders(p_user uuid,p_tenant uuid,p_senders text[],p_ip_fingerprint text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE member_role text; sender text; sender_limit integer;
BEGIN
 SELECT role INTO member_role FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF member_role NOT IN ('owner','billing_admin') THEN RAISE EXCEPTION 'Settings administrator required'; END IF;
 sender_limit:=CASE WHEN coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=p_tenant),'core')='scale' THEN 500 ELSE 1 END;
 IF coalesce(array_length(p_senders,1),0)<1 OR array_length(p_senders,1)>sender_limit OR EXISTS(SELECT 1 FROM unnest(p_senders) value WHERE lower(trim(value)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'Plan sender limit exceeded'; END IF;
 UPDATE public.audit_inbound_sender_rules SET enabled=false WHERE tenant_id=p_tenant;
 FOREACH sender IN ARRAY p_senders LOOP
  INSERT INTO public.audit_inbound_sender_rules(tenant_id,sender_email,enabled) VALUES(p_tenant,lower(trim(sender)),true)
  ON CONFLICT(tenant_id,sender_email) DO UPDATE SET enabled=true;
 END LOOP;
 INSERT INTO public.audit_security_activity(tenant_id,actor_user_id,action,ip_fingerprint,details)
 VALUES(p_tenant,p_user,'inbound_senders_changed',left(p_ip_fingerprint,64),jsonb_build_object('count',array_length(p_senders,1)));
END $$;

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
 DELETE FROM public.audit_invoice_usage WHERE tenant_id=tenant;
 DELETE FROM public.audit_usage_settlements WHERE tenant_id=tenant;
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

REVOKE ALL ON FUNCTION public.assign_billing_plan(uuid,text,text,text),public.sync_billing_plan_from_stripe(text,text,text),public.record_billable_invoice(uuid,uuid,uuid,text),public.claim_due_usage_settlement(),public.finish_usage_settlement(uuid,text,text),public.suspend_expired_payment_grace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_billing_plan(uuid,text,text,text),public.sync_billing_plan_from_stripe(text,text,text),public.record_billable_invoice(uuid,uuid,uuid,text),public.claim_due_usage_settlement(),public.finish_usage_settlement(uuid,text,text),public.suspend_expired_payment_grace() TO service_role;
