-- Run after tenant-isolation.sql in the --check transaction; never persists.
INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,status) VALUES
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'needs_review');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','retry','Reviewed document');
 RAISE EXCEPTION 'Direct customer mutation allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','retry','Reviewed document');
 RAISE EXCEPTION 'Cross-company action allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Membership required' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','retry','');
 RAISE EXCEPTION 'Empty note accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT status FROM public.audit_inbound_jobs WHERE id='50000000-0000-4000-8000-000000000001') <> 'needs_review' THEN RAISE EXCEPTION 'Failed action was not atomic'; END IF;
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','review','Reviewed document');
 IF (SELECT status FROM public.audit_inbound_jobs WHERE id='50000000-0000-4000-8000-000000000001') <> 'needs_review' THEN RAISE EXCEPTION 'Review changed status'; END IF;
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','retry','Reviewed document');
 IF (SELECT status FROM public.audit_inbound_jobs WHERE id='50000000-0000-4000-8000-000000000001') <> 'queued' THEN RAISE EXCEPTION 'Requeue failed'; END IF;
 BEGIN
 PERFORM public.portal_job_action('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','retry','Reviewed document');
 RAISE EXCEPTION 'Repeated retry allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Job cannot be changed' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.audit_job_reviews WHERE job_id='50000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'Review history is incomplete'; END IF;
END $$;
RESET ROLE;
