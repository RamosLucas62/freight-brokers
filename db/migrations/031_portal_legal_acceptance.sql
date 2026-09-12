-- Versioned clickwrap evidence collected after the customer's first authenticated portal login.
CREATE TABLE IF NOT EXISTS public.audit_portal_legal_acceptances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 terms_version text NOT NULL,
 privacy_version text NOT NULL,
 acceptance_text text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 ip_address text NOT NULL,
 user_agent text NOT NULL,
 UNIQUE(user_id,terms_version,privacy_version)
);

ALTER TABLE public.audit_portal_legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_portal_legal_acceptances FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.audit_portal_legal_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.protect_portal_legal_acceptance()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 RAISE EXCEPTION 'Portal legal acceptance records are immutable';
END $$;

DROP TRIGGER IF EXISTS protect_portal_legal_acceptance ON public.audit_portal_legal_acceptances;
CREATE TRIGGER protect_portal_legal_acceptance
 BEFORE UPDATE OR DELETE ON public.audit_portal_legal_acceptances
 FOR EACH ROW EXECUTE FUNCTION public.protect_portal_legal_acceptance();

CREATE OR REPLACE FUNCTION public.record_portal_legal_acceptance(
 p_user uuid,p_terms_version text,p_privacy_version text,p_acceptance_text text,p_ip_address text,p_user_agent text
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE accepted timestamptz;
BEGIN
 IF p_user IS NULL OR NOT EXISTS(SELECT 1 FROM public.audit_portal_users WHERE user_id=p_user AND enabled) THEN
  RAISE EXCEPTION 'Active portal user required';
 END IF;
 IF length(trim(p_terms_version))<1 OR length(trim(p_privacy_version))<1 OR length(p_acceptance_text)<80 THEN
  RAISE EXCEPTION 'Invalid legal acceptance';
 END IF;
 INSERT INTO public.audit_portal_legal_acceptances(user_id,terms_version,privacy_version,acceptance_text,ip_address,user_agent)
 VALUES(p_user,left(p_terms_version,40),left(p_privacy_version,40),left(p_acceptance_text,2000),left(coalesce(p_ip_address,'unknown'),128),left(coalesce(p_user_agent,'unknown'),1000))
 ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT accepted_at INTO accepted FROM public.audit_portal_legal_acceptances
  WHERE user_id=p_user AND terms_version=left(p_terms_version,40) AND privacy_version=left(p_privacy_version,40);
 RETURN accepted;
END $$;

REVOKE ALL ON FUNCTION public.record_portal_legal_acceptance(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_legal_acceptance(uuid,text,text,text,text,text) TO service_role;

COMMENT ON TABLE public.audit_portal_legal_acceptances IS 'Immutable, versioned clickwrap evidence captured at first authenticated portal access.';
