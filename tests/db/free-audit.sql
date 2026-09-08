DO $$
DECLARE first_id uuid; second_id uuid; first_action text; second_action text; allowed boolean; verified uuid;
BEGIN
 SELECT request_id,action INTO first_id,first_action FROM public.register_free_audit_request('Lead@Example.com','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','Lead Name','Lead Co','','','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 IF first_action<>'created' THEN RAISE EXCEPTION 'First free audit was not reserved'; END IF;
 INSERT INTO public.free_audit_attachments(request_id,attachment_id,filename,storage_path,document_hash,size_bytes) VALUES(first_id,'91000000-0000-4000-8000-000000000001','invoice.pdf','free-audits/test/invoice.pdf',repeat('c',64),100);
 IF NOT public.mark_free_audit_uploaded(first_id) THEN RAISE EXCEPTION 'Upload was not finalized'; END IF;
 SELECT public.verify_free_audit_request('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') INTO verified;
 IF verified IS DISTINCT FROM first_id THEN RAISE EXCEPTION 'Verification did not queue audit'; END IF;
 SELECT request_id,action,offer_allowed INTO second_id,second_action,allowed FROM public.register_free_audit_request('lead@example.com','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','Other','Other Co','','','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
 IF second_id IS DISTINCT FROM first_id OR second_action<>'repeat' OR NOT allowed THEN RAISE EXCEPTION 'Repeat email bypassed one-audit entitlement'; END IF;
 IF (SELECT count(*) FROM public.free_audit_requests WHERE email='lead@example.com')<>1 THEN RAISE EXCEPTION 'Duplicate free audit identity created'; END IF;
 UPDATE public.free_audit_requests SET status='failed',last_error='PDF_REJECTED_INVALID_OR_ENCRYPTED' WHERE id=first_id;
 SELECT request_id,action,offer_allowed INTO second_id,second_action,allowed FROM public.register_free_audit_request('lead@example.com','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','Lead Name','Lead Co','','','1111111111111111111111111111111111111111111111111111111111111111','2222222222222222222222222222222222222222222222222222222222222222');
 IF second_id IS DISTINCT FROM first_id OR second_action<>'created' OR allowed THEN RAISE EXCEPTION 'Failed audit was incorrectly counted as used'; END IF;
 IF (SELECT verified_at IS NOT NULL OR status<>'uploading' OR attempts<>0 FROM public.free_audit_requests WHERE id=first_id) THEN RAISE EXCEPTION 'Failed audit was not reset safely'; END IF;
END $$;
