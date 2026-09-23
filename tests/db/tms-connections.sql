INSERT INTO public.audit_tenants(id,name,alias,status) VALUES
 ('81000000-0000-4000-8000-000000000001','TMS first','tms-first','active'),
 ('81000000-0000-4000-8000-000000000002','TMS second','tms-second','active');
SET LOCAL ROLE service_role;
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,requested_at) VALUES
 ('81000000-0000-4000-8000-000000000001','turvo','requested',now()),
 ('81000000-0000-4000-8000-000000000002','turvo','requested',now());
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at) VALUES
 ('81000000-0000-4000-8000-000000000001','tai','verified','encrypted-test',now());
DO $$ BEGIN
 BEGIN
  INSERT INTO public.audit_tms_connections(tenant_id,provider,status) VALUES ('81000000-0000-4000-8000-000000000002','tai','verified');
  RAISE EXCEPTION 'Verified state accepted without credentials';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at) VALUES ('81000000-0000-4000-8000-000000000002','mercurygate','verified','secret',now());
  RAISE EXCEPTION 'Assisted provider marked verified';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.audit_tms_connections SET status='disconnected',credentials_ciphertext=NULL,verified_at=NULL
 WHERE tenant_id='81000000-0000-4000-8000-000000000001' AND provider='tai';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.audit_tms_connections WHERE provider='turvo' AND status='requested')<>2
 THEN RAISE EXCEPTION 'Unrelated connections changed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.audit_tms_connections;
  RAISE EXCEPTION 'Credentials readable by authenticated';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.audit_tms_connections SET status='disconnected';
  RAISE EXCEPTION 'Client could mutate connections';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.audit_tms_connections;
  RAISE EXCEPTION 'Credentials readable by anon';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.audit_billing_customers(tenant_id,billing_email) VALUES
 ('81000000-0000-4000-8000-000000000001','tms-test@example.com');
INSERT INTO public.audit_rose_connections(org_id,tenant_id,enabled,credentials_ciphertext,connection_state,connected_at) VALUES
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',true,'encrypted','connected',now());
UPDATE public.audit_tms_connections SET status='verified',credentials_ciphertext='encrypted',verified_at=now()
 WHERE tenant_id='81000000-0000-4000-8000-000000000001' AND provider='tai';
SET LOCAL ROLE service_role;
UPDATE public.audit_billing_customers SET deletion_completed_at=now() WHERE tenant_id='81000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id='81000000-0000-4000-8000-000000000001' AND (credentials_ciphertext IS NOT NULL OR status<>'disconnected'))
 THEN RAISE EXCEPTION 'Account erasure retained TMS credentials'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_rose_connections WHERE tenant_id='81000000-0000-4000-8000-000000000001' AND (credentials_ciphertext IS NOT NULL OR enabled))
 THEN RAISE EXCEPTION 'Account erasure retained Rose credentials'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id='81000000-0000-4000-8000-000000000002' AND status='requested')
 THEN RAISE EXCEPTION 'Account erasure affected another company'; END IF;
END $$;
RESET ROLE;
