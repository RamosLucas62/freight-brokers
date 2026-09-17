-- Disabled by default. A future pilot must bind one Rose Rocket Platform v2
-- organization to one active Olympian tenant before any event is accepted.
CREATE TABLE IF NOT EXISTS public.audit_rose_connections (
 org_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL UNIQUE REFERENCES public.audit_tenants(id),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,tenant_id)
);
ALTER TABLE public.audit_rose_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_rose_connections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_rose_connections TO service_role;

-- No raw webhook payload or customer document is stored in the event inbox.
CREATE TABLE IF NOT EXISTS public.audit_rose_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 tenant_id uuid NOT NULL,
 event_id uuid NOT NULL,
 order_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','discovered','failed')),
 attempts smallint NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 completed_at timestamptz,
 error_code text,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,event_id),
 FOREIGN KEY(org_id,tenant_id) REFERENCES public.audit_rose_connections(org_id,tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_audit_rose_events_ready ON public.audit_rose_events(next_attempt_at,created_at)
 WHERE status='queued';
ALTER TABLE public.audit_rose_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_rose_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_rose_events TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_rose_order_event(
 p_org_id uuid,p_event_id uuid,p_order_id uuid,p_occurred_at timestamptz
) RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE target_tenant uuid;
BEGIN
 SELECT c.tenant_id INTO target_tenant
 FROM public.audit_rose_connections c JOIN public.audit_tenants t ON t.id=c.tenant_id
 WHERE c.org_id=p_org_id AND c.enabled AND t.status='active';
 IF target_tenant IS NULL THEN RETURN 'not_connected'; END IF;
 IF (SELECT count(*) FROM public.audit_rose_events WHERE org_id=p_org_id AND created_at>=now()-interval '1 day')>=1000
 THEN RETURN 'rate_limited'; END IF;
 INSERT INTO public.audit_rose_events(org_id,tenant_id,event_id,order_id,occurred_at)
 VALUES(p_org_id,target_tenant,p_event_id,p_order_id,p_occurred_at)
 ON CONFLICT(org_id,event_id) DO NOTHING;
 RETURN CASE WHEN FOUND THEN 'queued' ELSE 'duplicate' END;
END $$;

CREATE OR REPLACE FUNCTION public.claim_rose_order_event() RETURNS SETOF public.audit_rose_events
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.audit_rose_events SET status='queued',claimed_at=NULL,next_attempt_at=now(),error_code='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes' AND attempts<5;
 UPDATE public.audit_rose_events SET status='failed',claimed_at=NULL,error_code='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes' AND attempts>=5;
 RETURN QUERY UPDATE public.audit_rose_events e SET status='processing',attempts=e.attempts+1,claimed_at=now(),error_code=NULL
 WHERE e.id=(SELECT q.id FROM public.audit_rose_events q
  JOIN public.audit_rose_connections c ON c.org_id=q.org_id AND c.tenant_id=q.tenant_id
  JOIN public.audit_tenants t ON t.id=q.tenant_id
  WHERE q.status='queued' AND q.next_attempt_at<=now() AND q.attempts<5 AND c.enabled AND t.status='active'
  ORDER BY q.next_attempt_at,q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1)
 RETURNING e.*;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_rose_order_event(uuid,uuid,uuid,timestamptz),public.claim_rose_order_event()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_rose_order_event(uuid,uuid,uuid,timestamptz),public.claim_rose_order_event()
 TO service_role;
