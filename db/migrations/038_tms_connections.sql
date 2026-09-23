-- Server-only credentials. Verification does not claim document synchronization.
CREATE TABLE public.audit_tms_connections (
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 provider text NOT NULL CHECK(provider IN ('tai','mcleod','turvo','aljex','ascendtms','mercurygate')),
 status text NOT NULL CHECK(status IN ('requested','verified','disconnected')),
 credentials_ciphertext text,
 account_label text,
 verified_at timestamptz,
 requested_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(tenant_id,provider),
 CHECK((status='verified' AND provider='tai' AND credentials_ciphertext IS NOT NULL AND verified_at IS NOT NULL)
  OR (status<>'verified' AND credentials_ciphertext IS NULL AND verified_at IS NULL)),
 CHECK(status<>'requested' OR (provider<>'tai' AND requested_at IS NOT NULL))
);
ALTER TABLE public.audit_tms_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_tms_connections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_tms_connections TO service_role;

-- Account erasure must also destroy provider credentials added after the original
-- deletion workflow was implemented. Pausing/canceling alone does not erase them.
CREATE FUNCTION public.clear_deleted_tenant_tms_credentials() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_tms_connections SET status='disconnected',credentials_ciphertext=NULL,
  verified_at=NULL,requested_at=NULL,account_label=NULL,updated_by=NULL,updated_at=now()
 WHERE tenant_id=NEW.tenant_id;
 UPDATE public.audit_rose_connections SET credentials_ciphertext=NULL,connected_at=NULL,
  connected_by=NULL,connection_state='disconnected',enabled=false,updated_at=now()
 WHERE tenant_id=NEW.tenant_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_deleted_tenant_tms_credentials() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_deleted_tenant_tms_credentials
 AFTER UPDATE OF deletion_completed_at ON public.audit_billing_customers
 FOR EACH ROW WHEN (OLD.deletion_completed_at IS NULL AND NEW.deletion_completed_at IS NOT NULL)
 EXECUTE FUNCTION public.clear_deleted_tenant_tms_credentials();
