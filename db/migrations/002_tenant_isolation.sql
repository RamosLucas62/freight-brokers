-- Reserved audit_* names avoid the existing CRM tables. Backend owns all mutations.
CREATE TABLE IF NOT EXISTS public.audit_tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
 alias text NOT NULL UNIQUE CHECK (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(alias) <= 63),
 status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','paused')),
 is_test boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.audit_memberships (
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 PRIMARY KEY (tenant_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.audit_report_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id),
 email text NOT NULL CHECK (email = lower(trim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 enabled boolean NOT NULL DEFAULT true,
 verified_at timestamptz,
 UNIQUE (tenant_id,email)
);
INSERT INTO public.audit_tenants(id,name,alias,status,is_test) VALUES
 ('00000000-0000-4000-8000-000000000001','Synthetic audit tests','synthetic-tests','active',true),
 ('00000000-0000-4000-8000-000000000002','Unassigned legacy records','legacy-unassigned','inactive',true)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.audit_tenants(id);
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.audit_tenants(id);
ALTER TABLE public.audit_runs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.audit_tenants(id);
-- Assign only known synthetic files; unknown historical rows are quarantined, never assigned to a customer.
UPDATE public.invoices SET tenant_id = CASE WHEN source_file IN (
 'output/pdf/TEST-FREIGHT-20260905-001.pdf','output/pdf/test-duplicate.pdf',
 'output/pdf/test-banking-change.pdf','output/pdf/test-missing-fields.pdf')
 THEN '00000000-0000-4000-8000-000000000001'::uuid ELSE '00000000-0000-4000-8000-000000000002'::uuid END
WHERE tenant_id IS NULL;
UPDATE public.exceptions e SET tenant_id=i.tenant_id FROM public.invoices i WHERE e.invoice_id=i.id AND e.tenant_id IS NULL;
UPDATE public.audit_runs SET tenant_id=CASE WHEN run_id IN (
 '66419f1d-d845-4b7c-bc81-a593fc52a0b8','d11ad402-bdea-4104-a4e0-0eb2f2eff3a5')
 THEN '00000000-0000-4000-8000-000000000001'::uuid ELSE '00000000-0000-4000-8000-000000000002'::uuid END
WHERE tenant_id IS NULL;
UPDATE public.audit_runs SET report=jsonb_set(report,'{tenant_id}',to_jsonb(tenant_id::text));
ALTER TABLE public.invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.exceptions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.audit_runs ALTER COLUMN tenant_id SET NOT NULL;
DROP INDEX IF EXISTS public.idx_invoices_document_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_hash ON public.invoices(tenant_id,document_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_id ON public.invoices(tenant_id,id);
CREATE INDEX IF NOT EXISTS idx_exceptions_tenant ON public.exceptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_tenant ON public.audit_runs(tenant_id);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='exceptions_tenant_invoice_fk' AND conrelid='public.exceptions'::regclass) THEN
 ALTER TABLE public.exceptions ADD CONSTRAINT exceptions_tenant_invoice_fk FOREIGN KEY (tenant_id,invoice_id) REFERENCES public.invoices(tenant_id,id);
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.commit_audit(jsonb,jsonb,jsonb,uuid[]);
CREATE OR REPLACE FUNCTION public.commit_audit(p_tenant_id uuid,p_invoices jsonb,p_exceptions jsonb,p_report jsonb,p_history_ids uuid[])
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE current_ids uuid[]; account_status text;
BEGIN
 -- Account row lock serializes its audits and status changes without blocking other clients.
 SELECT status INTO account_status FROM public.audit_tenants WHERE id=p_tenant_id FOR UPDATE;
 IF account_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Audit account is not active'; END IF;
 IF jsonb_typeof(p_invoices) IS DISTINCT FROM 'array' OR jsonb_typeof(p_exceptions) IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_report) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid audit payload'; END IF;
 IF p_report->>'tenant_id' IS DISTINCT FROM p_tenant_id::text
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_invoices) i WHERE i->>'tenant_id' IS DISTINCT FROM p_tenant_id::text)
 THEN RAISE EXCEPTION 'Cross-account audit rejected'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_exceptions) e WHERE NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(p_invoices) i WHERE i->>'id'=e->>'invoice_id'))
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_report->'exceptions') e WHERE NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(p_invoices) i WHERE i->>'id'=e->>'invoice_id'))
 THEN RAISE EXCEPTION 'Exception outside current audit'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO current_ids FROM public.invoices WHERE tenant_id=p_tenant_id;
 IF current_ids IS DISTINCT FROM ARRAY(SELECT unnest(p_history_ids) ORDER BY 1) THEN RAISE EXCEPTION 'Invoice history changed during this audit. Retry the batch.'; END IF;
 INSERT INTO public.invoices SELECT * FROM jsonb_populate_recordset(NULL::public.invoices,p_invoices);
 INSERT INTO public.exceptions(tenant_id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,metadata)
 SELECT p_tenant_id,invoice_id,tipo_regra,valor_envolvido,descricao,source_file,source_page,metadata
 FROM jsonb_populate_recordset(NULL::public.exceptions,p_exceptions);
 INSERT INTO public.audit_runs(run_id,tenant_id,report) VALUES ((p_report->>'run_id')::uuid,p_tenant_id,p_report);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_audit(uuid,jsonb,jsonb,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_audit(uuid,jsonb,jsonb,jsonb,uuid[]) TO service_role;
-- RLS is read-only for members; membership and status cannot be self-assigned.
ALTER TABLE public.audit_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_report_contacts ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit_tenants','audit_memberships','audit_report_contacts','invoices','exceptions','audit_runs'] LOOP
 EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO service_role',t);
 -- Restrictive guard also constrains any pre-existing permissive SELECT policies.
 EXECUTE format('DROP POLICY IF EXISTS audit_member_read ON public.%I',t);
 EXECUTE format('DROP POLICY IF EXISTS audit_member_guard ON public.%I',t);
 IF t='audit_memberships' THEN
 EXECUTE 'CREATE POLICY audit_member_read ON public.audit_memberships FOR SELECT TO authenticated USING (user_id=auth.uid())';
 EXECUTE 'CREATE POLICY audit_member_guard ON public.audit_memberships AS RESTRICTIVE FOR SELECT TO authenticated USING (user_id=auth.uid())';
 ELSIF t='audit_tenants' THEN
 EXECUTE 'CREATE POLICY audit_member_read ON public.audit_tenants FOR SELECT TO authenticated USING (id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))';
 EXECUTE 'CREATE POLICY audit_member_guard ON public.audit_tenants AS RESTRICTIVE FOR SELECT TO authenticated USING (id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))';
 ELSE
 EXECUTE format('CREATE POLICY audit_member_read ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))',t);
 EXECUTE format('CREATE POLICY audit_member_guard ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.audit_memberships WHERE user_id=auth.uid()))',t);
 END IF;
 END LOOP;
END $$;
