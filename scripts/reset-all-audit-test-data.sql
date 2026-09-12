-- RESET DE TESTE DESTRUTIVO
-- Apaga todos os dados do Freight Audit e todos os usuários de cliente ligados
-- ao produto. Preserva usuários Auth de outros produtos e mantém somente
-- ramos.lucas@aiolympian.com como administrador do Freight Audit.
--
-- Execute no SQL Editor do Supabase somente no ambiente que será reiniciado.
-- O script é transacional: se o administrador não existir exatamente uma vez
-- no Supabase Auth, nada será apagado.

BEGIN;

DO $$
DECLARE
 admin_email constant text := 'ramos.lucas@aiolympian.com';
 admin_id uuid;
 admin_matches integer;
 truncate_targets text;
BEGIN
 SELECT count(*) INTO admin_matches
 FROM auth.users
 WHERE lower(email)=admin_email;

 IF admin_matches<>1 THEN
  RAISE EXCEPTION 'Reset cancelado: crie exatamente um usuário Auth com o e-mail % antes de executar.',admin_email;
 END IF;

 SELECT id INTO admin_id FROM auth.users WHERE lower(email)=admin_email;

 -- Capture primeiro apenas as identidades pertencentes a este produto. Isso
 -- evita apagar usuários de outros sistemas que compartilhem o Supabase Auth.
 CREATE TEMP TABLE audit_reset_client_users(user_id uuid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO audit_reset_client_users(user_id)
 SELECT user_id FROM public.audit_portal_users WHERE user_id<>admin_id
 UNION
 SELECT user_id FROM public.audit_memberships WHERE user_id<>admin_id
 UNION
 SELECT user_id FROM public.audit_admins WHERE user_id<>admin_id;

 -- Ambientes que ainda não receberam todas as migrations podem não ter algumas
 -- tabelas. Monte o TRUNCATE apenas com as tabelas desta aplicação que existem.
 SELECT string_agg(format('public.%I',table_name),', ')
 INTO truncate_targets
 FROM unnest(ARRAY[
  'audit_checkout_acceptances','audit_confidence_reviews','audit_checkout_onboarding_invites',
  'free_audit_followups','free_audit_funnel_events','free_audit_attachments','free_audit_requests',
  'audit_usage_settlements','audit_invoice_usage','audit_security_activity','audit_inbound_sender_rules',
  'audit_stripe_webhook_queue','audit_data_deletions','audit_billing_actions','audit_stripe_events',
  'audit_notification_deliveries','audit_notification_settings','audit_billing_customers',
  'audit_admin_activity','audit_admins','audit_portal_users','audit_job_reviews',
  'audit_inbound_attachments','audit_inbound_jobs','audit_inbound_events','audit_report_contacts',
  'audit_memberships','exceptions','invoices','audit_runs','audit_tenants'
 ]) AS requested(table_name)
 WHERE to_regclass(format('public.%I',table_name)) IS NOT NULL;

 IF truncate_targets IS NULL THEN
  RAISE EXCEPTION 'Reset cancelado: nenhuma tabela do Freight Audit foi encontrada no schema public.';
 END IF;

 EXECUTE 'TRUNCATE TABLE '||truncate_targets||' RESTART IDENTITY CASCADE';

 DELETE FROM auth.users
 WHERE id IN (SELECT user_id FROM audit_reset_client_users);

 INSERT INTO public.audit_admins(user_id) VALUES(admin_id);
 INSERT INTO public.audit_portal_users(user_id,enabled) VALUES(admin_id,true);
 INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,target_user_id,target_email,details)
 VALUES(admin_id,admin_email,'admin.bootstrap',admin_id,admin_email,jsonb_build_object('reason','full_test_reset'));

 RAISE NOTICE 'Reset concluído. Administrador preservado: % (%)',admin_email,admin_id;
END $$;

COMMIT;

-- Resultado esperado: uma linha para o administrador e nenhuma empresa.
SELECT u.email,p.enabled,(a.user_id IS NOT NULL) AS is_admin
FROM auth.users u
JOIN public.audit_portal_users p ON p.user_id=u.id
LEFT JOIN public.audit_admins a ON a.user_id=u.id
WHERE lower(u.email)='ramos.lucas@aiolympian.com';

SELECT count(*) AS empresas_restantes FROM public.audit_tenants;
