-- Let a verified lead replace failed documents without entering contact data again.
-- Only a short-lived, hashed, one-time email token can open this recovery flow.
ALTER TABLE public.free_audit_requests
 ADD COLUMN IF NOT EXISTS retry_token_hash text CHECK (retry_token_hash IS NULL OR retry_token_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN IF NOT EXISTS retry_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS retry_claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_free_audit_retry_token
 ON public.free_audit_requests(retry_token_hash)
 WHERE retry_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_free_audit_retry(p_request uuid,p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 UPDATE public.free_audit_requests
 SET retry_token_hash=p_token_hash,retry_expires_at=now()+interval '72 hours',retry_claimed_at=NULL,updated_at=now()
 WHERE id=p_request AND status='processing' AND result IS NULL;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.inspect_free_audit_retry(p_token_hash text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.free_audit_requests
  WHERE retry_token_hash=p_token_hash AND retry_expires_at>now()
   AND status IN ('failed','uploading')
   AND (retry_claimed_at IS NULL OR retry_claimed_at<now()-interval '15 minutes')
 );
$$;

CREATE OR REPLACE FUNCTION public.begin_free_audit_retry(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE request uuid;
BEGIN
 UPDATE public.free_audit_requests
 SET status='uploading',retry_claimed_at=now(),attempts=0,claimed_at=NULL,last_error=NULL,
  result=NULL,next_attempt_at=now(),updated_at=now()
 WHERE retry_token_hash=p_token_hash AND retry_expires_at>now() AND status='failed'
  AND (retry_claimed_at IS NULL OR retry_claimed_at<now()-interval '15 minutes')
 RETURNING id INTO request;
 RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.finish_free_audit_retry(p_request uuid,p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.free_audit_requests
 SET status='queued',retry_token_hash=NULL,retry_expires_at=NULL,retry_claimed_at=NULL,
  verified_at=coalesce(verified_at,now()),updated_at=now()
 WHERE id=p_request AND retry_token_hash=p_token_hash AND retry_expires_at>now()
  AND status='uploading' AND EXISTS(SELECT 1 FROM public.free_audit_attachments WHERE request_id=p_request);
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.fail_free_audit_retry(p_request uuid,p_token_hash text) RETURNS void
LANGUAGE sql SET search_path=public AS $$
 UPDATE public.free_audit_requests
 SET status='failed',retry_claimed_at=NULL,last_error='RETRY_UPLOAD_FAILED',updated_at=now()
 WHERE id=p_request AND retry_token_hash=p_token_hash AND status='uploading';
$$;

REVOKE ALL ON FUNCTION public.issue_free_audit_retry(uuid,text),public.inspect_free_audit_retry(text),public.begin_free_audit_retry(text),public.finish_free_audit_retry(uuid,text),public.fail_free_audit_retry(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_free_audit_retry(uuid,text),public.inspect_free_audit_retry(text),public.begin_free_audit_retry(text),public.finish_free_audit_retry(uuid,text),public.fail_free_audit_retry(uuid,text) TO service_role;
