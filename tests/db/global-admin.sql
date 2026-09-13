-- Run after the customer portal tests, within a transaction that is rolled back.
UPDATE auth.users SET email='admin-check-owner@example.com' WHERE id='20000000-0000-4000-8000-000000000001';
INSERT INTO auth.users(id,email) VALUES ('20000000-0000-4000-8000-000000000002','admin-check-customer@example.com'),('20000000-0000-4000-8000-000000000003','admin-check-second@example.com');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM auth.users LIMIT 1;
  RAISE EXCEPTION 'service_role unexpectedly has direct auth.users access';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.audit_admins) THEN
 INSERT INTO public.audit_admins(user_id) VALUES('20000000-0000-4000-8000-000000000001');
 ELSE PERFORM public.portal_bootstrap_admin('admin-check-owner@example.com'); END IF;
END $$;
DO $$ DECLARE owner_id uuid:='20000000-0000-4000-8000-000000000001'; customer_id uuid:='20000000-0000-4000-8000-000000000002'; second_id uuid:='20000000-0000-4000-8000-000000000003'; company_id uuid; result jsonb; baseline integer;
BEGIN
 baseline:=(public.portal_admin_users(owner_id,0)->>'total')::integer;
 BEGIN PERFORM public.portal_bootstrap_admin('admin-check-second@example.com'); RAISE EXCEPTION 'Second bootstrap allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'An administrator already exists' THEN RAISE; END IF; END;
 BEGIN PERFORM public.portal_admin_action(customer_id,'company.create','{"name":"Attack","alias":"attack"}'); RAISE EXCEPTION 'Customer became admin';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Admin access required' THEN RAISE; END IF; END;
 result:=public.portal_admin_action(owner_id,'company.create','{"name":"Admin test client","alias":"admin-check-client"}');
 company_id:=(result->>'company_id')::uuid;
 IF (SELECT status FROM public.audit_tenants WHERE id=company_id)<>'inactive' THEN RAISE EXCEPTION 'New company should start inactive'; END IF;
 PERFORM public.portal_admin_action(owner_id,'company.update',jsonb_build_object('id',company_id,'name','Updated client','status','active'));
 PERFORM public.portal_admin_action(owner_id,'user.register',jsonb_build_object('user_id',customer_id,'company_id',company_id));
 IF NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE user_id=customer_id AND tenant_id=company_id) THEN RAISE EXCEPTION 'Membership missing'; END IF;
 IF public.portal_admin_find_user(owner_id,'ADMIN-CHECK-CUSTOMER@example.com')<>customer_id THEN RAISE EXCEPTION 'Email lookup failed'; END IF;
 IF (public.portal_admin_users(owner_id,0)->>'total')::integer<>baseline+1 THEN RAISE EXCEPTION 'Unrelated Auth users leaked'; END IF;
 PERFORM public.portal_admin_action(owner_id,'membership.remove',jsonb_build_object('user_id',customer_id,'company_id',company_id));
 IF EXISTS(SELECT 1 FROM public.audit_memberships WHERE user_id=customer_id AND tenant_id=company_id) THEN RAISE EXCEPTION 'Revoked membership survived'; END IF;
 PERFORM public.portal_admin_action(owner_id,'user.role',jsonb_build_object('user_id',second_id,'role','admin'));
 PERFORM public.portal_admin_action(owner_id,'user.enable',jsonb_build_object('user_id',second_id,'enabled',false));
 BEGIN PERFORM public.portal_admin_users(second_id,0); RAISE EXCEPTION 'Disabled admin accessed users';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Admin access required' THEN RAISE; END IF; END;
 BEGIN PERFORM public.portal_admin_action(owner_id,'user.role',jsonb_build_object('user_id',owner_id,'role','customer')); RAISE EXCEPTION 'Self-demotion allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Cannot remove your own admin role' THEN RAISE; END IF; END;
 BEGIN PERFORM public.portal_admin_action(owner_id,'user.enable',jsonb_build_object('user_id',owner_id,'enabled',false)); RAISE EXCEPTION 'Self-disable allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Cannot disable yourself' THEN RAISE; END IF; END;
 INSERT INTO public.audit_billing_customers(tenant_id,billing_email,plan_code,included_invoices,overage_unit_amount_cents) VALUES(company_id,'admin-check-customer@example.com','growth',1500,50);
 INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,status) VALUES('50000000-0000-4000-8000-000000000002',company_id,gen_random_uuid(),'needs_review');
 PERFORM public.portal_job_action(owner_id,company_id,'50000000-0000-4000-8000-000000000002','retry','Administrator verified document');
 IF NOT EXISTS(SELECT 1 FROM public.audit_job_reviews WHERE job_id='50000000-0000-4000-8000-000000000002' AND actor_role='admin' AND actor_email='admin-check-owner@example.com' AND user_id=owner_id) THEN RAISE EXCEPTION 'Admin attribution missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_admin_activity WHERE action='job.retry' AND tenant_id=company_id AND actor_id=owner_id) THEN RAISE EXCEPTION 'Admin activity missing'; END IF;
 PERFORM public.portal_admin_action(owner_id,'membership.add',jsonb_build_object('user_id',customer_id,'company_id',company_id));
 PERFORM public.portal_admin_action(owner_id,'user.enable',jsonb_build_object('user_id',customer_id,'enabled',false));
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.audit_tenants)<>0 THEN RAISE EXCEPTION 'Disabled customer bypassed RLS'; END IF;
 IF (SELECT count(*) FROM public.audit_memberships)<>0 THEN RAISE EXCEPTION 'Disabled membership remains visible'; END IF;
 BEGIN PERFORM public.portal_admin_action('20000000-0000-4000-8000-000000000001','company.create','{}'); RAISE EXCEPTION 'Customer spoofed admin actor';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.audit_admins(user_id) VALUES('20000000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'Self-assigned admin';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
