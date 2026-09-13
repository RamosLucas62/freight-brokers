-- Supabase does not grant service_role direct SELECT access to auth.users.
-- These backend-only RPCs validate the administrator before reading Auth data,
-- so execute them with the migration owner's privileges and a fixed search path.
ALTER FUNCTION public.portal_admin_users(uuid, integer) SECURITY DEFINER;
ALTER FUNCTION public.portal_admin_users(uuid, integer) SET search_path = public, pg_temp;

ALTER FUNCTION public.portal_admin_find_user(uuid, text) SECURITY DEFINER;
ALTER FUNCTION public.portal_admin_find_user(uuid, text) SET search_path = public, pg_temp;

ALTER FUNCTION public.portal_admin_action(uuid, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.portal_admin_action(uuid, text, jsonb) SET search_path = public, pg_temp;

ALTER FUNCTION public.portal_job_action(uuid, uuid, uuid, text, text) SECURITY DEFINER;
ALTER FUNCTION public.portal_job_action(uuid, uuid, uuid, text, text) SET search_path = public, pg_temp;

ALTER FUNCTION public.portal_bootstrap_admin(text) SECURITY DEFINER;
ALTER FUNCTION public.portal_bootstrap_admin(text) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.portal_admin_users(uuid, integer),
 public.portal_admin_find_user(uuid, text),
 public.portal_admin_action(uuid, text, jsonb),
 public.portal_job_action(uuid, uuid, uuid, text, text),
 public.portal_bootstrap_admin(text)
 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.portal_admin_users(uuid, integer),
 public.portal_admin_find_user(uuid, text),
 public.portal_admin_action(uuid, text, jsonb),
 public.portal_job_action(uuid, uuid, uuid, text, text),
 public.portal_bootstrap_admin(text)
 TO service_role;
