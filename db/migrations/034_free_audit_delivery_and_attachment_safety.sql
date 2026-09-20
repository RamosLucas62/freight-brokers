-- Keep customer documents recoverable until a complete replacement set is
-- durably referenced, and keep report delivery retries independent from the
-- five expensive processing attempts.
ALTER TABLE public.free_audit_requests
 ADD COLUMN IF NOT EXISTS delivery_attempts smallint NOT NULL DEFAULT 0 CHECK(delivery_attempts BETWEEN 0 AND 10);

CREATE OR REPLACE FUNCTION public.replace_free_audit_attachments(p_request uuid,p_attachments jsonb) RETURNS boolean
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE expected integer; inserted integer;
BEGIN
 IF jsonb_typeof(p_attachments)<>'array' THEN RETURN false; END IF;
 expected:=jsonb_array_length(p_attachments);
 IF expected<1 OR expected>50 THEN RETURN false; END IF;
 PERFORM 1 FROM public.free_audit_requests WHERE id=p_request AND status='uploading' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;

 DELETE FROM public.free_audit_attachments WHERE request_id=p_request;
 INSERT INTO public.free_audit_attachments(request_id,attachment_id,filename,storage_path,document_hash,size_bytes)
 SELECT p_request,item.attachment_id,item.filename,item.storage_path,item.document_hash,item.size_bytes
 FROM jsonb_to_recordset(p_attachments) AS item(attachment_id uuid,filename text,storage_path text,document_hash text,size_bytes integer);
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted<>expected THEN RAISE EXCEPTION 'Incomplete free-audit attachment replacement'; END IF;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.replace_free_audit_attachments(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_free_audit_attachments(uuid,jsonb) TO service_role;

-- A failed request may be resubmitted, but its previous attachment references
-- remain intact until replace_free_audit_attachments commits the new set.
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
 IF current.status='failed' AND current.result IS NULL THEN
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),
   verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',verified_at=NULL,status='uploading',attempts=0,delivery_attempts=0,claimed_at=NULL,last_error=NULL,completed_at=NULL,updated_at=now()
  WHERE id=current.id;
  request_id:=current.id;action:='replace';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='uploading' AND current.updated_at>=now()-interval '15 minutes' THEN
  request_id:=current.id;action:='in_progress';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='uploading' THEN
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',updated_at=now() WHERE id=current.id;
  request_id:=current.id;action:='replace';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 IF current.verified_at IS NULL AND current.status='pending_verification' THEN
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',status='uploading',updated_at=now() WHERE id=current.id;
  request_id:=current.id;action:='replace';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
 END IF;
 may_offer:=current.last_offer_sent_at IS NULL OR current.last_offer_sent_at<now()-interval '24 hours';
 UPDATE public.free_audit_requests SET repeat_count=repeat_count+1,offer_count=offer_count+CASE WHEN may_offer THEN 1 ELSE 0 END,last_offer_sent_at=CASE WHEN may_offer THEN now() ELSE last_offer_sent_at END,updated_at=now() WHERE id=current.id RETURNING offer_count INTO offer_number;
 request_id:=current.id;action:='repeat';offer_allowed:=may_offer;RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.register_free_audit_request(text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_free_audit_request(text,text,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_free_audit_request() RETURNS SETOF public.free_audit_requests
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.free_audit_requests
 SET status=CASE WHEN result IS NULL THEN 'failed' ELSE 'delivery_failed' END,next_attempt_at=now(),last_error='WORKER_INTERRUPTED'
 WHERE status='processing' AND claimed_at<now()-interval '15 minutes';

 RETURN QUERY
 UPDATE public.free_audit_requests
 SET status='processing',
  attempts=attempts+CASE WHEN result IS NULL THEN 1 ELSE 0 END,
  delivery_attempts=delivery_attempts+CASE WHEN result IS NULL THEN 0 ELSE 1 END,
  claimed_at=now(),last_error=NULL,updated_at=now()
 WHERE id=(
  SELECT id FROM public.free_audit_requests
  WHERE next_attempt_at<=now()
   AND ((status='queued' AND result IS NULL AND attempts<5)
     OR (status='delivery_failed' AND result IS NOT NULL AND delivery_attempts<10))
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
 )
 RETURNING *;
END $$;

REVOKE ALL ON FUNCTION public.claim_free_audit_request() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_audit_request() TO service_role;
