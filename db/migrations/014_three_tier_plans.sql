-- Align billing with the public Core, Growth and Scale catalog.
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_plan_code_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_plan_code_check CHECK(plan_code IN ('core','growth','scale'));
ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_included_invoices_check;
ALTER TABLE public.audit_billing_customers ADD CONSTRAINT audit_billing_customers_included_invoices_check CHECK(included_invoices IN (500,1500,3000));

-- Existing subscriptions at the former $997 Scale tier are the new Growth tier.
UPDATE public.audit_billing_customers
 SET plan_code='growth'
 WHERE plan_code='scale' AND included_invoices=1500;

CREATE OR REPLACE FUNCTION public.assign_billing_plan(p_tenant uuid,p_session_id text,p_plan text,p_period text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_plan NOT IN ('core','growth','scale') OR p_period NOT IN ('monthly','semiannual','annual') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
 UPDATE public.audit_billing_customers SET plan_code=p_plan,billing_period=p_period,
  included_invoices=CASE p_plan WHEN 'scale' THEN 3000 WHEN 'growth' THEN 1500 ELSE 500 END,
  overage_unit_amount_cents=CASE WHEN p_plan='core' THEN 75 ELSE 50 END,updated_at=now()
 WHERE tenant_id=p_tenant AND stripe_checkout_session_id=p_session_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout not linked'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_billing_plan_from_stripe(p_subscription_id text,p_plan text,p_period text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_plan NOT IN ('core','growth','scale') OR p_period NOT IN ('monthly','semiannual','annual') THEN RETURN; END IF;
 UPDATE public.audit_billing_customers SET plan_code=p_plan,billing_period=p_period,
  included_invoices=CASE p_plan WHEN 'scale' THEN 3000 WHEN 'growth' THEN 1500 ELSE 500 END,
  overage_unit_amount_cents=CASE WHEN p_plan='core' THEN 75 ELSE 50 END,updated_at=now()
 WHERE stripe_subscription_id=p_subscription_id;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_scale_reprocessing() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.action='retry' AND coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=NEW.tenant_id),'core') NOT IN ('growth','scale') THEN RAISE EXCEPTION 'Reprocessing requires Growth or Scale'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.portal_save_notification_settings_v2(
 p_user uuid,p_tenant uuid,p_timezone text,p_contacts jsonb,p_ip_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE member_role text; item jsonb; normalized text; changed text[]:=ARRAY[]::text[]; contact_limit integer;
BEGIN
 SELECT role INTO member_role FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF member_role NOT IN ('owner','billing_admin') THEN RAISE EXCEPTION 'Settings administrator required'; END IF;
 IF NOT public.audit_valid_timezone(p_timezone) THEN RAISE EXCEPTION 'Invalid time zone'; END IF;
 contact_limit:=CASE WHEN coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=p_tenant),'core') IN ('growth','scale') THEN 500 ELSE 3 END;
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
 sender_limit:=CASE WHEN coalesce((SELECT plan_code FROM public.audit_billing_customers WHERE tenant_id=p_tenant),'core') IN ('growth','scale') THEN 500 ELSE 1 END;
 IF coalesce(array_length(p_senders,1),0)<1 OR array_length(p_senders,1)>sender_limit OR EXISTS(SELECT 1 FROM unnest(p_senders) value WHERE lower(trim(value)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN RAISE EXCEPTION 'Plan sender limit exceeded'; END IF;
 UPDATE public.audit_inbound_sender_rules SET enabled=false WHERE tenant_id=p_tenant;
 FOREACH sender IN ARRAY p_senders LOOP
  INSERT INTO public.audit_inbound_sender_rules(tenant_id,sender_email,enabled) VALUES(p_tenant,lower(trim(sender)),true)
  ON CONFLICT(tenant_id,sender_email) DO UPDATE SET enabled=true;
 END LOOP;
 INSERT INTO public.audit_security_activity(tenant_id,actor_user_id,action,ip_fingerprint,details)
 VALUES(p_tenant,p_user,'inbound_senders_changed',left(p_ip_fingerprint,64),jsonb_build_object('count',array_length(p_senders,1)));
END $$;
