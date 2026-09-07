DO $$
DECLARE tenant uuid:='00000000-0000-4000-8000-000000000001'; job uuid:='71000000-0000-4000-8000-000000000001'; attachment uuid:='72000000-0000-4000-8000-000000000001'; recorded boolean;
BEGIN
 INSERT INTO public.audit_inbound_jobs(id,tenant_id,email_id,status) VALUES(job,tenant,'73000000-0000-4000-8000-000000000001','completed') ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_inbound_attachments(tenant_id,job_id,attachment_id,filename,storage_path) VALUES(tenant,job,attachment,'invoice.pdf','test/invoice.pdf') ON CONFLICT DO NOTHING;
 SELECT public.record_billable_invoice(tenant,job,attachment,repeat('a',64)) INTO recorded;
 IF NOT recorded THEN RAISE EXCEPTION 'First accepted document was not counted'; END IF;
 SELECT public.record_billable_invoice(tenant,job,attachment,repeat('a',64)) INTO recorded;
 IF recorded OR (SELECT count(*) FROM public.audit_invoice_usage WHERE tenant_id=tenant AND document_hash=repeat('a',64))<>1 THEN RAISE EXCEPTION 'Repeated hash counted twice'; END IF;
 UPDATE public.audit_billing_customers SET plan_code='scale',billing_period='annual',included_invoices=1500,overage_unit_amount_cents=50 WHERE tenant_id=tenant;
 IF NOT EXISTS(SELECT 1 FROM public.audit_billing_customers WHERE tenant_id=tenant AND included_invoices=1500 AND overage_unit_amount_cents=50) THEN RAISE EXCEPTION 'Scale allowance not saved'; END IF;
END $$;
