-- Preserve first-touch campaign attribution for the administrator CRM funnel.
ALTER TABLE public.free_audit_requests
 ADD COLUMN IF NOT EXISTS utm_source text CHECK(utm_source IS NULL OR char_length(utm_source)<=200),
 ADD COLUMN IF NOT EXISTS utm_medium text CHECK(utm_medium IS NULL OR char_length(utm_medium)<=200),
 ADD COLUMN IF NOT EXISTS utm_campaign text CHECK(utm_campaign IS NULL OR char_length(utm_campaign)<=200),
 ADD COLUMN IF NOT EXISTS utm_term text CHECK(utm_term IS NULL OR char_length(utm_term)<=200),
 ADD COLUMN IF NOT EXISTS utm_content text CHECK(utm_content IS NULL OR char_length(utm_content)<=200);

-- Revenue is recognized in the CRM only after Stripe confirms a non-zero paid
-- invoice. Keeping the Stripe invoice id and timestamp makes the displayed
-- amount auditable and prevents a free trial from being presented as revenue.
ALTER TABLE public.audit_billing_customers
 ADD COLUMN IF NOT EXISTS last_paid_amount_cents bigint CHECK(last_paid_amount_cents IS NULL OR last_paid_amount_cents>0),
 ADD COLUMN IF NOT EXISTS last_paid_currency text CHECK(last_paid_currency IS NULL OR last_paid_currency~'^[a-z]{3}$'),
 ADD COLUMN IF NOT EXISTS last_paid_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_paid_invoice_id text CHECK(last_paid_invoice_id IS NULL OR char_length(last_paid_invoice_id)<=255);

CREATE INDEX IF NOT EXISTS idx_free_audit_crm_created ON public.free_audit_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_crm_email_updated ON public.audit_billing_customers(lower(billing_email),updated_at DESC) WHERE billing_email IS NOT NULL;

COMMENT ON COLUMN public.free_audit_requests.utm_source IS 'First-touch UTM source supplied with the free-audit request.';
COMMENT ON COLUMN public.audit_billing_customers.last_paid_amount_cents IS 'Amount of the latest non-zero invoice confirmed paid by Stripe, in minor currency units.';

-- Reinstall the current event processor with paid-invoice revenue capture.
CREATE OR REPLACE FUNCTION public.process_stripe_billing_event(p_event_id text,p_event_type text,p_event_created bigint,p_object jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE billing public.audit_billing_customers%ROWTYPE; subscription_id text; stripe_status text;
DECLARE pause_until timestamptz; trial_end timestamptz; canceling boolean; next_status text; tenant_status text;
DECLARE paid_amount bigint; paid_at timestamptz; paid_currency text;
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
  paid_amount:=CASE WHEN coalesce(p_object->>'amount_paid','')~'^[0-9]+$' THEN (p_object->>'amount_paid')::bigint ELSE 0 END;
  paid_currency:=CASE WHEN lower(coalesce(p_object->>'currency',''))~'^[a-z]{3}$' THEN lower(p_object->>'currency') ELSE NULL END;
  paid_at:=CASE WHEN coalesce(p_object#>>'{status_transitions,paid_at}','')~'^[0-9]+$'
   THEN to_timestamp((p_object#>>'{status_transitions,paid_at}')::double precision) ELSE to_timestamp(p_event_created) END;
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
  last_paid_amount_cents=CASE WHEN p_event_type='invoice.paid' AND paid_amount>0 THEN paid_amount ELSE last_paid_amount_cents END,
  last_paid_currency=CASE WHEN p_event_type='invoice.paid' AND paid_amount>0 THEN coalesce(paid_currency,last_paid_currency,'usd') ELSE last_paid_currency END,
  last_paid_at=CASE WHEN p_event_type='invoice.paid' AND paid_amount>0 THEN paid_at ELSE last_paid_at END,
  last_paid_invoice_id=CASE WHEN p_event_type='invoice.paid' AND paid_amount>0 THEN left(p_object->>'id',255) ELSE last_paid_invoice_id END,
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

REVOKE ALL ON FUNCTION public.process_stripe_billing_event(text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_billing_event(text,text,bigint,jsonb) TO service_role;
