-- Always executed inside --check transaction, then rolled back.
INSERT INTO public.audit_tenants(id,name,alias,status) VALUES
 ('10000000-0000-4000-8000-000000000001','Isolation A','isolation-check-a','active'),
 ('10000000-0000-4000-8000-000000000002','Isolation B','isolation-check-b','paused');
INSERT INTO auth.users(id) VALUES ('20000000-0000-4000-8000-000000000001');
INSERT INTO public.audit_memberships VALUES ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO public.invoices(id,tenant_id,source_file,numero_fatura,document_hash) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test-a.pdf','TEST','same-hash'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','test-b.pdf','TEST','same-hash');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.invoices) <> 1 THEN RAISE EXCEPTION 'RLS invoice isolation failed'; END IF;
 IF (SELECT count(*) FROM public.audit_tenants) <> 1 THEN RAISE EXCEPTION 'RLS tenant isolation failed'; END IF;
 BEGIN
  UPDATE public.audit_tenants SET status='active';
  RAISE EXCEPTION 'Unauthorized status write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN
 INSERT INTO public.exceptions(tenant_id,invoice_id,tipo_regra,descricao,source_file)
 VALUES ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','TEST','test','test');
 RAISE EXCEPTION 'Foreign exception allowed';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
 PERFORM public.commit_audit('10000000-0000-4000-8000-000000000002','[]','[]','{}',ARRAY[]::uuid[]);
 RAISE EXCEPTION 'Paused account accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Audit account is not active' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.commit_audit('10000000-0000-4000-8000-000000000001','[{"tenant_id":"10000000-0000-4000-8000-000000000002"}]','[]','{"tenant_id":"10000000-0000-4000-8000-000000000001"}',ARRAY[]::uuid[]);
 RAISE EXCEPTION 'Cross-account write accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Cross-account audit rejected' THEN RAISE; END IF; END;
END $$;
SET LOCAL ROLE service_role;
SELECT public.commit_audit(
 '10000000-0000-4000-8000-000000000001',
 '[{"id":"30000000-0000-4000-8000-000000000003","tenant_id":"10000000-0000-4000-8000-000000000001","source_file":"new.pdf","numero_fatura":"NEW","created_at":"2026-09-06T00:00:00Z"}]',
 '[{"invoice_id":"30000000-0000-4000-8000-000000000003","tipo_regra":"TEST","descricao":"test","source_file":"new.pdf"}]',
 '{"run_id":"40000000-0000-4000-8000-000000000001","tenant_id":"10000000-0000-4000-8000-000000000001","exceptions":[]}',
 ARRAY['30000000-0000-4000-8000-000000000001']::uuid[]);
RESET ROLE;
INSERT INTO public.audit_report_contacts(tenant_id,email,verified_at) VALUES
 ('10000000-0000-4000-8000-000000000001','a@example.com',now()),
 ('10000000-0000-4000-8000-000000000002','b@example.com',now());
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.audit_report_contacts)<>1 THEN RAISE EXCEPTION 'Contact isolation failed'; END IF;
 IF (SELECT count(*) FROM public.audit_runs)<>1 THEN RAISE EXCEPTION 'Report visibility failed'; END IF;
 IF (SELECT count(*) FROM public.exceptions)<>1 THEN RAISE EXCEPTION 'Exception visibility failed'; END IF;
END $$;
RESET ROLE;
