-- STAGING ONLY. Install only in project rknxqlijcgpbecoophva after inspecting extensions.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE FUNCTION ed_last_stage.queue_tick(p_force boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c ed_last_stage.queue_control%rowtype; raw_token text; rid uuid; request bigint; due boolean;
BEGIN
 SELECT * INTO c FROM ed_last_stage.queue_control WHERE singleton FOR UPDATE;
 UPDATE ed_last_stage.queue_control SET last_tick_at=clock_timestamp() WHERE singleton;
 IF NOT c.enabled THEN RETURN NULL; END IF;
 UPDATE ed_last_stage.queue_runs SET state='expired' WHERE state IN ('sent','running') AND expires_at<=clock_timestamp();
 IF EXISTS(SELECT 1 FROM ed_last_stage.queue_runs WHERE state IN ('sent','running') AND expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
 SELECT EXISTS(SELECT 1 FROM ed_last_stage.queue_routes r JOIN ed_last_stage.locations l USING(location_id)
  WHERE r.enabled AND l.enabled AND r.expires_at>clock_timestamp()
   AND (r.source_kind='synthetic' OR c.sandbox_enabled)
   AND l.next_request_at<=clock_timestamp() AND (l.lease_until IS NULL OR l.lease_until<=clock_timestamp())
   AND EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=l.location_id
    AND (e.state IN ('pending','retry') AND e.not_before<=clock_timestamp()
     OR e.state='processing' AND e.lease_until<=clock_timestamp()))) INTO due;
 -- Idle heartbeat at most every 15 minutes. No Last.app request is made without an approved route.
 IF NOT p_force AND NOT due AND c.last_dispatch_at>clock_timestamp()-interval '15 minutes' THEN RETURN NULL; END IF;
 raw_token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO ed_last_stage.queue_runs(token_hash) VALUES(encode(sha256(convert_to(raw_token,'UTF8')),'hex')) RETURNING id INTO rid;
 SELECT net.http_post(url:='https://rknxqlijcgpbecoophva.supabase.co/functions/v1/edv9-last-queue/drain',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||raw_token),
  body:='{}'::jsonb,timeout_milliseconds:=60000) INTO request;
 UPDATE ed_last_stage.queue_runs SET request_id=request WHERE id=rid;
 UPDATE ed_last_stage.queue_control SET last_dispatch_at=clock_timestamp() WHERE singleton;
 RETURN request;
END $$;
REVOKE ALL ON FUNCTION ed_last_stage.queue_tick(boolean) FROM PUBLIC,anon,authenticated,service_role;
-- Only the database owner runs this private maintenance; it never touches order/event data.
CREATE FUNCTION ed_last_stage.queue_maintenance()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 DELETE FROM ed_last_stage.queue_runs WHERE expires_at<clock_timestamp()-interval '7 days';
$$;
REVOKE ALL ON FUNCTION ed_last_stage.queue_maintenance() FROM PUBLIC,anon,authenticated,service_role;
-- Install schedules in a separate, explicit operation after deploying the Edge Function.
COMMIT;
