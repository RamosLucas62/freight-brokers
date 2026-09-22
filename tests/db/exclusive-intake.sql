INSERT INTO public.audit_tenants(id,name,alias,status) VALUES
 ('97000000-0000-4000-8000-000000000001','TMS intake policy','exclusive-tms','active'),
 ('97000000-0000-4000-8000-000000000002','Email intake policy','exclusive-email','active');
INSERT INTO public.audit_inbound_sender_rules(tenant_id,sender_email) VALUES('97000000-0000-4000-8000-000000000001','sender@example.com');
SET LOCAL ROLE service_role;
DO $$ DECLARE c public.audit_tms_connections; i integer; BEGIN
 IF NOT public.email_intake_enabled('97000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'New tenant email disabled'; END IF;
 INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at)
 VALUES('97000000-0000-4000-8000-000000000001','tai','verified','test',now());
 IF NOT public.email_intake_enabled('97000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Paused connection disabled email'; END IF;
 UPDATE public.audit_tms_connections SET sync_enabled=true,intake_validated_at=now(),sync_error='TMS_HTTP_503' WHERE tenant_id='97000000-0000-4000-8000-000000000001';
 IF public.email_intake_enabled('97000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Active TMS allowed email'; END IF;
 IF public.authorize_inbound_processing('97000000-0000-4000-8000-000000000001','sender@example.com') THEN RAISE EXCEPTION 'Queued email authorized while TMS active'; END IF;
 PERFORM public.enqueue_audit_email('exclusive-test', '98000000-0000-4000-8000-000000000001',ARRAY['exclusive-tms','exclusive-email']);
 IF NOT EXISTS(SELECT 1 FROM public.audit_inbound_jobs WHERE tenant_id='97000000-0000-4000-8000-000000000001' AND email_id='98000000-0000-4000-8000-000000000001' AND status='blocked' AND error_code='EMAIL_INTAKE_DISABLED_TMS') THEN RAISE EXCEPTION 'Email not blocked at ingress'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_inbound_jobs WHERE tenant_id='97000000-0000-4000-8000-000000000002' AND email_id='98000000-0000-4000-8000-000000000001' AND status='queued') THEN RAISE EXCEPTION 'Other tenant email blocked'; END IF;
 FOR i IN 1..100 LOOP
  PERFORM public.enqueue_audit_email('suppressed-'||i,gen_random_uuid(),ARRAY['exclusive-tms']);
 END LOOP;
 SELECT * INTO c FROM public.claim_tms_sync();
 IF c.tenant_id IS DISTINCT FROM '97000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'Wrong sync tenant'; END IF;
 PERFORM public.enqueue_tms_documents(c.tenant_id,c.provider,c.connection_version,c.sync_claim,gen_random_uuid(),'record','[{"externalId":"1"}]');
 INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,sync_enabled,intake_validated_at)
 VALUES(c.tenant_id,'mcleod','verified','test',now(),true,now());
 UPDATE public.audit_tms_connections SET sync_enabled=false WHERE tenant_id=c.tenant_id AND provider='tai';
 IF public.email_intake_enabled(c.tenant_id) THEN RAISE EXCEPTION 'Second active connection ignored'; END IF;
 UPDATE public.audit_tms_connections SET status='disconnected',sync_enabled=false,credentials_ciphertext=NULL,verified_at=NULL WHERE tenant_id=c.tenant_id;
 IF NOT public.email_intake_enabled(c.tenant_id) OR NOT public.authorize_inbound_processing(c.tenant_id,'sender@example.com') THEN RAISE EXCEPTION 'Email not restored after last disconnect'; END IF;
 PERFORM public.enqueue_audit_email('restored', '98000000-0000-4000-8000-000000000002',ARRAY['exclusive-tms']);
 IF NOT EXISTS(SELECT 1 FROM public.audit_inbound_jobs WHERE tenant_id=c.tenant_id AND email_id='98000000-0000-4000-8000-000000000002' AND status='queued') THEN RAISE EXCEPTION 'Restored email not queued'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.email_intake_enabled('97000000-0000-4000-8000-000000000001');RAISE EXCEPTION 'Private intake state exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
