ALTER TABLE public.audit_portal_users
 ADD COLUMN IF NOT EXISTS guide_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.portal_complete_guide() RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE completed timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 UPDATE public.audit_portal_users
  SET guide_completed_at=coalesce(guide_completed_at,now())
  WHERE user_id=auth.uid()
  RETURNING guide_completed_at INTO completed;
 IF completed IS NULL THEN RAISE EXCEPTION 'Portal user not found'; END IF;
 RETURN completed;
END $$;

REVOKE ALL ON FUNCTION public.portal_complete_guide() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_complete_guide() TO authenticated;
