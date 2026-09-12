ALTER TABLE public.free_audit_followups
 ADD COLUMN IF NOT EXISTS delivery_sequence integer NOT NULL DEFAULT 1 CHECK(delivery_sequence>0);

DROP FUNCTION IF EXISTS public.claim_free_audit_followup();
CREATE FUNCTION public.claim_free_audit_followup() RETURNS TABLE(request_id uuid,day_offset smallint,delivery_sequence integer,email text,contact_name text,company_name text,loads_per_month text,recommended_plan text,result jsonb) LANGUAGE plpgsql SET search_path=public AS $$
DECLARE claimed public.free_audit_followups%ROWTYPE;
BEGIN
 UPDATE public.free_audit_followups SET status='pending',claimed_at=NULL WHERE status='sending' AND claimed_at<now()-interval '15 minutes';
 UPDATE public.free_audit_followups f SET status='cancelled' FROM public.free_audit_requests r
 WHERE f.request_id=r.id AND f.status='pending' AND (r.marketing_unsubscribed_at IS NOT NULL OR r.result_expires_at<=now() OR EXISTS(SELECT 1 FROM public.audit_billing_customers b WHERE lower(b.billing_email)=lower(r.email) AND b.status IN ('active','past_due','paused','canceling')));
 SELECT f.* INTO claimed FROM public.free_audit_followups f JOIN public.free_audit_requests r ON r.id=f.request_id
 WHERE f.status='pending' AND f.due_at<=now() AND r.marketing_unsubscribed_at IS NULL AND r.result_expires_at>now()
 ORDER BY f.due_at FOR UPDATE OF f SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.free_audit_followups SET status='sending',attempts=attempts+1,claimed_at=now() WHERE free_audit_followups.request_id=claimed.request_id AND free_audit_followups.day_offset=claimed.day_offset;
 RETURN QUERY SELECT r.id,claimed.day_offset,claimed.delivery_sequence,r.email,r.contact_name,r.company_name,r.loads_per_month,r.recommended_plan,r.result FROM public.free_audit_requests r WHERE r.id=claimed.request_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_free_audit_followup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_audit_followup() TO service_role;
