-- Exercise the Rose Rocket inbox against a disposable PostgreSQL database.
INSERT INTO public.audit_tenants(id,name,alias,status) VALUES
 ('71000000-0000-4000-8000-000000000001','Rose test active','rose-test-active','active'),
 ('71000000-0000-4000-8000-000000000002','Rose test paused','rose-test-paused','paused');
INSERT INTO public.audit_rose_connections(org_id,tenant_id,enabled) VALUES
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',true),
 ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002',true);

SET LOCAL ROLE service_role;
DO $$ DECLARE result text; job public.audit_rose_events; BEGIN
 SELECT public.enqueue_rose_order_event(
  '72000000-0000-4000-8000-000000000003',
  '73000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',now()) INTO result;
 IF result <> 'not_connected' THEN RAISE EXCEPTION 'Unknown organization accepted'; END IF;

 SELECT public.enqueue_rose_order_event(
  '72000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000001',now()) INTO result;
 IF result <> 'not_connected' THEN RAISE EXCEPTION 'Paused tenant accepted'; END IF;

 SELECT public.enqueue_rose_order_event(
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000001',now()) INTO result;
 IF result <> 'queued' THEN RAISE EXCEPTION 'Active organization not queued'; END IF;

 SELECT public.enqueue_rose_order_event(
  '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000001',now()) INTO result;
 IF result <> 'duplicate' THEN RAISE EXCEPTION 'Duplicate event not deduplicated'; END IF;
 IF (SELECT count(*) FROM public.audit_rose_events WHERE org_id='72000000-0000-4000-8000-000000000001')<>1
 THEN RAISE EXCEPTION 'Duplicate event stored'; END IF;

 SELECT * INTO job FROM public.claim_rose_order_event();
 IF job.tenant_id IS DISTINCT FROM '71000000-0000-4000-8000-000000000001'::uuid
  OR job.status IS DISTINCT FROM 'processing' OR job.attempts IS DISTINCT FROM 1
 THEN RAISE EXCEPTION 'Wrong Rose event claimed'; END IF;
 IF EXISTS(SELECT 1 FROM public.claim_rose_order_event()) THEN RAISE EXCEPTION 'Rose event claimed twice'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM credentials_ciphertext FROM public.audit_rose_connections LIMIT 1;
  RAISE EXCEPTION 'Public Rose credentials readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.enqueue_rose_order_event(
   '72000000-0000-4000-8000-000000000001',
   '73000000-0000-4000-8000-000000000004',
   '74000000-0000-4000-8000-000000000001',now());
  RAISE EXCEPTION 'Public Rose enqueue allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
