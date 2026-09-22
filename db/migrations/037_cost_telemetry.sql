CREATE TABLE public.audit_cost_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES public.audit_tenants(id) ON DELETE CASCADE,
 subject_type text NOT NULL CHECK (subject_type IN ('audit_run','free_audit','support_conversation','public_support','manual')),
 subject_id text,
 provider text NOT NULL,
 service text NOT NULL,
 operation text NOT NULL,
 model text,
 request_id text,
 input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
 output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
 total_tokens bigint CHECK (total_tokens IS NULL OR total_tokens >= 0),
 cost_usd numeric(18,9) CHECK (cost_usd IS NULL OR cost_usd >= 0),
 quantity numeric(18,6) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
 unit text NOT NULL DEFAULT 'request',
 cost_status text NOT NULL DEFAULT 'actual' CHECK (cost_status IN ('actual','estimated','pending')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX audit_cost_events_provider_request_uidx ON public.audit_cost_events(provider,request_id);
CREATE INDEX audit_cost_events_tenant_created_idx ON public.audit_cost_events(tenant_id,created_at DESC);
CREATE INDEX audit_cost_events_subject_idx ON public.audit_cost_events(subject_type,subject_id,created_at DESC);
ALTER TABLE public.audit_cost_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.portal_admin_costs(p_actor uuid,p_tenant uuid DEFAULT NULL,p_from timestamptz DEFAULT date_trunc('month',now()),p_to timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE output jsonb;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to-p_from > interval '366 days' THEN RAISE EXCEPTION 'invalid cost range'; END IF;
 SELECT jsonb_build_object(
  'from',p_from,'to',p_to,'tenant_id',p_tenant,
  'summary',jsonb_build_object(
   'cost_usd',coalesce(sum(cost_usd),0),'pending_cost_events',count(*) FILTER (WHERE cost_usd IS NULL),
   'requests',count(*),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'total_tokens',coalesce(sum(total_tokens),0)),
  'by_tenant',coalesce((SELECT jsonb_agg(row_to_json(t) ORDER BY t.cost_usd DESC) FROM (
   SELECT e.tenant_id,coalesce(a.name,'Unattributed / lead') AS customer,coalesce(sum(e.cost_usd),0) AS cost_usd,count(*) AS requests
   FROM public.audit_cost_events e LEFT JOIN public.audit_tenants a ON a.id=e.tenant_id
   WHERE e.created_at>=p_from AND e.created_at<p_to AND (p_tenant IS NULL OR e.tenant_id=p_tenant) GROUP BY e.tenant_id,a.name) t),'[]'::jsonb),
  'by_operation',coalesce((SELECT jsonb_agg(row_to_json(o) ORDER BY o.cost_usd DESC) FROM (
   SELECT provider,service,operation,model,coalesce(sum(cost_usd),0) AS cost_usd,count(*) AS requests,coalesce(sum(total_tokens),0) AS total_tokens
   FROM public.audit_cost_events e WHERE e.created_at>=p_from AND e.created_at<p_to AND (p_tenant IS NULL OR e.tenant_id=p_tenant)
   GROUP BY provider,service,operation,model) o),'[]'::jsonb)
 ) INTO output
 FROM public.audit_cost_events e WHERE e.created_at>=p_from AND e.created_at<p_to AND (p_tenant IS NULL OR e.tenant_id=p_tenant);
 RETURN output;
END $$;

REVOKE ALL ON public.audit_cost_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.portal_admin_costs(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.audit_cost_events TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_admin_costs(uuid,uuid,timestamptz,timestamptz) TO service_role;
