CREATE TABLE public.audit_job_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 job_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK (action IN ('review','retry')),
 note text NOT NULL CHECK (length(trim(note)) BETWEEN 5 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,job_id) REFERENCES public.audit_inbound_jobs(tenant_id,id)
);
CREATE INDEX ON public.audit_job_reviews(tenant_id,created_at DESC);
ALTER TABLE public.audit_job_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_job_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.audit_job_reviews TO service_role;
CREATE OR REPLACE FUNCTION public.portal_job_action(p_user uuid,p_tenant uuid,p_job uuid,p_action text,p_note text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_status text; account_status text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN
 RAISE EXCEPTION 'Membership required'; END IF;
 SELECT status INTO account_status FROM public.audit_tenants WHERE id=p_tenant FOR UPDATE;
 SELECT status INTO current_status FROM public.audit_inbound_jobs WHERE id=p_job AND tenant_id=p_tenant FOR UPDATE;
 IF current_status IS NULL OR current_status NOT IN ('needs_review','blocked','completed','ignored') THEN
 RAISE EXCEPTION 'Job cannot be changed'; END IF;
 IF p_action='retry' THEN
 IF account_status<>'active' OR current_status NOT IN ('needs_review','blocked') THEN RAISE EXCEPTION 'Retry not allowed'; END IF;
 UPDATE public.audit_inbound_jobs SET status='queued',error_code=NULL,started_at=NULL,finished_at=NULL WHERE id=p_job AND tenant_id=p_tenant;
 ELSIF p_action<>'review' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 -- Notes are audit records; acknowledging a case never erases detected exceptions.
 INSERT INTO public.audit_job_reviews(tenant_id,job_id,user_id,action,note) VALUES(p_tenant,p_job,p_user,p_action,p_note);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_job_action(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_job_action(uuid,uuid,uuid,text,text) TO service_role;
