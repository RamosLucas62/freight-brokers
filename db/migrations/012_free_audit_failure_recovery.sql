-- A failed processing attempt does not consume the one-time free audit. Allow
-- the same verified address to replace its files and confirm a fresh request.
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
 IF current.status='failed' THEN
  DELETE FROM public.free_audit_attachments WHERE request_id=current.id;
  UPDATE public.free_audit_requests SET contact_name=trim(p_name),company_name=trim(p_company),phone=nullif(trim(p_phone),''),loads_per_month=nullif(trim(p_loads),''),
   verification_token_hash=p_token_hash,verification_expires_at=now()+interval '30 minutes',verified_at=NULL,status='uploading',result=NULL,attempts=0,claimed_at=NULL,last_error=NULL,completed_at=NULL,updated_at=now()
  WHERE id=current.id;
  request_id:=current.id;action:='created';offer_allowed:=false;offer_number:=current.offer_count;RETURN NEXT;RETURN;
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
