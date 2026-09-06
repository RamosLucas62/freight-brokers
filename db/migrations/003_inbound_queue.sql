CREATE TABLE IF NOT EXISTS public.audit_inbound_events (
 event_id text PRIMARY KEY,
 email_id uuid NOT NULL,
 matched_accounts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.audit_inbound_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 email_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','blocked','needs_review','ignored')),
 error_code text,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 UNIQUE (tenant_id,email_id),
 UNIQUE (tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_queue ON public.audit_inbound_jobs(created_at) WHERE status='queued';
CREATE TABLE IF NOT EXISTS public.audit_inbound_attachments (
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 attachment_id uuid NOT NULL,
 filename text NOT NULL,
 storage_path text NOT NULL,
 extraction jsonb,
 PRIMARY KEY (tenant_id,job_id,attachment_id),
 FOREIGN KEY (tenant_id,job_id) REFERENCES public.audit_inbound_jobs(tenant_id,id)
);
ALTER TABLE public.audit_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_inbound_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_inbound_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_inbound_events,public.audit_inbound_jobs,public.audit_inbound_attachments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_inbound_events,public.audit_inbound_jobs,public.audit_inbound_attachments TO service_role;
CREATE OR REPLACE FUNCTION public.enqueue_audit_email(p_event_id text,p_email_id uuid,p_aliases text[])
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.audit_inbound_events(event_id,email_id) VALUES(p_event_id,p_email_id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO public.audit_inbound_jobs(tenant_id,email_id,status,error_code)
 SELECT id,p_email_id,CASE WHEN status='active' THEN 'queued' ELSE 'blocked' END,
 CASE WHEN status='active' THEN NULL ELSE 'ACCOUNT_NOT_ACTIVE' END
 FROM public.audit_tenants WHERE alias=ANY(p_aliases)
 ON CONFLICT (tenant_id,email_id) DO NOTHING;
 SELECT count(*) INTO n FROM public.audit_tenants WHERE alias=ANY(p_aliases);
 UPDATE public.audit_inbound_events SET matched_accounts=n WHERE event_id=p_event_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.claim_audit_email()
RETURNS SETOF public.audit_inbound_jobs LANGUAGE sql SET search_path=public AS $$
 UPDATE public.audit_inbound_jobs SET status='processing',started_at=now(),error_code=NULL
 WHERE id=(SELECT id FROM public.audit_inbound_jobs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.enqueue_audit_email(text,uuid,text[]),public.claim_audit_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_audit_email(text,uuid,text[]),public.claim_audit_email() TO service_role;
