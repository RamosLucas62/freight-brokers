-- Persistent customer support threads. These tables are backend-only; customers
-- and administrators reach them through authenticated portal handlers.
CREATE TABLE public.audit_support_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.audit_tenants(id) ON DELETE CASCADE,
 customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 customer_name text NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 200),
 customer_email text NOT NULL CHECK (char_length(customer_email) BETWEEN 3 AND 254),
 status text NOT NULL DEFAULT 'ai' CHECK (status IN ('ai','waiting','active','resolved')),
 escalation_problem text CHECK (escalation_problem IS NULL OR char_length(escalation_problem) BETWEEN 10 AND 2000),
 escalated_at timestamptz,
 first_response_due_at timestamptz,
 first_response_at timestamptz,
 notified_at timestamptz,
 assigned_admin_id uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz
);
CREATE UNIQUE INDEX audit_support_one_open_thread ON public.audit_support_conversations(tenant_id,customer_user_id) WHERE status<>'resolved';
CREATE INDEX audit_support_queue ON public.audit_support_conversations(status,updated_at DESC);

CREATE TABLE public.audit_support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id uuid NOT NULL REFERENCES public.audit_support_conversations(id) ON DELETE CASCADE,
 author_type text NOT NULL CHECK (author_type IN ('customer','ai','admin','system')),
 author_user_id uuid REFERENCES auth.users(id),
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_support_messages_thread ON public.audit_support_messages(conversation_id,created_at,id);

ALTER TABLE public.audit_support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_support_conversations,public.audit_support_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.audit_support_conversations,public.audit_support_messages TO service_role;

CREATE FUNCTION public.portal_support_open_conversation(p_tenant uuid,p_user uuid,p_name text,p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.audit_support_conversations;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_user::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE tenant_id=p_tenant AND user_id=p_user)
 OR EXISTS(SELECT 1 FROM public.audit_portal_users WHERE user_id=p_user AND NOT enabled)
 THEN RAISE EXCEPTION 'Membership required'; END IF;
 SELECT * INTO item FROM public.audit_support_conversations WHERE tenant_id=p_tenant AND customer_user_id=p_user AND status<>'resolved' ORDER BY created_at DESC LIMIT 1;
 IF item.id IS NULL THEN
  INSERT INTO public.audit_support_conversations(tenant_id,customer_user_id,customer_name,customer_email)
  VALUES(p_tenant,p_user,left(trim(p_name),200),left(lower(trim(p_email)),254)) RETURNING * INTO item;
 END IF;
 RETURN to_jsonb(item);
END $$;

CREATE FUNCTION public.portal_support_get_conversation(p_tenant uuid,p_user uuid,p_conversation uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.audit_support_conversations; messages jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.audit_memberships WHERE tenant_id=p_tenant AND user_id=p_user) THEN RAISE EXCEPTION 'Membership required'; END IF;
 SELECT * INTO item FROM public.audit_support_conversations
 WHERE tenant_id=p_tenant AND customer_user_id=p_user AND (p_conversation IS NULL OR id=p_conversation)
 AND (p_conversation IS NOT NULL OR status<>'resolved') ORDER BY created_at DESC LIMIT 1;
 IF item.id IS NULL THEN RETURN jsonb_build_object('conversation',NULL,'messages','[]'::jsonb); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO messages
 FROM (SELECT id,author_type,body,created_at FROM public.audit_support_messages WHERE conversation_id=item.id ORDER BY created_at,id LIMIT 300) m;
 RETURN jsonb_build_object('conversation',to_jsonb(item),'messages',messages);
END $$;

CREATE FUNCTION public.portal_support_append_message(p_tenant uuid,p_user uuid,p_conversation uuid,p_author_type text,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE saved public.audit_support_messages;
BEGIN
 IF p_author_type NOT IN ('customer','ai') THEN RAISE EXCEPTION 'Invalid author'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_support_conversations WHERE id=p_conversation AND tenant_id=p_tenant AND customer_user_id=p_user AND status<>'resolved') THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 INSERT INTO public.audit_support_messages(conversation_id,author_type,author_user_id,body)
 VALUES(p_conversation,p_author_type,CASE WHEN p_author_type='customer' THEN p_user ELSE NULL END,trim(p_body)) RETURNING * INTO saved;
 UPDATE public.audit_support_conversations SET updated_at=now() WHERE id=p_conversation;
 RETURN to_jsonb(saved);
END $$;

CREATE FUNCTION public.portal_support_escalate(p_tenant uuid,p_user uuid,p_conversation uuid,p_problem text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.audit_support_conversations;
BEGIN
 SELECT * INTO item FROM public.audit_support_conversations WHERE id=p_conversation AND tenant_id=p_tenant AND customer_user_id=p_user FOR UPDATE;
 IF item.id IS NULL OR item.status='resolved' THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 IF item.status='ai' THEN
  INSERT INTO public.audit_support_messages(conversation_id,author_type,author_user_id,body) VALUES(item.id,'customer',p_user,trim(p_problem));
  UPDATE public.audit_support_conversations SET status='waiting',escalation_problem=trim(p_problem),escalated_at=now(),first_response_due_at=now()+interval '15 minutes',updated_at=now() WHERE id=item.id RETURNING * INTO item;
 END IF;
 RETURN to_jsonb(item);
END $$;

CREATE FUNCTION public.portal_support_mark_notified(p_conversation uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ UPDATE public.audit_support_conversations SET notified_at=coalesce(notified_at,now()) WHERE id=p_conversation $$;

CREATE FUNCTION public.portal_admin_support_queue(p_actor uuid,p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 IF p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'Invalid page'; END IF;
 WITH scoped AS (
  SELECT c.id,c.tenant_id,t.name AS account_name,c.customer_name,c.customer_email,c.status,c.escalation_problem,c.escalated_at,c.first_response_due_at,c.first_response_at,c.updated_at,c.resolved_at
  FROM public.audit_support_conversations c JOIN public.audit_tenants t ON t.id=c.tenant_id
 ), paged AS (SELECT * FROM scoped ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'active' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END,updated_at DESC,id LIMIT 50 OFFSET p_page*50)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM scoped),'page',p_page) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.portal_admin_support_conversation(p_actor uuid,p_conversation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; messages jsonb;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 SELECT to_jsonb(x) INTO item FROM (SELECT c.*,t.name AS account_name FROM public.audit_support_conversations c JOIN public.audit_tenants t ON t.id=c.tenant_id WHERE c.id=p_conversation) x;
 IF item IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO messages FROM (SELECT id,author_type,body,created_at FROM public.audit_support_messages WHERE conversation_id=p_conversation ORDER BY created_at,id LIMIT 300) m;
 RETURN jsonb_build_object('conversation',item,'messages',messages);
END $$;

CREATE FUNCTION public.portal_admin_support_reply(p_actor uuid,p_conversation uuid,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public.audit_support_conversations; saved public.audit_support_messages;
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 SELECT * INTO item FROM public.audit_support_conversations WHERE id=p_conversation FOR UPDATE;
 IF item.id IS NULL OR item.status='resolved' THEN RAISE EXCEPTION 'Conversation is not available'; END IF;
 INSERT INTO public.audit_support_messages(conversation_id,author_type,author_user_id,body) VALUES(item.id,'admin',p_actor,trim(p_body)) RETURNING * INTO saved;
 UPDATE public.audit_support_conversations SET status='active',assigned_admin_id=p_actor,first_response_at=coalesce(first_response_at,now()),updated_at=now() WHERE id=item.id;
 RETURN to_jsonb(saved);
END $$;

CREATE FUNCTION public.portal_admin_support_resolve(p_actor uuid,p_conversation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.portal_admin_context(p_actor);
 UPDATE public.audit_support_conversations SET status='resolved',assigned_admin_id=coalesce(assigned_admin_id,p_actor),resolved_at=now(),updated_at=now() WHERE id=p_conversation AND status<>'resolved';
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is not available'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.portal_support_open_conversation(uuid,uuid,text,text),public.portal_support_get_conversation(uuid,uuid,uuid),public.portal_support_append_message(uuid,uuid,uuid,text,text),public.portal_support_escalate(uuid,uuid,uuid,text),public.portal_support_mark_notified(uuid),public.portal_admin_support_queue(uuid,integer),public.portal_admin_support_conversation(uuid,uuid),public.portal_admin_support_reply(uuid,uuid,text),public.portal_admin_support_resolve(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_support_open_conversation(uuid,uuid,text,text),public.portal_support_get_conversation(uuid,uuid,uuid),public.portal_support_append_message(uuid,uuid,uuid,text,text),public.portal_support_escalate(uuid,uuid,uuid,text),public.portal_support_mark_notified(uuid),public.portal_admin_support_queue(uuid,integer),public.portal_admin_support_conversation(uuid,uuid),public.portal_admin_support_reply(uuid,uuid,text),public.portal_admin_support_resolve(uuid,uuid) TO service_role;
