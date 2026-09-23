ALTER TABLE public.audit_inbound_attachments DROP CONSTRAINT IF EXISTS audit_inbound_attachments_document_type_check;
ALTER TABLE public.audit_inbound_attachments ADD CONSTRAINT audit_inbound_attachments_document_type_check
 CHECK(document_type IS NULL OR document_type IN ('invoice','pod','rate_confirmation','accessorial_evidence'));
