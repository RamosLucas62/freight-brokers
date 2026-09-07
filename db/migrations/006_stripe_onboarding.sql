CREATE TABLE public.audit_billing_customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES public.audit_tenants(id),
 stripe_customer_id text,
 stripe_subscription_id text,
 stripe_checkout_session_id text UNIQUE,
 billing_email text NOT NULL CHECK (billing_email = lower(trim(billing_email)) AND billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','past_due','paused','canceled')),
 onboarding_completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_billing_customers(tenant_id);
CREATE INDEX ON public.audit_billing_customers(stripe_customer_id);
CREATE INDEX ON public.audit_billing_customers(stripe_subscription_id);
ALTER TABLE public.audit_billing_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_billing_customers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_billing_customers TO service_role;

CREATE FUNCTION public.portal_onboarding_user_id(p_email text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT id FROM auth.users WHERE lower(email)=lower(trim(p_email)) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.portal_onboarding_user_id(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_onboarding_user_id(text) TO service_role;

CREATE FUNCTION public.portal_complete_onboarding(p_session_id text,p_company_name text,p_alias text,p_user_id uuid,p_email text,p_stripe_customer_id text,p_stripe_subscription_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE tenant uuid; existing uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_session_id));
 SELECT tenant_id INTO existing FROM public.audit_billing_customers WHERE stripe_checkout_session_id=p_session_id;
 IF existing IS NOT NULL THEN
  SELECT id INTO tenant FROM public.audit_tenants WHERE id=existing;
 ELSE
  INSERT INTO public.audit_tenants(name,alias,status) VALUES(trim(p_company_name),lower(trim(p_alias)),'active') RETURNING id INTO tenant;
 END IF;
 INSERT INTO public.audit_portal_users(user_id,enabled) VALUES(p_user_id,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true;
 INSERT INTO public.audit_memberships(tenant_id,user_id) VALUES(tenant,p_user_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_billing_customers(tenant_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,billing_email,status,onboarding_completed_at)
 VALUES(tenant,p_stripe_customer_id,p_stripe_subscription_id,p_session_id,lower(trim(p_email)),'active',now())
 ON CONFLICT(stripe_checkout_session_id) DO UPDATE SET tenant_id=excluded.tenant_id,stripe_customer_id=excluded.stripe_customer_id,
 stripe_subscription_id=excluded.stripe_subscription_id,billing_email=excluded.billing_email,status='active',onboarding_completed_at=coalesce(public.audit_billing_customers.onboarding_completed_at,now()),updated_at=now();
 RETURN jsonb_build_object('tenant_id',tenant,'alias',(SELECT alias FROM public.audit_tenants WHERE id=tenant),'audit_email',(SELECT alias FROM public.audit_tenants WHERE id=tenant)||'@audit.aiolympian.com');
END $$;
REVOKE ALL ON FUNCTION public.portal_complete_onboarding(text,text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_complete_onboarding(text,text,text,uuid,text,text,text) TO service_role;
