INSERT INTO public.audit_tenants(id,name,alias,status) VALUES('99000000-0000-4000-8000-000000000001','Evidence validation','evidence-validation','active');
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,sync_enabled,connection_version,sync_claim)
VALUES('99000000-0000-4000-8000-000000000001','tai','verified','test',now(),true,'99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000009');
INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,source,tms_provider,tms_connection_version,tms_record_id,tms_documents,status,result)
VALUES('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004','tms','tai','99000000-0000-4000-8000-000000000002','1','[]','completed','{"document_coverage":{"scope":"basic_freight_evidence","validated_invoices":1}}');
DO $$ DECLARE tenant uuid:='99000000-0000-4000-8000-000000000001';ver uuid:='99000000-0000-4000-8000-000000000002';lease uuid:='99000000-0000-4000-8000-000000000009'; BEGIN
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Single audit without completed discovery disabled email'; END IF;
 -- A discovered load with no files must not disappear from the coverage decision.
 PERFORM public.finish_tms_coverage(tenant,'tai',ver,lease,NULL,'[{"record":"1","batch":"99000000-0000-4000-8000-000000000004"},{"record":"2","batch":null}]');
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Missing documents disabled email'; END IF;
 UPDATE public.audit_tms_connections SET sync_claim=lease WHERE tenant_id=tenant;
 INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,source,tms_provider,tms_connection_version,tms_record_id,tms_documents,status)
 VALUES('99000000-0000-4000-8000-000000000005',tenant,'99000000-0000-4000-8000-000000000006','tms','tai',ver,'2','[]','needs_review');
 PERFORM public.finish_tms_coverage(tenant,'tai',ver,lease,NULL,'[{"record":"1","batch":"99000000-0000-4000-8000-000000000004"},{"record":"2","batch":"99000000-0000-4000-8000-000000000006"}]');
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'One passed audit hid an incomplete load'; END IF;
 UPDATE public.audit_inbound_jobs SET status='completed',result='{"document_coverage":{"scope":"basic_freight_evidence","validated_invoices":0}}' WHERE id='99000000-0000-4000-8000-000000000005';
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000005');
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Empty audit validated a load'; END IF;
 UPDATE public.audit_inbound_jobs SET result='{"document_coverage":{"scope":"basic_freight_evidence","validated_invoices":1}}' WHERE id='99000000-0000-4000-8000-000000000005';
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000005');
 IF public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Complete discovery and evidence did not disable email'; END IF;
 INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,sync_enabled) VALUES(tenant,'mcleod','verified','test',now(),true);
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Unvalidated second connection was ignored'; END IF;
 UPDATE public.audit_tms_connections SET sync_enabled=false WHERE tenant_id=tenant AND provider='mcleod';
 IF public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Paused connection counted as pending'; END IF;
 UPDATE public.audit_tms_connections SET connection_version=gen_random_uuid() WHERE tenant_id=tenant AND provider='tai';
 PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');
 IF NOT public.email_intake_enabled(tenant) THEN RAISE EXCEPTION 'Stale snapshot validated replaced credentials'; END IF;
 BEGIN PERFORM public.finish_tms_coverage(tenant,'tai',ver,lease,NULL,'[]');RAISE EXCEPTION 'Stale lease changed coverage';EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'TMS_CONNECTION_CHANGED' THEN RAISE; END IF;END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.validate_tms_document_intake('99000000-0000-4000-8000-000000000003');RAISE EXCEPTION 'Customer can forge validation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.refresh_tms_intake('99000000-0000-4000-8000-000000000001');RAISE EXCEPTION 'Customer can forge coverage';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
