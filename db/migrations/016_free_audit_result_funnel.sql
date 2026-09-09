ALTER TABLE public.free_audit_requests
 ADD COLUMN IF NOT EXISTS result_token_hash text CHECK(result_token_hash IS NULL OR result_token_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN IF NOT EXISTS result_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS result_opened_at timestamptz,
 ADD COLUMN IF NOT EXISTS recommended_plan text CHECK(recommended_plan IS NULL OR recommended_plan IN ('core','growth','scale')),
 ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_free_audit_result_token ON public.free_audit_requests(result_token_hash) WHERE result_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.free_audit_funnel_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES public.free_audit_requests(id) ON DELETE CASCADE,
 event_name text NOT NULL CHECK(event_name IN ('result_ready','result_opened','report_downloaded','pricing_viewed','checkout_started','followup_sent','unsubscribed')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_free_audit_funnel_request ON public.free_audit_funnel_events(request_id,created_at);

CREATE TABLE IF NOT EXISTS public.free_audit_followups(
 request_id uuid NOT NULL REFERENCES public.free_audit_requests(id) ON DELETE CASCADE,
 day_offset smallint NOT NULL CHECK(day_offset IN (1,3,5,10,30)),due_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled')),
 attempts smallint NOT NULL DEFAULT 0,claimed_at timestamptz,sent_at timestamptz,PRIMARY KEY(request_id,day_offset)
);
CREATE INDEX IF NOT EXISTS idx_free_audit_followups_due ON public.free_audit_followups(due_at) WHERE status='pending';

ALTER TABLE public.free_audit_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_audit_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_audit_funnel_events,public.free_audit_followups FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.free_audit_funnel_events,public.free_audit_followups TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.free_audit_funnel_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.activate_free_audit_result(p_request uuid,p_token_hash text,p_plan text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_plan NOT IN ('core','growth','scale') THEN RETURN false; END IF;
 UPDATE public.free_audit_requests SET result_token_hash=p_token_hash,result_expires_at=now()+interval '35 days',recommended_plan=p_plan,updated_at=now() WHERE id=p_request AND result IS NOT NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.free_audit_funnel_events(request_id,event_name) VALUES(p_request,'result_ready');
 INSERT INTO public.free_audit_followups(request_id,day_offset,due_at) SELECT p_request,d,now()+(d||' days')::interval FROM unnest(ARRAY[1,3,5,10,30]) d ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.activate_free_audit_result(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_free_audit_result(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_free_audit_followup() RETURNS TABLE(request_id uuid,day_offset smallint,email text,contact_name text,company_name text,loads_per_month text,recommended_plan text,result jsonb) LANGUAGE plpgsql SET search_path=public AS $$
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
 RETURN QUERY SELECT r.id,claimed.day_offset,r.email,r.contact_name,r.company_name,r.loads_per_month,r.recommended_plan,r.result FROM public.free_audit_requests r WHERE r.id=claimed.request_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_free_audit_followup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_audit_followup() TO service_role;

CREATE OR REPLACE FUNCTION public.finish_free_audit_followup(p_request uuid,p_day smallint) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.free_audit_followups SET status='sent',sent_at=now(),claimed_at=NULL WHERE request_id=p_request AND day_offset=p_day AND status='sending';
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.free_audit_funnel_events(request_id,event_name,metadata) VALUES(p_request,'followup_sent',jsonb_build_object('day_offset',p_day));RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.fail_free_audit_followup(p_request uuid,p_day smallint) RETURNS void LANGUAGE sql SET search_path=public AS $$
 UPDATE public.free_audit_followups SET status=CASE WHEN attempts>=5 THEN 'cancelled' ELSE 'pending' END,claimed_at=NULL,due_at=CASE WHEN attempts>=5 THEN due_at ELSE now()+interval '30 minutes' END WHERE request_id=p_request AND day_offset=p_day AND status='sending'
$$;
CREATE OR REPLACE FUNCTION public.unsubscribe_free_audit(p_token_hash text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE target uuid;BEGIN SELECT id INTO target FROM public.free_audit_requests WHERE result_token_hash=p_token_hash AND result_expires_at>now();IF target IS NULL THEN RETURN false;END IF;UPDATE public.free_audit_requests SET marketing_unsubscribed_at=now(),updated_at=now() WHERE id=target;UPDATE public.free_audit_followups SET status='cancelled' WHERE request_id=target AND status IN ('pending','sending');INSERT INTO public.free_audit_funnel_events(request_id,event_name) VALUES(target,'unsubscribed');RETURN true;END $$;
REVOKE ALL ON FUNCTION public.finish_free_audit_followup(uuid,smallint),public.fail_free_audit_followup(uuid,smallint),public.unsubscribe_free_audit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_free_audit_followup(uuid,smallint),public.fail_free_audit_followup(uuid,smallint),public.unsubscribe_free_audit(text) TO service_role;
