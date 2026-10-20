-- NEW operational application. STAGING only. Does not modify legacy tables or ingestion.
BEGIN;
CREATE SCHEMA ed_app_v9;
REVOKE ALL ON SCHEMA ed_app_v9 FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA ed_app_v9 TO service_role;
CREATE TABLE ed_app_v9.settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),generation integer NOT NULL DEFAULT 1,restaurant_phone text,tracking_origin text,default_language text NOT NULL DEFAULT 'es',sms_enabled boolean NOT NULL DEFAULT false);
INSERT INTO ed_app_v9.settings(singleton) VALUES(true);
CREATE TABLE ed_app_v9.invites(email text PRIMARY KEY CHECK(email=lower(email)),role text NOT NULL CHECK(role IN('admin','rider')),label text NOT NULL,slot integer UNIQUE CHECK(slot BETWEEN 1 AND 6),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE ed_app_v9.members(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,role text NOT NULL CHECK(role IN('admin','rider')),label text NOT NULL,slot integer UNIQUE,active boolean NOT NULL DEFAULT true,online boolean NOT NULL DEFAULT false,position jsonb,last_gps_at timestamptz,push_token text);
CREATE TABLE ed_app_v9.courier_map(location_id uuid NOT NULL,courier_id text NOT NULL,member_id uuid NOT NULL REFERENCES ed_app_v9.members(id),PRIMARY KEY(location_id,courier_id));
CREATE TABLE ed_app_v9.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),location_id uuid NOT NULL,external_id uuid NOT NULL,source_revision bigint NOT NULL,source jsonb NOT NULL,reference text NOT NULL,rider_id uuid REFERENCES ed_app_v9.members(id),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','accepted','on_delivery','delivered','cancelled')),version integer NOT NULL DEFAULT 1,generation integer NOT NULL,synthetic boolean NOT NULL DEFAULT false,accepted_at timestamptz,delivered_at timestamptz,share_location boolean NOT NULL DEFAULT false,total_cents bigint CHECK(total_cents>=0),due_cents bigint CHECK(due_cents>=0),payment_method text CHECK(payment_method IN('cash','card','online')),paid_cents bigint CHECK(paid_cents>=0),payment_actor uuid,financial_review boolean NOT NULL DEFAULT false,collection_note text,checklist jsonb NOT NULL DEFAULT '[]',consent_sms boolean NOT NULL DEFAULT false,closure_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(location_id,external_id));
CREATE INDEX orders_rider_active ON ed_app_v9.orders(rider_id,generation,state);
CREATE TABLE ed_app_v9.links(order_id uuid PRIMARY KEY REFERENCES ed_app_v9.orders(id),token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false);
CREATE TABLE ed_app_v9.messages(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES ed_app_v9.orders(id),sender text NOT NULL CHECK(sender IN('admin','rider','customer')),sender_id uuid,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX messages_order_time ON ed_app_v9.messages(order_id,created_at);
CREATE TABLE ed_app_v9.feedback(order_id uuid PRIMARY KEY REFERENCES ed_app_v9.orders(id),rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),body text NOT NULL DEFAULT '' CHECK(length(body)<=600),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ed_app_v9.outbox(order_id uuid PRIMARY KEY REFERENCES ed_app_v9.orders(id),phone text,tracking_url text,status text NOT NULL DEFAULT 'blocked' CHECK(status IN('blocked','pending','sending','queued','sent','delivered','undelivered','failed','unknown')),sid text UNIQUE,attempt_id uuid,last_error text,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE ed_app_v9.closures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rider_id uuid NOT NULL REFERENCES ed_app_v9.members(id),cash_cents bigint NOT NULL,card_cents bigint NOT NULL,online_cents bigint NOT NULL,declared_cents bigint NOT NULL CHECK(declared_cents>=0),difference_cents bigint NOT NULL,order_count integer NOT NULL,notes text NOT NULL DEFAULT '',closed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE ed_app_v9.orders ADD FOREIGN KEY(closure_id) REFERENCES ed_app_v9.closures(id);
CREATE TABLE ed_app_v9.audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor uuid,action text NOT NULL,order_id uuid,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE ed_app_v9.operations(actor uuid NOT NULL,key uuid NOT NULL,action text NOT NULL,input_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor,key));
CREATE TABLE ed_app_v9.rate_limits(key text PRIMARY KEY,window_at timestamptz NOT NULL,hits integer NOT NULL);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['settings','invites','members','courier_map','orders','links','messages','feedback','outbox','closures','audit','operations','rate_limits'] LOOP
  EXECUTE format('ALTER TABLE ed_app_v9.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY server_only ON ed_app_v9.%I TO service_role USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA ed_app_v9 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ed_app_v9 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ed_app_v9 TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ed_app_v9 TO service_role;

-- Only the Edge backend can call this after validating a CONFIRMED email via Auth /user.
CREATE FUNCTION public.edv9_app_identify(p_user uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m ed_app_v9.members%rowtype;i ed_app_v9.invites%rowtype;
BEGIN
 IF p_user IS NULL OR p_email IS NULL THEN RAISE EXCEPTION 'unauthorized';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('edv9_app_write'));
 SELECT * INTO m FROM ed_app_v9.members WHERE id=p_user;
 IF NOT FOUND THEN
  SELECT * INTO i FROM ed_app_v9.invites WHERE email=lower(p_email) AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_not_invited';END IF;
  INSERT INTO ed_app_v9.members(id,email,role,label,slot) VALUES(p_user,lower(p_email),i.role,i.label,i.slot) RETURNING * INTO m;
 END IF;
 IF NOT m.active OR m.email<>lower(p_email) THEN RAISE EXCEPTION 'account_disabled';END IF;
 RETURN to_jsonb(m)-'position'-'push_token';
END $$;
CREATE FUNCTION public.edv9_app_limit(p_key text,p_max integer) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF p_key IS NULL OR length(p_key)>160 OR p_max NOT BETWEEN 1 AND 300 THEN RETURN false;END IF;
 INSERT INTO ed_app_v9.rate_limits AS r(key,window_at,hits) VALUES(p_key,clock_timestamp(),1)
 ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN r.window_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE r.hits+1 END,window_at=CASE WHEN r.window_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE r.window_at END RETURNING hits INTO n;
 RETURN n<=p_max;
END $$;
CREATE FUNCTION public.edv9_app_read(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m ed_app_v9.members%rowtype;s ed_app_v9.settings%rowtype;
BEGIN
 SELECT * INTO m FROM ed_app_v9.members WHERE id=p_actor AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized';END IF;
 SELECT * INTO s FROM ed_app_v9.settings WHERE singleton;
 RETURN jsonb_build_object('me',to_jsonb(m)-'push_token','settings',to_jsonb(s),
  'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('notification',(SELECT to_jsonb(b)-'phone'-'tracking_url' FROM ed_app_v9.outbox b WHERE b.order_id=o.id),'rating',(SELECT rating FROM ed_app_v9.feedback f WHERE f.order_id=o.id))) FROM (SELECT * FROM ed_app_v9.orders WHERE generation=s.generation AND (m.role='admin' OR rider_id=m.id) ORDER BY (state IN('delivered','cancelled')),created_at LIMIT 500) o),'[]'::jsonb),
  'riders',coalesce((SELECT jsonb_agg(to_jsonb(r)-'push_token'-'email') FROM ed_app_v9.members r WHERE r.role='rider' AND (m.role='admin' OR r.id=m.id)),'[]'::jsonb),
  'closures',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT * FROM ed_app_v9.closures WHERE m.role='admin' OR rider_id=m.id ORDER BY closed_at DESC LIMIT 100) c),'[]'::jsonb),
  'invites',CASE WHEN m.role='admin' THEN coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM ed_app_v9.invites i),'[]'::jsonb) ELSE '[]'::jsonb END,
  'server_time',clock_timestamp(),'environment','staging','live_last_verified',false);
END $$;
CREATE FUNCTION public.edv9_app_command(p_actor uuid,p_key uuid,p_action text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m ed_app_v9.members%rowtype;o ed_app_v9.orders%rowtype;s ed_app_v9.settings%rowtype;old ed_app_v9.operations%rowtype;result jsonb;h text;token text;url text;amt bigint;cash bigint;card bigint;online_total bigint;n integer;cid uuid;target uuid;note text;due bigint;
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>150000 THEN RAISE EXCEPTION 'invalid_input';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('edv9_app_write'));
 SELECT * INTO m FROM ed_app_v9.members WHERE id=p_actor AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized';END IF;
 SELECT * INTO s FROM ed_app_v9.settings WHERE singleton;
 h=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 SELECT * INTO old FROM ed_app_v9.operations WHERE actor=p_actor AND key=p_key;
 IF FOUND THEN IF old.action<>p_action OR old.input_hash<>h THEN RAISE EXCEPTION 'idempotency_conflict';END IF;RETURN old.result;END IF;
 IF p_action='online' THEN
  IF m.role<>'rider' THEN RAISE EXCEPTION 'forbidden';END IF;
  UPDATE ed_app_v9.members SET online=coalesce((p_data->>'online')::boolean,false),position=CASE WHEN p_data->>'online'='true' THEN position ELSE NULL END WHERE id=m.id;
  result=jsonb_build_object('ok',true);
 ELSIF p_action='gps' THEN
  IF m.role<>'rider' OR NOT m.online THEN RAISE EXCEPTION 'rider_offline';END IF;
  IF (p_data->>'lat')::double precision NOT BETWEEN -90 AND 90 OR (p_data->>'lng')::double precision NOT BETWEEN -180 AND 180 OR p_data->>'lat' IS NULL OR p_data->>'lng' IS NULL OR (p_data->>'accuracy')::numeric NOT BETWEEN 0 AND 3000 THEN RAISE EXCEPTION 'invalid_coordinates';END IF;
  IF NOT EXISTS(SELECT 1 FROM ed_app_v9.orders WHERE rider_id=m.id AND state IN('accepted','on_delivery') AND generation=s.generation) THEN RAISE EXCEPTION 'no_active_delivery';END IF;
  UPDATE ed_app_v9.members SET position=jsonb_build_object('lat',(p_data->>'lat')::double precision,'lng',(p_data->>'lng')::double precision,'accuracy',(p_data->>'accuracy')::numeric),last_gps_at=clock_timestamp() WHERE id=m.id;
  RETURN jsonb_build_object('ok',true); -- GPS does not accumulate command deduplication records.
 ELSIF p_action='push_token' THEN
  IF m.role<>'rider' OR p_data->>'token' !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' THEN RAISE EXCEPTION 'invalid_push_token';END IF;
  UPDATE ed_app_v9.members SET push_token=p_data->>'token' WHERE id=m.id;result=jsonb_build_object('ok',true);
 ELSIF p_action='settings' THEN
  IF m.role<>'admin' THEN RAISE EXCEPTION 'forbidden';END IF;
  url=nullif(trim(p_data->>'tracking_origin'),'');
  IF url IS NOT NULL AND (length(url)>180 OR url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9/_-]*)?$') THEN RAISE EXCEPTION 'invalid_tracking_origin';END IF;
  IF nullif(p_data->>'restaurant_phone','') IS NOT NULL AND p_data->>'restaurant_phone' !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'invalid_phone';END IF;
  UPDATE ed_app_v9.settings SET restaurant_phone=nullif(p_data->>'restaurant_phone',''),tracking_origin=url,sms_enabled=coalesce((p_data->>'sms_enabled')::boolean,false) WHERE singleton;
  result=jsonb_build_object('ok',true);
 ELSIF p_action='map_courier' THEN
  IF m.role<>'admin' THEN RAISE EXCEPTION 'forbidden';END IF;
  target=(p_data->>'rider_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM ed_app_v9.members WHERE id=target AND active AND role='rider') OR coalesce(length(p_data->>'courier_id'),0) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'invalid_rider';END IF;
  INSERT INTO ed_app_v9.courier_map(location_id,courier_id,member_id) VALUES((p_data->>'location_id')::uuid,p_data->>'courier_id',target) ON CONFLICT(location_id,courier_id) DO UPDATE SET member_id=excluded.member_id;
  result=jsonb_build_object('ok',true);
 ELSIF p_action='close_shift' THEN
  IF m.role<>'rider' THEN RAISE EXCEPTION 'forbidden';END IF;
  IF EXISTS(SELECT 1 FROM ed_app_v9.orders WHERE rider_id=m.id AND closure_id IS NULL AND generation=s.generation AND state NOT IN('delivered','cancelled')) THEN RAISE EXCEPTION 'active_orders_remaining';END IF;
  IF EXISTS(SELECT 1 FROM ed_app_v9.orders WHERE rider_id=m.id AND closure_id IS NULL AND state='delivered' AND (payment_method IS NULL OR paid_cents IS NULL OR financial_review)) THEN RAISE EXCEPTION 'unresolved_payments';END IF;
  SELECT count(*),coalesce(sum(paid_cents) FILTER(WHERE payment_method='cash'),0),coalesce(sum(paid_cents) FILTER(WHERE payment_method='card'),0),coalesce(sum(paid_cents) FILTER(WHERE payment_method='online'),0) INTO n,cash,card,online_total FROM ed_app_v9.orders WHERE rider_id=m.id AND closure_id IS NULL AND state='delivered';
  IF n=0 THEN RAISE EXCEPTION 'nothing_to_close';END IF;
  amt=(p_data->>'declared_cents')::bigint;note=coalesce(p_data->>'notes','');
  IF amt IS NULL OR amt<0 OR length(note)>1000 OR (amt<>cash AND length(trim(note))<3) THEN RAISE EXCEPTION 'explain_cash_difference';END IF;
  INSERT INTO ed_app_v9.closures(rider_id,cash_cents,card_cents,online_cents,declared_cents,difference_cents,order_count,notes) VALUES(m.id,cash,card,online_total,amt,amt-cash,n,note) RETURNING id INTO cid;
  UPDATE ed_app_v9.orders SET closure_id=cid,version=version+1 WHERE rider_id=m.id AND closure_id IS NULL AND state='delivered';
  UPDATE ed_app_v9.members SET online=false,position=NULL WHERE id=m.id;
  result=jsonb_build_object('ok',true,'closure_id',cid,'cash_cents',cash,'card_cents',card,'online_cents',online_total,'difference_cents',amt-cash,'order_count',n);
 ELSIF p_action='reset_day' THEN
  IF m.role<>'admin' OR p_data->>'confirmation'<>'ARCHIVAR JORNADA' THEN RAISE EXCEPTION 'forbidden';END IF;
  IF EXISTS(SELECT 1 FROM ed_app_v9.orders WHERE generation=s.generation AND (state NOT IN('delivered','cancelled') OR (state='delivered' AND closure_id IS NULL))) THEN RAISE EXCEPTION 'close_all_orders_first';END IF;
  UPDATE ed_app_v9.links SET revoked=true WHERE order_id IN(SELECT id FROM ed_app_v9.orders WHERE generation=s.generation);
  UPDATE ed_app_v9.settings SET generation=generation+1 WHERE singleton;
  result=jsonb_build_object('ok',true,'generation',s.generation+1);
 ELSE
  SELECT * INTO o FROM ed_app_v9.orders WHERE id=(p_data->>'order_id')::uuid FOR UPDATE;
  IF NOT FOUND OR o.generation<>s.generation OR (m.role<>'admin' AND o.rider_id IS DISTINCT FROM m.id) THEN RAISE EXCEPTION 'order_not_accessible';END IF;
  IF p_action<>'chat' AND coalesce((p_data->>'version')::integer,-1)<>o.version THEN RAISE EXCEPTION 'version_conflict';END IF;
  IF p_action='accept' THEN
   IF m.role<>'rider' OR NOT m.online OR o.state NOT IN('pending','accepted') THEN RAISE EXCEPTION 'invalid_transition';END IF;
   IF o.state='pending' THEN
    UPDATE ed_app_v9.orders SET state='accepted',accepted_at=clock_timestamp(),share_location=true,version=version+1,updated_at=clock_timestamp() WHERE id=o.id;
    IF NOT EXISTS(SELECT 1 FROM ed_app_v9.links WHERE order_id=o.id) THEN
     token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
     INSERT INTO ed_app_v9.links(order_id,token_hash,expires_at) VALUES(o.id,encode(sha256(convert_to(token,'UTF8')),'hex'),clock_timestamp()+interval '48 hours');
     url=CASE WHEN s.tracking_origin IS NOT NULL THEN rtrim(s.tracking_origin,'/')||'/#track='||token ELSE NULL END;
     INSERT INTO ed_app_v9.outbox(order_id,phone,tracking_url,status,last_error) VALUES(o.id,o.source#>>'{customer,phone}',url,CASE WHEN s.sms_enabled AND o.consent_sms AND url IS NOT NULL AND coalesce(o.source#>>'{customer,phone}','')~'^\+[1-9][0-9]{7,14}$' THEN 'pending' ELSE 'blocked' END,'configuration_or_consent_required') ON CONFLICT DO NOTHING;
    END IF;
   END IF;
   result=jsonb_build_object('ok',true,'notification',(SELECT status FROM ed_app_v9.outbox WHERE order_id=o.id));
  ELSIF p_action='start' THEN
   IF m.role<>'rider' OR o.state<>'accepted' OR NOT m.online THEN RAISE EXCEPTION 'invalid_transition';END IF;
   UPDATE ed_app_v9.orders SET state='on_delivery',version=version+1,updated_at=clock_timestamp() WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='due' THEN
   IF m.role<>'admin' OR o.closure_id IS NOT NULL OR o.payment_method IS NOT NULL THEN RAISE EXCEPTION 'forbidden';END IF;
   amt=(p_data->>'amount_cents')::bigint;
   IF amt IS NULL OR amt<0 OR amt>1000000 THEN RAISE EXCEPTION 'invalid_amount';END IF;
   UPDATE ed_app_v9.orders SET due_cents=amt,consent_sms=coalesce((p_data->>'consent_sms')::boolean,consent_sms),version=version+1 WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='payment' THEN
   IF o.state NOT IN('accepted','on_delivery','delivered') OR o.closure_id IS NOT NULL OR o.payment_method IS NOT NULL THEN RAISE EXCEPTION 'payment_locked';END IF;
   amt=(p_data->>'amount_cents')::bigint;
   IF p_data->>'method' NOT IN('cash','card','online') OR (p_data->>'method'='online' AND m.role<>'admin') THEN RAISE EXCEPTION 'invalid_payment_method';END IF;
   due=CASE WHEN p_data->>'method'='online' THEN o.total_cents ELSE o.due_cents END;
   IF amt IS NULL OR due IS NULL OR amt<>due OR amt<0 THEN RAISE EXCEPTION 'amount_not_confirmed';END IF;
   UPDATE ed_app_v9.orders SET paid_cents=amt,payment_method=p_data->>'method',payment_actor=m.id,collection_note=left(coalesce(p_data->>'note',''),600),financial_review=false,version=version+1,updated_at=clock_timestamp() WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='deliver' THEN
   IF m.role<>'rider' OR o.state<>'on_delivery' THEN RAISE EXCEPTION 'invalid_transition';END IF;
   IF o.payment_method IS NULL OR o.paid_cents IS NULL OR o.financial_review THEN RAISE EXCEPTION 'payment_required';END IF;
   UPDATE ed_app_v9.orders SET state='delivered',delivered_at=clock_timestamp(),share_location=false,version=version+1,updated_at=clock_timestamp() WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='share' THEN
   UPDATE ed_app_v9.orders SET share_location=coalesce((p_data->>'enabled')::boolean,false) AND state IN('accepted','on_delivery'),version=version+1 WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='checklist' THEN
   IF jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'items')>200 THEN RAISE EXCEPTION 'invalid_checklist';END IF;
   UPDATE ed_app_v9.orders SET checklist=p_data->'items',version=version+1 WHERE id=o.id;result=jsonb_build_object('ok',true);
  ELSIF p_action='chat' THEN
   note=trim(p_data->>'body');IF length(note) NOT BETWEEN 1 AND 1000 OR note IS NULL OR o.state IN('delivered','cancelled') THEN RAISE EXCEPTION 'chat_closed';END IF;
   INSERT INTO ed_app_v9.messages(id,order_id,sender,sender_id,body) VALUES(p_key,o.id,m.role,m.id,note);result=jsonb_build_object('ok',true);
  ELSE RAISE EXCEPTION 'unknown_action';END IF;
 END IF;
 INSERT INTO ed_app_v9.audit(actor,action,order_id) VALUES(m.id,p_action,o.id);
 INSERT INTO ed_app_v9.operations(actor,key,action,input_hash,result) VALUES(m.id,p_key,p_action,h,result);
 RETURN result;
END $$;
CREATE FUNCTION public.edv9_app_chat(p_actor uuid,p_order uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ed_app_v9.members m JOIN ed_app_v9.orders o ON o.id=p_order WHERE m.id=p_actor AND m.active AND (m.role='admin' OR o.rider_id=m.id)) THEN RAISE EXCEPTION 'forbidden';END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q)-'sender_id') FROM (SELECT * FROM ed_app_v9.messages WHERE order_id=p_order ORDER BY created_at DESC LIMIT 100) q),'[]'::jsonb);
END $$;
-- Called by server after validating the bearer tracking capability, never exposed as public RPC.
CREATE FUNCTION public.edv9_app_track(p_hash text,p_action text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE o ed_app_v9.orders%rowtype;r ed_app_v9.members%rowtype;phone text;msg text;k uuid;
BEGIN
 SELECT a.* INTO o FROM ed_app_v9.orders a JOIN ed_app_v9.links l ON l.order_id=a.id JOIN ed_app_v9.settings s ON s.singleton AND a.generation=s.generation WHERE l.token_hash=p_hash AND NOT l.revoked AND l.expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'tracking_unavailable';END IF;
 SELECT restaurant_phone INTO phone FROM ed_app_v9.settings WHERE singleton;
 IF p_action='chat' THEN
  IF o.state NOT IN('accepted','on_delivery') THEN RAISE EXCEPTION 'chat_closed';END IF;
  msg=trim(p_data->>'body');k=(p_data->>'key')::uuid;
  IF msg IS NULL OR length(msg) NOT BETWEEN 1 AND 1000 OR k IS NULL THEN RAISE EXCEPTION 'invalid_message';END IF;
  INSERT INTO ed_app_v9.messages(id,order_id,sender,body) VALUES(k,o.id,'customer',msg) ON CONFLICT(id) DO NOTHING;
 ELSIF p_action='feedback' THEN
  IF o.state<>'delivered' THEN RAISE EXCEPTION 'not_delivered';END IF;
  INSERT INTO ed_app_v9.feedback(order_id,rating,body) VALUES(o.id,(p_data->>'rating')::int,left(coalesce(p_data->>'body',''),600)) ON CONFLICT(order_id) DO NOTHING;
 ELSIF p_action<>'read' THEN RAISE EXCEPTION 'unknown_action';END IF;
 SELECT * INTO r FROM ed_app_v9.members WHERE id=o.rider_id AND active AND online;
 RETURN jsonb_build_object('reference',o.reference,'state',o.state,'restaurant_phone',phone,'rider_name',CASE WHEN o.state IN('accepted','on_delivery') THEN r.label ELSE NULL END,'position',CASE WHEN o.share_location AND o.state IN('accepted','on_delivery') AND r.last_gps_at>clock_timestamp()-interval '90 seconds' THEN r.position ELSE NULL END,'gps_at',CASE WHEN o.share_location AND o.state IN('accepted','on_delivery') THEN r.last_gps_at ELSE NULL END,'destination',jsonb_build_object('lat',o.source#>'{destination,lat}','lng',o.source#>'{destination,lng}'),'chat',coalesce((SELECT jsonb_agg(to_jsonb(q)-'sender_id'-'order_id') FROM (SELECT * FROM ed_app_v9.messages WHERE order_id=o.id ORDER BY created_at DESC LIMIT 100) q),'[]'::jsonb),'rating',(SELECT rating FROM ed_app_v9.feedback WHERE order_id=o.id),'environment','staging');
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'edv9_app_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
COMMIT;
