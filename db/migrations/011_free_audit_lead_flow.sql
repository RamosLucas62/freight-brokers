-- One verified free audit per normalized email. Public requests reach the
-- service-role backend only; no prospect data is exposed through PostgREST.
CREATE TABLE IF NOT EXISTS public.free_audit_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email=lower(trim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 email_hash text NOT NULL UNIQUE CHECK (email_hash ~ '^[a-f0-9]{64}$'),
 contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 120),
 company_name text NOT NULL CHECK (char_length(company_name) BETWEEN 2 AND 200),
 phone text CHECK (phone IS NULL OR char_length(phone) BETWEEN 7 AND 40),
 loads_per_month text CHECK (loads_per_month IS NULL OR char_length(loads_per_month)<=40),
 status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','pending_verification','queued','processing','delivery_failed','completed','failed','expired')),
 verification_token_hash text CHECK (verification_token_hash IS NULL OR verification_token_hash ~ '^[a-f0-9]{64}$'),
 verification_expires_at timestamptz,
 verified_at timestamptz,
 legal_accepted_at timestamptz NOT NULL DEFAULT now(),
 ip_fingerprint text NOT NULL CHECK (char_length(ip_fingerprint)=64),
 repeat_count integer NOT NULL DEFAULT 0 CHECK (repeat_count>=0),
 offer_count integer NOT NULL DEFAULT 0 CHECK (offer_count>=0),
 last_offer_sent_at timestamptz,
 result jsonb,
 attempts smallint NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 last_error text,
 completed_at timestamptz,
 delete_after timestamptz NOT NULL DEFAULT now()+interval '30 days',
 retention_status text NOT NULL DEFAULT 'pending' CHECK(retention_status IN ('pending','deleting','expired')),
 retention_claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_free_audit_verification_token ON public.free_audit_requests(verification_token_hash) WHERE verification_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_free_audit_queue ON public.free_audit_requests(next_attempt_at,created_at) WHERE status IN ('queued','delivery_failed');
CREATE INDEX IF NOT EXISTS idx_free_audit_retention ON public.free_audit_requests(delete_after) WHERE retention_status='pending';

CREATE TABLE IF NOT EXISTS public.free_audit_attachments (
 request_id uuid NOT NULL REFERENCES public.free_audit_requests(id) ON DELETE CASCADE,
 attachment_id uuid NOT NULL,
 filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
 storage_path text NOT NULL,
 document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
 size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(request_id,attachment_id),
 UNIQUE(request_id,document_hash)
);

ALTER TABLE public.free_audit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_audit_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_audit_requests,public.free_audit_attachments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.free_audit_requests,public.free_audit_attachments TO service_role;

CREATE OR REPLACE FUNCTION public.register_free_audit_request(
 p_email text,p_email_hash text,p_name text,p_company text,p_phone text,p_loads text,p_token_hash text,p_ip_fingerprint text
) RETURNS TABLE(request_id uuid,action text,offer_allowed boolean,offer_number integer)
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE normalized text:=lower(trim(p_email)); current public.free_audit_requests%ROWTYPE; may_offer boolean;
BEGIN
 IF normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR p_email_hash !~ '^[a-f0-9]{64}$' OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_ip_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid free audit request'; END IF;
 SELECT * INTO current FROM public.free_audit_requests WHERE email_hash=p_email_hash FOR UPDATE;
 IF current.id IS NULL THEN
  INSERT INTO public.free_audit_requests(email,email_hash,contact_name,company_name,phone,loads_per_month,verification_token_hash,verification_expires_at,ip_fingerprint)
  VALUES(normalized,p_email_hash,trim(p_name),trim(p_company),nullif(trim(p_phone),''),nullif(trim(p_loads),''),p_token_hash,now()+interval '30 minutes',p_ip_fingerprint)
  RETURNING id INTO request_id;
  action:='created';offer_allowed:=false;offer_number:=0;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='uploading' AND current.updated_at>=now()-interval '15 minutes' THEN
  request_id:=current.id;action:='in_progress';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='uploading' THEN
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),
   verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',updated_at=now() WHERE id=current.id;
  request_id:=current.id;action:='replace';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='failed' THEN
  DELETE FROM public.free_audit_attachments WHERE request_id=current.id;
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),
   verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',status='uploading',last_error=NULL,updated_at=now() WHERE id=current.id;
  request_id:=current.id;action:='created';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='pending_verification' THEN
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),
   verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',status='uploading',updated_at=now() WHERE id=current.id;
  request_id:=current.id;action:='replace';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 may_offer:=current.last_offer_sent_at IS NULL OR current.last_offer_sent_at<now()-interval '24 hours';
 UPDATE public.free_audit_requests SET repeat_count=repeat_count+1,
  offer_count=offer_count+CASE WHEN may_offer THEN 1 ELSE 0 END,
  last_offer_sent_at=CASE WHEN may_offer THEN now() ELSE last_offer_sent_at END,updated_at=now()
 WHERE id=current.id RETURNING offer_count INTO offer_number;
 request_id:=current.id;action:='repeat';offer_allowed:=may_offer;RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.mark_free_audit_uploaded(p_request uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.free_audit_requests SET status='pending_verification',updated_at=now()
 WHERE id=p_request AND status='uploading' AND EXISTS(SELECT 1 FROM public.free_audit_attachments WHERE request_id=p_request);
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.verify_free_audit_request(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE request uuid;
BEGIN
 UPDATE public.free_audit_requests SET status='queued',verified_at=now(),verification_token_hash=NULL,verification_expires_at=NULL,updated_at=now()
 WHERE verification_token_hash=p_token_hash AND status='pending_verification' AND verification_expires_at>now()
 RETURNING id INTO request;
 RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.claim_free_audit_request() RETURNS SETOF public.free_audit_requests
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.free_audit_requests SET status=CASE WHEN result IS NULL THEN 'failed' ELSE 'delivery_failed' END,next_attempt_at=now(),last_error='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes';
 RETURN QUERY UPDATE public.free_audit_requests SET status='processing',attempts=attempts+1,claimed_at=now(),last_error=NULL,updated_at=now()
 WHERE id=(SELECT id FROM public.free_audit_requests WHERE status IN ('queued','delivery_failed') AND next_attempt_at<=now() AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.claim_expired_free_audit() RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE request uuid;
BEGIN
 UPDATE public.free_audit_requests SET retention_status='pending',retention_claimed_at=NULL WHERE retention_status='deleting' AND retention_claimed_at<now()-interval '15 minutes';
 UPDATE public.free_audit_requests SET retention_status='deleting',retention_claimed_at=now(),updated_at=now()
 WHERE id=(SELECT id FROM public.free_audit_requests WHERE delete_after<=now() AND retention_status='pending' ORDER BY delete_after FOR UPDATE SKIP LOCKED LIMIT 1)
 RETURNING id INTO request;
 RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.release_free_audit_offer(p_request uuid,p_offer_number integer) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.free_audit_requests SET offer_count=greatest(offer_count-1,0),last_offer_sent_at=NULL,updated_at=now()
 WHERE id=p_request AND offer_count=p_offer_number
$$;

REVOKE ALL ON FUNCTION public.register_free_audit_request(text,text,text,text,text,text,text,text),public.mark_free_audit_uploaded(uuid),public.verify_free_audit_request(text),public.claim_free_audit_request(),public.claim_expired_free_audit(),public.release_free_audit_offer(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_free_audit_request(text,text,text,text,text,text,text,text),public.mark_free_audit_uploaded(uuid),public.verify_free_audit_request(text),public.claim_free_audit_request(),public.claim_expired_free_audit(),public.release_free_audit_offer(uuid,integer) TO service_role;
