ALTER TABLE public.invoices
 ADD COLUMN IF NOT EXISTS verification jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.audit_confidence_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL,
 predicted_status text NOT NULL CHECK(predicted_status IN ('verified','review','unverifiable')),
 predicted_confidence numeric NOT NULL CHECK(predicted_confidence BETWEEN 0 AND 1),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','confirmed','corrected')),
 corrected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,invoice_id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.invoices(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_confidence_reviews_pending ON public.audit_confidence_reviews(tenant_id,created_at)
 WHERE review_status='pending';

CREATE OR REPLACE FUNCTION public.enqueue_confidence_sample() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF coalesce((NEW.verification->>'sampled_for_quality_control')::boolean,false) THEN
  INSERT INTO public.audit_confidence_reviews(tenant_id,invoice_id,predicted_status,predicted_confidence)
  VALUES(NEW.tenant_id,NEW.id,coalesce(NEW.verification->>'status','unverifiable'),coalesce((NEW.verification->>'confidence')::numeric,0))
  ON CONFLICT(tenant_id,invoice_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enqueue_confidence_sample ON public.invoices;
CREATE TRIGGER enqueue_confidence_sample AFTER INSERT ON public.invoices
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_confidence_sample();

ALTER TABLE public.audit_confidence_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_confidence_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.audit_confidence_reviews TO service_role;
GRANT SELECT ON public.audit_confidence_reviews TO authenticated;
CREATE POLICY audit_member_read ON public.audit_confidence_reviews FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));
CREATE POLICY audit_member_guard ON public.audit_confidence_reviews AS RESTRICTIVE FOR SELECT TO authenticated
 USING(tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.portal_review_confidence_sample(
 p_user uuid,p_tenant uuid,p_invoice uuid,p_result text,p_corrected_fields jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE user_id=p_user AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Membership required'; END IF;
 IF p_result NOT IN ('confirmed','corrected') OR jsonb_typeof(p_corrected_fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid review'; END IF;
 UPDATE public.audit_confidence_reviews SET review_status=p_result,corrected_fields=p_corrected_fields,
  reviewed_by=p_user,reviewed_at=now() WHERE tenant_id=p_tenant AND invoice_id=p_invoice AND review_status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending confidence review not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.portal_review_confidence_sample(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_review_confidence_sample(uuid,uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_admin_confidence_reviews(p_actor uuid,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 IF p_page < 0 OR p_page > 100000 THEN RAISE EXCEPTION 'Invalid page'; END IF;
 WITH scoped AS (
  SELECT r.id,r.tenant_id,t.name AS company_name,r.invoice_id,i.numero_fatura,i.carrier_name,i.source_file,
   r.predicted_status,r.predicted_confidence,r.review_status,r.corrected_fields,r.reviewed_at,r.created_at
  FROM public.audit_confidence_reviews r
  JOIN public.audit_tenants t ON t.id=r.tenant_id
  JOIN public.invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id
 ), paged AS (
  SELECT * FROM scoped ORDER BY (review_status='pending') DESC,created_at DESC,id LIMIT 50 OFFSET p_page*50
 )
 SELECT jsonb_build_object(
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged),'[]'::jsonb),
  'total',(SELECT count(*) FROM scoped),'page',p_page
 ) INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.portal_admin_review_confidence(
 p_actor uuid,p_review uuid,p_result text,p_corrected_fields jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE review_row public.audit_confidence_reviews%ROWTYPE; actor_email text;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 IF p_result NOT IN ('confirmed','corrected') OR jsonb_typeof(p_corrected_fields) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid review'; END IF;
 SELECT * INTO review_row FROM public.audit_confidence_reviews WHERE id=p_review AND review_status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending confidence review not found'; END IF;
 UPDATE public.audit_confidence_reviews SET review_status=p_result,corrected_fields=p_corrected_fields,
  reviewed_by=p_actor,reviewed_at=now() WHERE id=p_review;
 SELECT lower(email) INTO actor_email FROM auth.users WHERE id=p_actor;
 INSERT INTO public.audit_admin_activity(actor_id,actor_email,action,tenant_id,company_name,details)
 SELECT p_actor,actor_email,'confidence.review',review_row.tenant_id,t.name,
  jsonb_build_object('review_id',p_review,'invoice_id',review_row.invoice_id,'result',p_result,'predicted_status',review_row.predicted_status,'corrected_fields',p_corrected_fields)
 FROM public.audit_tenants t WHERE t.id=review_row.tenant_id;
END $$;

REVOKE ALL ON FUNCTION public.portal_admin_confidence_reviews(uuid,integer),public.portal_admin_review_confidence(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_admin_confidence_reviews(uuid,integer),public.portal_admin_review_confidence(uuid,uuid,text,jsonb) TO service_role;
