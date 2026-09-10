-- Runs last in the isolated transaction and validates optional MFA, pending recipients,
-- sender authorization, quotas and the durable Stripe queue.
DO $$ BEGIN
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.portal_onboarding_user_id(text)'::regprocedure) THEN RAISE EXCEPTION 'Onboarding identity lookup cannot read Auth identities'; END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.secure_onboarding_owner(uuid,uuid)'::regprocedure) THEN RAISE EXCEPTION 'Onboarding owner assignment cannot verify Auth identities'; END IF;
END $$;
UPDATE public.audit_memberships SET role='owner' WHERE tenant_id='10000000-0000-4000-8000-000000000001' AND user_id='20000000-0000-4000-8000-000000000001';
INSERT INTO public.audit_portal_users(user_id,enabled,guide_completed_at)
VALUES('20000000-0000-4000-8000-000000000001',true,NULL)
ON CONFLICT(user_id) DO UPDATE SET enabled=true,guide_completed_at=NULL;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.aal','aal1',true);
SELECT public.portal_save_security_settings('10000000-0000-4000-8000-000000000001','America/Chicago','[{"email":"pending@example.com","token_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]','{owner@example.com}','iphash');
SELECT public.portal_complete_guide();
RESET ROLE;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_portal_users WHERE user_id='20000000-0000-4000-8000-000000000001' AND guide_completed_at IS NOT NULL) THEN RAISE EXCEPTION 'First-login guide completion was not saved'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_report_contacts WHERE email='pending@example.com' AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'New report recipient bypassed confirmation'; END IF;
 IF NOT public.authorize_inbound_processing('10000000-0000-4000-8000-000000000001','owner@example.com') THEN RAISE EXCEPTION 'Authorized sender rejected'; END IF;
 IF public.authorize_inbound_processing('10000000-0000-4000-8000-000000000001','attacker@example.com') THEN RAISE EXCEPTION 'Unknown sender accepted'; END IF;
 PERFORM public.confirm_report_contact('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
 IF NOT EXISTS(SELECT 1 FROM public.audit_report_contacts WHERE email='pending@example.com' AND verified_at IS NOT NULL AND verification_token_hash IS NULL) THEN RAISE EXCEPTION 'Contact confirmation failed'; END IF;
 IF NOT public.enqueue_stripe_webhook('evt_queue_1','invoice.paid',100,'{"id":"evt_queue_1","type":"invoice.paid","data":{"object":{"subscription":"sub"}}}') THEN RAISE EXCEPTION 'Stripe event not queued'; END IF;
 IF public.enqueue_stripe_webhook('evt_queue_1','invoice.paid',100,'{}') THEN RAISE EXCEPTION 'Duplicate Stripe event queued'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.claim_stripe_webhook() WHERE event_id='evt_queue_1' AND status='processing') THEN RAISE EXCEPTION 'Stripe queue claim failed'; END IF;
 PERFORM public.finish_stripe_webhook('evt_queue_1',true,NULL);
 IF (SELECT status FROM public.audit_stripe_webhook_queue WHERE event_id='evt_queue_1')<>'completed' THEN RAISE EXCEPTION 'Stripe queue completion failed'; END IF;
END $$;
