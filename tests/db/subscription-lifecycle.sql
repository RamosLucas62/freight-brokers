DO $$
DECLARE tenant uuid:='00000000-0000-4000-8000-000000000001'; result boolean;
BEGIN
 INSERT INTO public.audit_billing_customers(tenant_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,billing_email,status)
 VALUES(tenant,'cus_lifecycle','sub_lifecycle','cs_lifecycle','billing@example.com','active')
 ON CONFLICT(tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET stripe_subscription_id='sub_lifecycle',billing_email='billing@example.com',status='active',last_stripe_event_created=0;

 PERFORM public.sync_onboarding_billing_state('cs_lifecycle','sub_lifecycle','trialing',to_timestamp(1893456000));
 IF (SELECT status FROM public.audit_billing_customers WHERE tenant_id=tenant)<>'trialing' THEN RAISE EXCEPTION 'Onboarding did not save trial state'; END IF;
 PERFORM public.process_stripe_billing_event('evt_trial','customer.subscription.updated',99,'{"id":"sub_lifecycle","status":"trialing","trial_end":1893456000}');
 IF (SELECT status FROM public.audit_billing_customers WHERE tenant_id=tenant)<>'trialing' OR
    (SELECT trial_ends_at FROM public.audit_billing_customers WHERE tenant_id=tenant) IS NULL OR
    (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'active' THEN RAISE EXCEPTION 'Trial did not activate tenant'; END IF;

 PERFORM public.process_stripe_billing_event('evt_checkout_invite','checkout.session.completed',99,'{"id":"cs_invite","customer":"cus_invite","subscription":"sub_invite","payment_status":"no_payment_required","customer_details":{"email":"invite@example.com"}}');
 IF NOT EXISTS(SELECT 1 FROM public.claim_checkout_onboarding_invite() WHERE checkout_session_id='cs_invite' AND email='invite@example.com') THEN RAISE EXCEPTION 'Checkout onboarding invitation was not queued'; END IF;
 PERFORM public.finish_checkout_onboarding_invite('cs_invite',true,NULL);
 IF NOT EXISTS(SELECT 1 FROM public.audit_checkout_onboarding_invites WHERE checkout_session_id='cs_invite' AND status='completed' AND sent_at IS NOT NULL) THEN RAISE EXCEPTION 'Checkout onboarding invitation was not completed'; END IF;

 SELECT public.process_stripe_billing_event('evt_failed','invoice.payment_failed',100,'{"subscription":"sub_lifecycle"}') INTO result;
 IF NOT result OR (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'active' OR NOT EXISTS(SELECT 1 FROM public.audit_billing_customers WHERE tenant_id=tenant AND status='past_due' AND payment_grace_until>now()+interval '71 hours') THEN RAISE EXCEPTION 'Payment failure did not start grace period'; END IF;
 UPDATE public.audit_billing_customers SET payment_grace_until=now()-interval '1 minute' WHERE tenant_id=tenant;
 PERFORM public.suspend_expired_payment_grace();
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'paused' THEN RAISE EXCEPTION 'Expired grace did not pause tenant'; END IF;
 SELECT public.process_stripe_billing_event('evt_paid','invoice.paid',101,'{"subscription":"sub_lifecycle"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'active' THEN RAISE EXCEPTION 'Paid invoice did not reactivate tenant'; END IF;
 SELECT public.process_stripe_billing_event('evt_paid','invoice.paid',101,'{"subscription":"sub_lifecycle"}') INTO result;
 IF result THEN RAISE EXCEPTION 'Duplicate Stripe event was not ignored'; END IF;
 SELECT public.process_stripe_billing_event('evt_paid_parent','invoice.paid',102,'{"parent":{"subscription_details":{"subscription":"sub_lifecycle"}}}') INTO result;
 IF NOT result OR (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'active' THEN RAISE EXCEPTION 'Modern invoice subscription reference was not processed'; END IF;
 SELECT public.process_stripe_billing_event('evt_deleted','customer.subscription.deleted',103,'{"id":"sub_lifecycle","status":"canceled"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'inactive' OR NOT EXISTS(SELECT 1 FROM public.audit_data_deletions WHERE tenant_id=tenant AND scheduled_for>now()+interval '29 days') THEN
  RAISE EXCEPTION 'Cancellation did not inactivate tenant and schedule deletion';
 END IF;
 SELECT public.process_stripe_billing_event('evt_late_paid','invoice.paid',104,'{"subscription":"sub_lifecycle"}') INTO result;
 IF (SELECT status FROM public.audit_tenants WHERE id=tenant)<>'inactive' THEN RAISE EXCEPTION 'Terminal cancellation was reactivated'; END IF;
END $$;
