-- Portal list screens always filter by tenant and then sort by created_at.
-- Keep these covering indexes aligned with the query shape used by the portal.
CREATE INDEX IF NOT EXISTS idx_inbound_jobs_portal_tenant_created
 ON public.audit_inbound_jobs(tenant_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_invoices_portal_tenant_created
 ON public.invoices(tenant_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_audit_runs_portal_tenant_created
 ON public.audit_runs(tenant_id, created_at DESC, run_id);

CREATE INDEX IF NOT EXISTS idx_exceptions_portal_tenant_created
 ON public.exceptions(tenant_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_job_reviews_portal_tenant_created
 ON public.audit_job_reviews(tenant_id, created_at DESC, id);
