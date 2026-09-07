DO $$
DECLARE tenant uuid:='00000000-0000-4000-8000-000000000001'; result boolean;
BEGIN
 INSERT INTO public.audit_billing_customers(tenant_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,billing_email,status)
 VALUES(tenant,'cus_lifecycle','sub_lifecycle','cs_lifecycle','billing@example.com','active')
 ON CONFLICT(tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET stripe_subscription_id='sub_lifecycle',billing_email='billing@example.com',status='active',last_stripe_event_created=0;

 SELECT public.process_stripe_billing_event('evt_failed','invoice.payment_failed',100,'{"subscription":"sub_lifecycle"}') INTO result;
 IF NOT result OR (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'paused' THEN RAISE EXCEPTION 'Payment failure did not pause tenant'; END IF;
 SELECT public.process_stripe_billing_event('evt_paid','invoice.paid',101,'{"subscription":"sub_lifecycle"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'active' THEN RAISE EXCEPTION 'Paid invoice did not reactivate tenant'; END IF;
 SELECT public.process_stripe_billing_event('evt_paid','invoice.paid',101,'{"subscription":"sub_lifecycle"}') INTO result;
 IF result THEN RAISE EXCEPTION 'Duplicate Stripe event was not ignored'; END IF;
 SELECT public.process_stripe_billing_event('evt_deleted','customer.subscription.deleted',102,'{"id":"sub_lifecycle","status":"canceled"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'inactive' OR NOT EXISTS(SELECT 1 FROM public.audit_data_deletions WHERE tenant_id=tenant AND scheduled_for>now()+interval '29 days') THEN
  RAISE EXCEPTION 'Cancellation did not inactivate tenant and schedule deletion';
 END IF;
 SELECT public.process_stripe_billing_event('evt_late_paid','invoice.paid',103,'{"subscription":"sub_lifecycle"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'inactive' THEN RAISE EXCEPTION 'Terminal cancellation was reactivated'; END IF;
END $$;
