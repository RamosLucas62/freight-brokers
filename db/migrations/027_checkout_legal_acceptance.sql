-- Immutable evidence for clickwrap acceptance at subscription checkout.
CREATE TABLE IF NOT EXISTS public.audit_checkout_acceptances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL,
 plan_code text NOT NULL CHECK(plan_code IN ('core','growth','scale')),
 billing_period text NOT NULL CHECK(billing_period IN ('monthly','semiannual','annual')),
 terms_version text NOT NULL,
 privacy_version text NOT NULL,
 disclosure_version text NOT NULL,
 disclosure_text text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 ip_address text NOT NULL,
 user_agent text NOT NULL,
 source text NOT NULL CHECK(source IN ('public_pricing','free_audit_result')),
 checkout_completed_at timestamptz,
 stripe_checkout_session_id text UNIQUE,
 stripe_customer_id text,
 stripe_subscription_id text
);

ALTER TABLE public.audit_checkout_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_checkout_acceptances FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_checkout_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.protect_checkout_acceptance()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Checkout acceptance records are immutable'; END IF;
 IF (NEW.email,NEW.plan_code,NEW.billing_period,NEW.terms_version,NEW.privacy_version,NEW.disclosure_version,NEW.disclosure_text,NEW.accepted_at,NEW.ip_address,NEW.user_agent,NEW.source)
    IS DISTINCT FROM
    (OLD.email,OLD.plan_code,OLD.billing_period,OLD.terms_version,OLD.privacy_version,OLD.disclosure_version,OLD.disclosure_text,OLD.accepted_at,OLD.ip_address,OLD.user_agent,OLD.source)
 THEN RAISE EXCEPTION 'Checkout acceptance evidence is immutable'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_checkout_acceptance ON public.audit_checkout_acceptances;
CREATE TRIGGER protect_checkout_acceptance BEFORE UPDATE OR DELETE ON public.audit_checkout_acceptances FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_acceptance();

CREATE OR REPLACE FUNCTION public.record_checkout_acceptance(
 p_email text,p_plan text,p_period text,p_terms_version text,p_privacy_version text,p_disclosure_version text,p_disclosure_text text,p_ip_address text,p_user_agent text,p_source text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE acceptance_id uuid;
BEGIN
 IF lower(trim(p_email))!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid email'; END IF;
 IF p_plan NOT IN ('core','growth','scale') OR p_period NOT IN ('monthly','semiannual','annual') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
 IF p_source NOT IN ('public_pricing','free_audit_result') THEN RAISE EXCEPTION 'Invalid source'; END IF;
 IF length(p_disclosure_text)<100 OR length(p_disclosure_text)>2000 THEN RAISE EXCEPTION 'Invalid disclosure'; END IF;
 INSERT INTO public.audit_checkout_acceptances(email,plan_code,billing_period,terms_version,privacy_version,disclosure_version,disclosure_text,ip_address,user_agent,source)
 VALUES(lower(trim(p_email)),p_plan,p_period,left(p_terms_version,40),left(p_privacy_version,40),left(p_disclosure_version,40),p_disclosure_text,left(coalesce(p_ip_address,'unknown'),128),left(coalesce(p_user_agent,'unknown'),1000),p_source)
 RETURNING id INTO acceptance_id;
 RETURN acceptance_id;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_checkout_acceptance(
 p_acceptance_id uuid,p_checkout_session_id text,p_billing_email text,p_stripe_customer_id text,p_stripe_subscription_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.audit_checkout_acceptances SET
  checkout_completed_at=coalesce(checkout_completed_at,now()),
  stripe_checkout_session_id=coalesce(stripe_checkout_session_id,left(p_checkout_session_id,255)),
  stripe_customer_id=coalesce(stripe_customer_id,left(p_stripe_customer_id,255)),
  stripe_subscription_id=coalesce(stripe_subscription_id,left(p_stripe_subscription_id,255))
 WHERE id=p_acceptance_id
   AND (p_billing_email IS NULL OR email=lower(trim(p_billing_email)))
   AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id=p_checkout_session_id);
 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.record_checkout_acceptance(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_checkout_acceptance(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkout_acceptance(text,text,text,text,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_checkout_acceptance(uuid,text,text,text,text) TO service_role;

COMMENT ON TABLE public.audit_checkout_acceptances IS 'Immutable clickwrap evidence; linked to Stripe checkout after completion.';
