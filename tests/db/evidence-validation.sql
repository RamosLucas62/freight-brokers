INSERT INTO public.audit_tenants(id,name,alias,status) VALUES('99000000-0000-4000-8000-000000000001','Evidence validation','evidence-validation','active');
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,sync_enabled,connection_version)
VALUES('99000000-0000-4000-8000-000000000001','tai','verified','test',now(),true,'99000000-0000-4000-8000-000000000002');
INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,source,tms_provider,tms_connection_version,tms_record_id,tms_documents,status)
VALUES('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',gen_random_uuid(),'tms','tai','99000000-0000-4000-8000-000000000002','1','[]','completed');
DO $$ BEGIN
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF NOT public.email_intake_enabled('99000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Connection without real audit disabled email'; END IF;
 INSERT INTO public.audit_runs(run_id,tenant_id,report) VALUES('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001','{"document_coverage":{"scope":"basic_freight_evidence","validated_invoices":0}}');
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF NOT public.email_intake_enabled('99000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Empty audit disabled email'; END IF;
 UPDATE public.audit_runs SET report='{"document_coverage":{"scope":"basic_freight_evidence","validated_invoices":1}}' WHERE run_id='99000000-0000-4000-8000-000000000003';
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF public.email_intake_enabled('99000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Validated intake did not disable email'; END IF;
 UPDATE public.audit_tms_connections SET connection_version=gen_random_uuid() WHERE tenant_id='99000000-0000-4000-8000-000000000001';
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF NOT public.email_intake_enabled('99000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Stale job validated replaced connection'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');RAISE EXCEPTION 'Customer can forge validation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
