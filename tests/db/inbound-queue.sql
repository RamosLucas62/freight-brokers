INSERT INTO public.audit_tenants(id,name,alias,status) VALUES
 ('51000000-0000-4000-8000-000000000001','Queue A','queue-a','active'),
 ('51000000-0000-4000-8000-000000000002','Queue B','queue-b','paused');
SET LOCAL ROLE service_role;
SELECT public.enqueue_audit_email('queue-event','52000000-0000-4000-8000-000000000001',ARRAY['queue-a','queue-b','unknown']);
SELECT public.enqueue_audit_email('queue-event','52000000-0000-4000-8000-000000000001',ARRAY['queue-a','queue-b']);
SELECT public.enqueue_audit_email('queue-event-redelivery','52000000-0000-4000-8000-000000000001',ARRAY['queue-a','queue-b']);
DO $$ DECLARE job public.audit_inbound_jobs; BEGIN
 IF (SELECT count(*) FROM public.audit_inbound_jobs)<>2 THEN RAISE EXCEPTION 'Duplicate jobs created';END IF;
 SELECT * INTO job FROM public.claim_audit_email();
 IF job.tenant_id IS DISTINCT FROM '51000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'Wrong tenant claimed';END IF;
 IF EXISTS(SELECT 1 FROM public.claim_audit_email()) THEN RAISE EXCEPTION 'Processing or paused job reclaimed';END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
 PERFORM public.enqueue_audit_email('forged','52000000-0000-4000-8000-000000000001',ARRAY['queue-a']);
 RAISE EXCEPTION 'Public enqueue allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
