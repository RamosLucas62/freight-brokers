-- Inbound queue tables were introduced after the original tenant RLS migration.
-- Allow authenticated members to see only their own company's queue and history.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit_inbound_jobs','audit_inbound_attachments','audit_job_reviews'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS audit_member_read ON public.%I',t);
  EXECUTE format('DROP POLICY IF EXISTS audit_member_guard ON public.%I',t);
  EXECUTE format('DROP POLICY IF EXISTS audit_enabled_guard ON public.%I',t);
  EXECUTE format(
   'CREATE POLICY audit_member_read ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))',
   t
  );
  EXECUTE format(
   'CREATE POLICY audit_member_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))',
   t
  );
  EXECUTE format(
   'CREATE POLICY audit_enabled_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.audit_portal_enabled())',
   t
  );
 END LOOP;
END $$;
