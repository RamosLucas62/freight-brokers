-- The service-role onboarding endpoint must be able to resolve an existing Auth
-- identity and verify that the billing owner matches it. Keep both privileged
-- functions callable only by service_role.
ALTER FUNCTION public.portal_onboarding_user_id(text) SECURITY DEFINER;
ALTER FUNCTION public.portal_onboarding_user_id(text) SET search_path=public;
REVOKE ALL ON FUNCTION public.portal_onboarding_user_id(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_onboarding_user_id(text) TO service_role;

ALTER FUNCTION public.secure_onboarding_owner(uuid,uuid) SECURITY DEFINER;
ALTER FUNCTION public.secure_onboarding_owner(uuid,uuid) SET search_path=public;
REVOKE ALL ON FUNCTION public.secure_onboarding_owner(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_onboarding_owner(uuid,uuid) TO service_role;
