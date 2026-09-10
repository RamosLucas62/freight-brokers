-- A completed Stripe Checkout can legitimately require no immediate payment when
-- it starts a card-backed subscription trial. Keep that state distinct from a
-- paid subscription while allowing the tenant to use the service.
ALTER TABLE public.audit_billing_customers
 ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE public.audit_billing_customers DROP CONSTRAINT IF EXISTS audit_billing_customers_status_check;
ALTER TABLE public.audit_billing_customers
 ADD CONSTRAINT audit_billing_customers_status_check
 CHECK (status IN ('pending_payment','trialing','active','past_due','paused','canceling','canceled'));

CREATE OR REPLACE FUNCTION public.sync_onboarding_billing_state(
 p_session_id text,p_subscription_id text,p_status text,p_trial_ends_at timestamptz
) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_status NOT IN ('trialing','active') THEN RAISE EXCEPTION 'Invalid onboarding billing status'; END IF;
 IF p_status='trialing' AND (p_trial_ends_at IS NULL OR p_trial_ends_at<=now()) THEN RAISE EXCEPTION 'Valid trial end required'; END IF;
 UPDATE public.audit_billing_customers SET status=p_status,
  trial_ends_at=CASE WHEN p_status='trialing' THEN p_trial_ends_at ELSE NULL END,updated_at=now()
 WHERE stripe_checkout_session_id=p_session_id AND stripe_subscription_id=p_subscription_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout subscription not linked'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.sync_onboarding_billing_state(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_onboarding_billing_state(text,text,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_payment_grace() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='past_due' AND OLD.status IS DISTINCT FROM 'past_due' THEN NEW.payment_grace_until:=now()+interval '3 days'; END IF;
 IF NEW.status IN ('trialing','active','canceling') THEN NEW.payment_grace_until:=NULL; END IF;
 RETURN NEW;
END $$;

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

-- A converted free-audit lead must stop receiving sales follow-ups as soon as a
-- trial starts, just as it does after the first successful charge.
CREATE OR REPLACE FUNCTION public.claim_free_audit_followup() RETURNS TABLE(request_id uuid,day_offset smallint,email text,contact_name text,company_name text,loads_per_month text,recommended_plan text,result jsonb) LANGUAGE plpgsql SET search_path=public AS $$
DECLARE claimed public.free_audit_followups%ROWTYPE;
BEGIN
 UPDATE public.free_audit_followups SET status='pending',claimed_at=NULL WHERE status='sending' AND claimed_at<now()-interval '15 minutes';
 UPDATE public.free_audit_followups f SET status='cancelled' FROM public.free_audit_requests r
 WHERE f.request_id=r.id AND f.status='pending' AND (r.marketing_unsubscribed_at IS NOT NULL OR r.result_expires_at<=now() OR EXISTS(SELECT 1 FROM public.audit_billing_customers b WHERE lower(b.billing_email)=lower(r.email) AND b.status IN ('trialing','active','past_due','paused','canceling')));
 SELECT f.* INTO claimed FROM public.free_audit_followups f JOIN public.free_audit_requests r ON r.id=f.request_id
 WHERE f.status='pending' AND f.due_at<=now() AND r.marketing_unsubscribed_at IS NULL AND r.result_expires_at>now()
 ORDER BY f.due_at FOR UPDATE OF f SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.free_audit_followups SET status='sending',attempts=attempts+1,claimed_at=now() WHERE free_audit_followups.request_id=claimed.request_id AND free_audit_followups.day_offset=claimed.day_offset;
 RETURN QUERY SELECT r.id,claimed.day_offset,r.email,r.contact_name,r.company_name,r.loads_per_month,r.recommended_plan,r.result FROM public.free_audit_requests r WHERE r.id=claimed.request_id;
END $$;
