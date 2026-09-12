-- Reenvia os cinco follow-ups da auditoria gratuita mais recente deste e-mail
-- em intervalos de dois minutos. Execute somente em homologação/teste.
-- Requer a migration 030_followup_replay_delivery_sequence.sql.

BEGIN;

DO $$
DECLARE
 target_email constant text := 'ramoslucas.ads@gmail.com';
 target_request uuid;
 target_status text;
BEGIN
 SELECT id,status INTO target_request,target_status
 FROM public.free_audit_requests
 WHERE lower(email)=target_email
 ORDER BY created_at DESC
 LIMIT 1
 FOR UPDATE;

 IF target_request IS NULL THEN
  RAISE EXCEPTION 'Nenhuma auditoria encontrada para %.',target_email;
 END IF;
 IF target_status<>'completed' THEN
  RAISE EXCEPTION 'A auditoria mais recente (%) ainda não está concluída: status %.',target_request,target_status;
 END IF;
 IF EXISTS(SELECT 1 FROM public.free_audit_requests WHERE id=target_request AND marketing_unsubscribed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Este lead cancelou os follow-ups; o reenvio foi bloqueado.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.audit_billing_customers b JOIN public.free_audit_requests r ON lower(r.email)=lower(b.billing_email) WHERE r.id=target_request AND b.status IN ('active','past_due','paused','canceling')) THEN
  RAISE EXCEPTION 'Este lead já possui assinatura; o reenvio de vendas foi bloqueado.';
 END IF;

 UPDATE public.free_audit_followups
 SET status='pending',attempts=0,claimed_at=NULL,sent_at=NULL,
     delivery_sequence=delivery_sequence+1,
     due_at=now()+CASE day_offset
      WHEN 1 THEN interval '2 minutes'
      WHEN 3 THEN interval '4 minutes'
      WHEN 5 THEN interval '6 minutes'
      WHEN 10 THEN interval '8 minutes'
      WHEN 30 THEN interval '10 minutes'
     END
 WHERE request_id=target_request;

 IF NOT FOUND THEN
  RAISE EXCEPTION 'Nenhum follow-up foi encontrado para a auditoria %.',target_request;
 END IF;

 RAISE NOTICE 'Sequência reagendada para % (auditoria %).',target_email,target_request;
END $$;

COMMIT;

SELECT r.email,f.day_offset,f.status,f.delivery_sequence,f.due_at
FROM public.free_audit_followups f
JOIN public.free_audit_requests r ON r.id=f.request_id
WHERE lower(r.email)='ramoslucas.ads@gmail.com'
ORDER BY r.created_at DESC,f.day_offset
LIMIT 5;
