-- Recover checkout onboarding invitations when the billing webhook function was
-- installed before the invitation queue existed. The trigger keeps invitation
-- creation independent from Stripe event ordering; the backfill repairs existing
-- eligible checkouts without resending invitations that already completed.
CREATE OR REPLACE FUNCTION public.queue_checkout_onboarding_invite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
BEGIN
 IF NEW.tenant_id IS NULL
    AND NEW.onboarding_completed_at IS NULL
    AND NEW.stripe_checkout_session_id IS NOT NULL
    AND NEW.billing_email IS NOT NULL
    AND NEW.status IN ('pending_payment','trialing','active') THEN
  INSERT INTO public.audit_checkout_onboarding_invites(checkout_session_id,email)
  VALUES(NEW.stripe_checkout_session_id,lower(NEW.billing_email))
  ON CONFLICT(checkout_session_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS queue_checkout_onboarding_invite ON public.audit_billing_customers;
CREATE TRIGGER queue_checkout_onboarding_invite
AFTER INSERT OR UPDATE OF tenant_id,onboarding_completed_at,stripe_checkout_session_id,billing_email,status
ON public.audit_billing_customers
FOR EACH ROW EXECUTE FUNCTION public.queue_checkout_onboarding_invite();

INSERT INTO public.audit_checkout_onboarding_invites(checkout_session_id,email)
SELECT stripe_checkout_session_id,lower(billing_email)
FROM public.audit_billing_customers
WHERE tenant_id IS NULL
 AND onboarding_completed_at IS NULL
 AND stripe_checkout_session_id IS NOT NULL
 AND billing_email IS NOT NULL
 AND status IN ('pending_payment','trialing','active')
ON CONFLICT(checkout_session_id) DO NOTHING;

-- Reinstall the current billing-event implementation so environments that only
-- partially applied migration 019 also understand Stripe's parent subscription
-- reference and enqueue checkout invitations atomically.
CREATE OR REPLACE FUNCTION public.process_stripe_billing_event(p_event_id text,p_event_type text,p_event_created bigint,p_object jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE billing public.audit_billing_customers%ROWTYPE; subscription_id text; stripe_status text;
DECLARE pause_until timestamptz; trial_end timestamptz; canceling boolean; next_status text; tenant_status text;
BEGIN
 INSERT INTO public.audit_stripe_events(event_id,event_type,event_created) VALUES(p_event_id,p_event_type,p_event_created)
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;

 IF p_event_type='checkout.session.completed' THEN
  INSERT INTO public.audit_billing_customers(stripe_checkout_session_id,stripe_customer_id,stripe_subscription_id,billing_email,status,last_stripe_event_created)
  VALUES(p_object->>'id',p_object->>'customer',p_object->>'subscription',lower(coalesce(p_object#>>'{customer_details,email}',p_object->>'customer_email')),
   CASE WHEN p_object->>'payment_status'='paid' THEN 'active' ELSE 'pending_payment' END,p_event_created)
  ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,
   stripe_subscription_id=excluded.stripe_subscription_id,billing_email=excluded.billing_email,
   status=CASE WHEN public.audit_billing_customers.status='trialing' THEN 'trialing' ELSE excluded.status END,
   last_stripe_event_created=greatest(public.audit_billing_customers.last_stripe_event_created,excluded.last_stripe_event_created),updated_at=now();
  INSERT INTO public.audit_checkout_onboarding_invites(checkout_session_id,email)
  SELECT p_object->>'id',lower(coalesce(p_object#>>'{customer_details,email}',p_object->>'customer_email'))
  WHERE coalesce(p_object#>>'{customer_details,email}',p_object->>'customer_email') IS NOT NULL
  ON CONFLICT(checkout_session_id) DO NOTHING;
  RETURN true;
 END IF;

 subscription_id:=coalesce(
  p_object->>'subscription',
  p_object#>>'{parent,subscription_details,subscription}',
  p_object#>>'{subscription_details,subscription}',
  CASE WHEN p_event_type LIKE 'customer.subscription.%' THEN p_object->>'id' END
 );
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
  trial_end:=CASE WHEN nullif(p_object->>'trial_end','') IS NULL THEN NULL
   ELSE to_timestamp((p_object->>'trial_end')::double precision) END;
  IF stripe_status IN ('unpaid','incomplete_expired','canceled') THEN next_status:='canceled';tenant_status:='inactive';
  ELSIF stripe_status IN ('past_due','incomplete') THEN next_status:='past_due';tenant_status:='paused';
  ELSIF stripe_status='paused' OR pause_until>now() THEN next_status:='paused';tenant_status:='paused';
  ELSIF canceling THEN next_status:='canceling';tenant_status:='active';
  ELSIF stripe_status='trialing' THEN next_status:='trialing';tenant_status:='active';
  ELSE next_status:='active';tenant_status:='active'; END IF;
 ELSE RETURN true; END IF;

 UPDATE public.audit_billing_customers SET status=next_status,last_stripe_event_created=p_event_created,
  cancel_at_period_end=CASE WHEN p_event_type='customer.subscription.updated' THEN canceling WHEN p_event_type='customer.subscription.deleted' THEN false ELSE cancel_at_period_end END,
  paused_until=CASE WHEN p_event_type='customer.subscription.updated' THEN pause_until ELSE paused_until END,
  trial_ends_at=CASE WHEN next_status='trialing' THEN trial_end WHEN next_status='active' THEN NULL ELSE trial_ends_at END,
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

REVOKE ALL ON FUNCTION public.queue_checkout_onboarding_invite() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_checkout_onboarding_invite() TO service_role;
REVOKE ALL ON FUNCTION public.process_stripe_billing_event(text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_billing_event(text,text,bigint,jsonb) TO service_role;
