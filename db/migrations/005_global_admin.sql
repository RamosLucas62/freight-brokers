-- Application roles are backend-managed, never inferred from user-editable metadata.
CREATE TABLE public.audit_admins (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_portal_users (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_admin_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 actor_email text NOT NULL,
 action text NOT NULL,
 tenant_id uuid REFERENCES public.audit_tenants(id),
 target_user_id uuid REFERENCES auth.users(id),
 company_name text,
 target_email text,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_admin_activity(created_at DESC);
ALTER TABLE public.audit_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_admin_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_admins,public.audit_portal_users,public.audit_admin_activity FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_admins,public.audit_portal_users TO service_role;
GRANT SELECT,INSERT ON public.audit_admin_activity TO service_role;
GRANT DELETE ON public.audit_memberships TO service_role;
ALTER TABLE public.audit_job_reviews ADD COLUMN actor_email text;
ALTER TABLE public.audit_job_reviews ADD COLUMN actor_role text CHECK (actor_role IN ('admin','customer'));
UPDATE public.audit_job_reviews r SET actor_email=u.email,actor_role='customer' FROM auth.users u WHERE u.id=r.user_id;

CREATE FUNCTION public.audit_portal_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT EXISTS (SELECT 1 FROM public.audit_portal_users WHERE user_id=auth.uid() AND NOT enabled)
$$;
REVOKE ALL ON FUNCTION public.audit_portal_enabled() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.audit_portal_enabled() TO authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit_tenants','audit_memberships','audit_report_contacts','invoices','exceptions','audit_runs'] LOOP
 EXECUTE format('CREATE POLICY audit_enabled_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.audit_portal_enabled())',t);
 END LOOP;
END $$;

CREATE FUNCTION public.portal_admin_context(p_actor uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 -- Serialize admin changes, including revocation and last-admin protection.
 PERFORM pg_advisory_xact_lock(71934629);
 IF NOT EXISTS (SELECT 1 FROM public.audit_admins WHERE user_id=p_actor)
 OR EXISTS (SELECT 1 FROM public.audit_portal_users WHERE user_id=p_actor AND NOT enabled)
 THEN RAISE EXCEPTION 'Admin access required'; END IF;
END $$;

CREATE FUNCTION public.portal_admin_users(p_actor uuid,p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 IF p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid page'; END IF;
 WITH scoped AS (
 SELECT u.id,u.email,u.created_at,u.last_sign_in_at,coalesce(p.enabled,true) AS enabled,
 EXISTS(SELECT 1 FROM public.audit_admins a WHERE a.user_id=u.id) AS is_admin,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name)) FROM public.audit_memberships m JOIN public.audit_tenants t ON t.id=m.tenant_id WHERE m.user_id=u.id),'[]'::jsonb) AS companies
 FROM auth.users u LEFT JOIN public.audit_portal_users p ON p.user_id=u.id
 WHERE p.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.audit_memberships m WHERE m.user_id=u.id)
 OR EXISTS(SELECT 1 FROM public.audit_admins a WHERE a.user_id=u.id)
 ), paged AS (SELECT * FROM scoped ORDER BY created_at DESC,id LIMIT 50 OFFSET p_page*50)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM scoped),'page',p_page) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.portal_admin_find_user(p_actor uuid,p_email text) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 SELECT id INTO target FROM auth.users WHERE lower(email)=lower(trim(p_email));
 RETURN target;
END $$;

CREATE FUNCTION public.portal_admin_action(p_actor uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE tenant uuid; target uuid; actor_email text; result jsonb; enabled boolean; role_name text;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 SELECT email INTO actor_email FROM auth.users WHERE id=p_actor;
 IF p_action='company.create' THEN
 INSERT INTO public.audit_tenants(name,alias,status) VALUES(trim(p_payload->>'name'),lower(trim(p_payload->>'alias')),'inactive') RETURNING id INTO tenant;
 ELSIF p_action='company.update' THEN
 tenant:=(p_payload->>'id')::uuid;
 UPDATE public.audit_tenants SET name=trim(p_payload->>'name'),status=p_payload->>'status' WHERE id=tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
 ELSIF p_action IN ('user.register','membership.add','membership.remove','user.enable','user.role') THEN
 target:=(p_payload->>'user_id')::uuid;
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=target) THEN RAISE EXCEPTION 'User not found'; END IF;
 IF p_action='user.register' THEN
 tenant:=(p_payload->>'company_id')::uuid;
 INSERT INTO public.audit_portal_users(user_id) VALUES(target) ON CONFLICT DO NOTHING;
 INSERT INTO public.audit_memberships(tenant_id,user_id) VALUES(tenant,target) ON CONFLICT DO NOTHING;
 ELSIF p_action IN ('membership.add','membership.remove') THEN
 tenant:=(p_payload->>'company_id')::uuid;
 IF p_action='membership.add' THEN
 INSERT INTO public.audit_memberships(tenant_id,user_id) VALUES(tenant,target) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.audit_memberships WHERE tenant_id=tenant AND user_id=target; END IF;
 ELSIF p_action='user.enable' THEN
 enabled:=(p_payload->>'enabled')::boolean;
 IF enabled IS NULL THEN RAISE EXCEPTION 'Enabled is required'; END IF;
 IF NOT enabled AND target=p_actor THEN RAISE EXCEPTION 'Cannot disable yourself'; END IF;
 INSERT INTO public.audit_portal_users(user_id,enabled) VALUES(target,enabled) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled;
 ELSIF p_action='user.role' THEN
 role_name:=p_payload->>'role';
 IF role_name='admin' THEN
 INSERT INTO public.audit_admins(user_id) VALUES(target) ON CONFLICT DO NOTHING;
 ELSIF role_name='customer' THEN
 IF target=p_actor THEN RAISE EXCEPTION 'Cannot remove your own admin role'; END IF;
 DELETE FROM public.audit_admins WHERE user_id=target;
 ELSE RAISE EXCEPTION 'Invalid role'; END IF;
 END IF;
 ELSE RAISE EXCEPTION 'Invalid action'; END IF;
 INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,tenant_id,target_user_id,company_name,target_email,details)
 VALUES(p_actor,actor_email,p_action,tenant,target,(SELECT name FROM public.audit_tenants WHERE id=tenant),(SELECT u.email FROM auth.users u WHERE u.id=target),p_payload);
 RETURN jsonb_build_object('ok',true,'company_id',tenant,'user_id',target);
END $$;

CREATE OR REPLACE FUNCTION public.portal_job_action(p_user uuid,p_tenant uuid,p_job uuid,p_action text,p_note text)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_status text; account_status text; is_admin boolean; email text;
BEGIN
 SELECT EXISTS(SELECT 1 FROM public.audit_admins WHERE user_id=p_user) INTO is_admin;
 IF EXISTS(SELECT 1 FROM public.audit_portal_users WHERE user_id=p_user AND NOT enabled) THEN RAISE EXCEPTION 'Portal access disabled'; END IF;
 IF NOT is_admin AND NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Membership required'; END IF;
 SELECT status INTO account_status FROM public.audit_tenants WHERE id=p_tenant FOR UPDATE;
 SELECT status INTO current_status FROM public.audit_inbound_jobs WHERE id=p_job AND tenant_id=p_tenant FOR UPDATE;
 IF current_status IS NULL OR current_status NOT IN ('needs_review','blocked','completed','ignored') THEN RAISE EXCEPTION 'Job cannot be changed'; END IF;
 IF p_action='retry' THEN
 IF account_status<>'active' OR current_status NOT IN ('needs_review','blocked') THEN RAISE EXCEPTION 'Retry not allowed'; END IF;
 UPDATE public.audit_inbound_jobs SET status='queued',error_code=NULL,started_at=NULL,finished_at=NULL WHERE id=p_job AND tenant_id=p_tenant;
 ELSIF p_action<>'review' THEN RAISE EXCEPTION 'Invalid action'; END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=p_user;
 INSERT INTO public.audit_job_reviews(tenant_id,job_id,user_id,action,note,actor_email,actor_role)
 VALUES(p_tenant,p_job,p_user,p_action,p_note,email,CASE WHEN is_admin THEN 'admin' ELSE 'customer' END);
 IF is_admin THEN INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,tenant_id,company_name,details)
 VALUES(p_user,email,'job.'||p_action,p_tenant,(SELECT name FROM public.audit_tenants WHERE id=p_tenant),jsonb_build_object('job_id',p_job,'note',p_note)); END IF;
END $$;
REVOKE ALL ON FUNCTION public.portal_admin_context(uuid),public.portal_admin_users(uuid,integer),public.portal_admin_find_user(uuid,text),public.portal_admin_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_admin_context(uuid),public.portal_admin_users(uuid,integer),public.portal_admin_find_user(uuid,text),public.portal_admin_action(uuid,text,jsonb) TO service_role;

-- One-time owner setup from the trusted backend; subsequent grants use admin actions.
CREATE FUNCTION public.portal_bootstrap_admin(p_email text) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(71934629);
 IF EXISTS(SELECT 1 FROM public.audit_admins) THEN RAISE EXCEPTION 'An administrator already exists'; END IF;
 SELECT id INTO target FROM auth.users WHERE lower(email)=lower(trim(p_email));
 IF target IS NULL THEN RAISE EXCEPTION 'Create the owner in Supabase Auth first'; END IF;
 INSERT INTO public.audit_admins(user_id) VALUES(target);
 INSERT INTO public.audit_portal_users(user_id,enabled) VALUES(target,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true;
 INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,target_user_id,target_email) VALUES(target,lower(trim(p_email)),'admin.bootstrap',target,lower(trim(p_email)));
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.portal_bootstrap_admin(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_bootstrap_admin(text) TO service_role;
