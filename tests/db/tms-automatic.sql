INSERT INTO public.audit_tenants(id,name,alias,status) VALUES ('91000000-0000-4000-8000-000000000001','Automatic TMS','auto-tms','active');
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,sync_enabled,connection_version)
VALUES('91000000-0000-4000-8000-000000000001','tai','verified','test',now(),true,'92000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
DO $$ DECLARE c public.audit_tms_connections; n integer; result boolean; BEGIN
 SELECT * INTO c FROM public.claim_tms_sync();
 IF c.tenant_id IS DISTINCT FROM '91000000-0000-4000-8000-000000000001'::uuid OR c.sync_claim IS NULL THEN RAISE EXCEPTION 'Wrong connection claimed'; END IF;
 SELECT count(*) INTO n FROM public.claim_tms_sync();IF n<>0 THEN RAISE EXCEPTION 'Active lease claimed twice'; END IF;
 SELECT public.enqueue_tms_documents(c.tenant_id,c.provider,c.connection_version,c.sync_claim,'93000000-0000-4000-8000-000000000001','shipment-123','[{"externalId":"1","attachmentId":"94000000-0000-4000-8000-000000000001","revision":"1"}]') INTO result;
 IF NOT result THEN RAISE EXCEPTION 'Documents not queued'; END IF;
 SELECT public.enqueue_tms_documents(c.tenant_id,c.provider,c.connection_version,c.sync_claim,'93000000-0000-4000-8000-000000000001','shipment-123','[{"externalId":"1"}]') INTO result;
 IF result THEN RAISE EXCEPTION 'Duplicate queued'; END IF;
 IF (SELECT count(*) FROM public.audit_inbound_jobs WHERE tenant_id=c.tenant_id AND source='tms' AND tms_provider='tai')<>1 THEN RAISE EXCEPTION 'Incorrect source tagging or duplicate jobs'; END IF;
 BEGIN
  PERFORM public.enqueue_tms_documents(c.tenant_id,c.provider,gen_random_uuid(),c.sync_claim,gen_random_uuid(),'shipment-123','[{}]');
  RAISE EXCEPTION 'Stale connection accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TMS_CONNECTION_CHANGED' THEN RAISE; END IF; END;
 PERFORM public.finish_tms_sync(c.tenant_id,c.provider,c.connection_version,c.sync_claim,NULL);
 IF NOT EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id=c.tenant_id AND last_synced_at IS NOT NULL AND imported_batches=1 AND sync_claim IS NULL) THEN RAISE EXCEPTION 'Sync status not updated'; END IF;
 UPDATE public.audit_tms_connections SET sync_enabled=false WHERE tenant_id=c.tenant_id;
 BEGIN
  PERFORM public.enqueue_tms_documents(c.tenant_id,c.provider,c.connection_version,c.sync_claim,gen_random_uuid(),'shipment-123','[{}]');
  RAISE EXCEPTION 'Disconnected connection accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TMS_CONNECTION_CHANGED' THEN RAISE; END IF; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.claim_tms_sync();RAISE EXCEPTION 'Public sync claim allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.enqueue_tms_documents(gen_random_uuid(),'tai',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'1','[{}]');RAISE EXCEPTION 'Public queue allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
INSERT INTO public.audit_rose_connections(org_id,tenant_id,credentials_ciphertext,connection_state,connected_at)
VALUES('95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','test','pending',now());
INSERT INTO public.audit_tms_connections(tenant_id,provider,status,credentials_ciphertext,verified_at,connection_version)
VALUES('91000000-0000-4000-8000-000000000001','rose-rocket','verified','test',now(),'96000000-0000-4000-8000-000000000001');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM public.activate_rose_document_sync('91000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001');
 IF NOT EXISTS(SELECT 1 FROM public.audit_rose_connections WHERE org_id='95000000-0000-4000-8000-000000000001' AND enabled AND connection_state='connected') THEN RAISE EXCEPTION 'Webhook gate not activated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_tms_connections WHERE tenant_id='91000000-0000-4000-8000-000000000001' AND provider='rose-rocket' AND sync_enabled) THEN RAISE EXCEPTION 'Importer gate not activated'; END IF;
 PERFORM public.disconnect_rose_document_sync('91000000-0000-4000-8000-000000000001');
 BEGIN
  PERFORM public.activate_rose_document_sync('91000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'Stale activation succeeded after disconnect';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TMS_CONNECTION_CHANGED' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.audit_rose_connections WHERE org_id='95000000-0000-4000-8000-000000000001' AND (enabled OR credentials_ciphertext IS NOT NULL)) THEN RAISE EXCEPTION 'Webhook gate not disconnected'; END IF;
END $$;
RESET ROLE;
