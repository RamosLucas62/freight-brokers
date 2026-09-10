-- Authenticator enrollment remains available, but authenticated users no longer
-- need AAL2 for settings and billing actions. Existing role/ownership checks in
-- the delegated functions remain the authorization boundary.
CREATE OR REPLACE FUNCTION public.portal_save_security_settings(
 p_tenant uuid,p_timezone text,p_contacts jsonb,p_senders text[],p_ip_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 result:=public.portal_save_notification_settings_v2(actor,p_tenant,p_timezone,p_contacts,p_ip_fingerprint);
 PERFORM public.portal_save_inbound_senders(actor,p_tenant,p_senders,p_ip_fingerprint);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.portal_record_billing_action_secure(p_tenant uuid,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 PERFORM public.portal_record_billing_action(auth.uid(),p_tenant,p_action);
END $$;

REVOKE ALL ON FUNCTION public.portal_save_security_settings(uuid,text,jsonb,text[],text),public.portal_record_billing_action_secure(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_save_security_settings(uuid,text,jsonb,text[],text),public.portal_record_billing_action_secure(uuid,text) TO authenticated;
