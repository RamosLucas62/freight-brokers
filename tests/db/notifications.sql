-- Scheduler checks run inside the migration test transaction and are rolled back.
INSERT INTO public.audit_tenants(id,name,alias,status,is_test) VALUES
 ('70000000-0000-4000-8000-000000000001','Notification scheduler tests','notification-tests','active',true);
INSERT INTO public.audit_notification_settings(tenant_id,timezone,created_at) VALUES
 ('70000000-0000-4000-8000-000000000001','America/New_York','2026-07-31T04:00:00Z');

DO $$ BEGIN
 IF public.enqueue_due_audit_notifications('2026-08-01T11:05:00Z')<>1 THEN
  RAISE EXCEPTION 'Weekend must not enqueue monthly report';
 END IF;
 IF public.enqueue_due_audit_notifications('2026-08-03T11:05:00Z')<>3 THEN
  RAISE EXCEPTION 'First business day must catch up daily reports and enqueue monthly report';
 END IF;
 IF public.enqueue_due_audit_notifications('2026-08-03T11:06:00Z')<>0 THEN
  RAISE EXCEPTION 'Scheduler must be idempotent';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.audit_notification_deliveries WHERE tenant_id='70000000-0000-4000-8000-000000000001' AND period_key='monthly:2026-07') THEN
  RAISE EXCEPTION 'Previous month report missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.audit_notification_deliveries WHERE tenant_id='70000000-0000-4000-8000-000000000001' AND period_key='daily:2026-08-02' AND period_start='2026-08-02T04:00:00Z') THEN
  RAISE EXCEPTION 'Daily period does not honor customer timezone';
 END IF;
END $$;
