ALTER TABLE public.audit_inbound_attachments
 ADD COLUMN IF NOT EXISTS document_type text;
ALTER TABLE public.audit_inbound_attachments DROP CONSTRAINT IF EXISTS audit_inbound_attachments_document_type_check;
ALTER TABLE public.audit_inbound_attachments ADD CONSTRAINT audit_inbound_attachments_document_type_check
 CHECK(document_type IS NULL OR document_type IN ('invoice','pod','rate_confirmation'));
CREATE INDEX IF NOT EXISTS idx_audit_inbound_document_type ON public.audit_inbound_attachments(tenant_id,job_id,document_type);
