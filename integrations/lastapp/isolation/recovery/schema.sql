-- Additive recovery and synthetic-data retention. STAGING ONLY, no legacy schema changes.
BEGIN;
CREATE TABLE ed_last_stage.reconcile_state(
 location_id uuid PRIMARY KEY REFERENCES ed_last_stage.locations(location_id),
 enabled boolean NOT NULL DEFAULT false,
 window_hours integer NOT NULL DEFAULT 48 CHECK(window_hours BETWEEN 1 AND 168),
 interval_seconds integer NOT NULL DEFAULT 300 CHECK(interval_seconds BETWEEN 60 AND 3600),
 next_poll_at timestamptz NOT NULL DEFAULT '-infinity',
 sweep_id uuid, window_start timestamptz, window_end timestamptz,
 next_offset integer NOT NULL DEFAULT 0 CHECK(next_offset BETWEEN 0 AND 1000),
 page_hashes text[] NOT NULL DEFAULT '{}',
 lease_token uuid, failures integer NOT NULL DEFAULT 0,
 last_result text NOT NULL DEFAULT 'not_run', last_error_code text,
 last_enqueued integer NOT NULL DEFAULT 0, last_completed_at timestamptz
);
ALTER TABLE ed_last_stage.reconcile_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON ed_last_stage.reconcile_state TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON ed_last_stage.reconcile_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON ed_last_stage.reconcile_state TO service_role;
ALTER TABLE ed_last_stage.events ADD COLUMN ingestion_source text NOT NULL DEFAULT 'webhook' CHECK(ingestion_source IN('webhook','reconciliation'));
ALTER TABLE ed_last_stage.events ADD COLUMN payload_sha256 text;
ALTER TABLE ed_last_stage.events ADD COLUMN payload_redacted_at timestamptz;
ALTER TABLE ed_last_stage.snapshots ADD COLUMN raw_redacted_at timestamptz;
UPDATE ed_last_stage.events SET payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
CREATE FUNCTION ed_last_stage.hash_event_payload() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN NEW.payload_sha256=encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex'); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION ed_last_stage.hash_event_payload() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ed_last_stage.hash_event_payload() TO service_role;
CREATE TRIGGER event_payload_digest BEFORE INSERT ON ed_last_stage.events FOR EACH ROW EXECUTE FUNCTION ed_last_stage.hash_event_payload();
ALTER TABLE ed_last_stage.events ALTER COLUMN payload_sha256 SET NOT NULL;
DO $patch$
DECLARE src text; needle text='existing.payload IS DISTINCT FROM p_payload';
BEGIN
 src=pg_get_functiondef('public.edv9_last_receive(uuid,uuid,jsonb)'::regprocedure);
 IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Receive contract changed; review required'; END IF;
 src=replace(src,needle,'existing.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_payload::text,''UTF8'')),''hex'')');
 EXECUTE src;
END $patch$;

CREATE FUNCTION ed_last_stage.reconcile_due(p_location_id uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM ed_last_stage.reconcile_state s WHERE s.location_id=p_location_id AND s.enabled AND s.next_poll_at<=clock_timestamp());
$$;
REVOKE ALL ON FUNCTION ed_last_stage.reconcile_due(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ed_last_stage.reconcile_due(uuid) TO service_role;
CREATE FUNCTION public.edv9_last_reconcile_begin(p_location_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l ed_last_stage.locations%rowtype; s ed_last_stage.reconcile_state%rowtype; token uuid;
BEGIN
 SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=p_location_id FOR UPDATE;
 IF NOT FOUND OR NOT l.enabled OR l.lease_until>clock_timestamp() OR l.next_request_at>clock_timestamp() THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM ed_last_stage.queue_routes r CROSS JOIN ed_last_stage.queue_control c WHERE r.location_id=p_location_id AND r.enabled AND r.expires_at>clock_timestamp() AND c.enabled AND (r.source_kind='synthetic' OR c.sandbox_enabled)) THEN RETURN NULL; END IF;
 SELECT * INTO s FROM ed_last_stage.reconcile_state WHERE location_id=p_location_id FOR UPDATE;
 IF NOT FOUND OR NOT s.enabled OR s.next_poll_at>clock_timestamp() THEN RETURN NULL; END IF;
 IF s.sweep_id IS NULL THEN
  s.sweep_id=gen_random_uuid();s.window_end=clock_timestamp();s.window_start=s.window_end-make_interval(hours=>s.window_hours);s.next_offset=0;s.page_hashes='{}';
 END IF;
 token=gen_random_uuid();
 UPDATE ed_last_stage.reconcile_state SET sweep_id=s.sweep_id,window_start=s.window_start,window_end=s.window_end,next_offset=s.next_offset,page_hashes=s.page_hashes,lease_token=token WHERE location_id=p_location_id;
 UPDATE ed_last_stage.locations SET lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',next_request_at=clock_timestamp()+interval '500 milliseconds' WHERE location_id=p_location_id;
 RETURN jsonb_build_object('location_id',p_location_id,'lease_token',token,'start_date',s.window_start,'end_date',s.window_end,'offset',s.next_offset,'limit',100);
END $$;
CREATE FUNCTION public.edv9_last_reconcile_page(p_location_id uuid,p_lease_token uuid,p_ids uuid[],p_row_count integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l ed_last_stage.locations%rowtype; s ed_last_stage.reconcile_state%rowtype; tid uuid; doc jsonb; eid text; n integer=0; result text; fingerprint text;
BEGIN
 SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=p_location_id FOR UPDATE;
 SELECT * INTO s FROM ed_last_stage.reconcile_state WHERE location_id=p_location_id FOR UPDATE;
 IF l.location_id IS NULL OR s.location_id IS NULL OR NOT l.enabled OR NOT s.enabled OR l.lease_token IS DISTINCT FROM p_lease_token OR s.lease_token IS DISTINCT FROM p_lease_token OR l.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('state','lost_lease','queued',0); END IF;
 IF NOT EXISTS(SELECT 1 FROM ed_last_stage.queue_routes r CROSS JOIN ed_last_stage.queue_control c WHERE r.location_id=p_location_id AND r.enabled AND r.expires_at>clock_timestamp() AND c.enabled AND (r.source_kind='synthetic' OR c.sandbox_enabled)) THEN RETURN jsonb_build_object('state','lost_lease','queued',0); END IF;
 IF p_ids IS NULL OR p_row_count IS NULL OR p_row_count NOT BETWEEN 0 AND 100 OR cardinality(p_ids)>p_row_count OR array_position(p_ids,NULL) IS NOT NULL OR (p_row_count>0 AND cardinality(p_ids)=0) THEN RAISE EXCEPTION 'invalid_page'; END IF;
 SELECT md5(coalesce(string_agg(x::text,',' ORDER BY x),'')) INTO fingerprint FROM (SELECT DISTINCT unnest(p_ids) x) q;
 IF p_row_count=100 AND fingerprint=ANY(s.page_hashes) THEN result='stalled';
 ELSE
  FOR tid IN SELECT DISTINCT unnest(p_ids) LOOP
   IF EXISTS(SELECT 1 FROM ed_last_stage.events WHERE location_id=p_location_id AND tab_id=tid AND state IN('pending','retry','processing')) THEN CONTINUE; END IF;
   eid='rc:'||s.sweep_id::text||':'||tid::text;
   doc=jsonb_build_object('id',eid,'type','tab:updated','data',jsonb_build_object('id',tid,'locationId',p_location_id),'internal_source','reconciliation');
   INSERT INTO ed_last_stage.events(event_id,location_id,tab_id,event_type,payload,ingestion_source) VALUES(eid,p_location_id,tid,'tab:updated',doc,'reconciliation') ON CONFLICT DO NOTHING;
   IF FOUND THEN n=n+1; END IF;
  END LOOP;
  result=CASE WHEN p_row_count<100 THEN 'completed' WHEN s.next_offset+p_row_count>=1000 THEN 'truncated' ELSE 'partial' END;
 END IF;
 UPDATE ed_last_stage.reconcile_state SET next_offset=CASE WHEN result='partial' THEN next_offset+p_row_count ELSE 0 END,
  page_hashes=CASE WHEN result='partial' THEN array_append(page_hashes,fingerprint) ELSE '{}'::text[] END,
  sweep_id=CASE WHEN result='partial' THEN sweep_id ELSE NULL END,lease_token=NULL,failures=0,last_error_code=NULL,
  last_result=result,last_enqueued=n,enabled=CASE WHEN result='stalled' THEN false ELSE enabled END,
  next_poll_at=CASE WHEN result='partial' THEN clock_timestamp()+interval '500 milliseconds' ELSE clock_timestamp()+make_interval(secs=>interval_seconds) END,
  last_completed_at=CASE WHEN result='completed' THEN clock_timestamp() ELSE last_completed_at END WHERE location_id=p_location_id;
 UPDATE ed_last_stage.locations SET lease_token=NULL,lease_until=NULL WHERE location_id=p_location_id;
 RETURN jsonb_build_object('state',result,'queued',n);
END $$;
CREATE FUNCTION public.edv9_last_reconcile_fail(p_location_id uuid,p_lease_token uuid,p_code text,p_delay integer) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE l ed_last_stage.locations%rowtype; s ed_last_stage.reconcile_state%rowtype; delay_s integer;
BEGIN
 IF p_code IS NULL OR p_code NOT IN('last_unauthorized','last_rate_limited','last_unavailable','last_timeout','invalid_tab','worker_error') OR p_delay IS NULL OR p_delay NOT BETWEEN 0 AND 86400 THEN RAISE EXCEPTION 'invalid_error'; END IF;
 SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=p_location_id FOR UPDATE;
 SELECT * INTO s FROM ed_last_stage.reconcile_state WHERE location_id=p_location_id FOR UPDATE;
 IF l.location_id IS NULL OR s.location_id IS NULL OR l.lease_token IS DISTINCT FROM p_lease_token OR s.lease_token IS DISTINCT FROM p_lease_token OR l.lease_until<=clock_timestamp() THEN RETURN false; END IF;
 delay_s=greatest(p_delay,least(300,5*power(2,least(s.failures,6))::integer));
 UPDATE ed_last_stage.reconcile_state SET failures=failures+1,lease_token=NULL,last_result='error',last_error_code=p_code,
  next_poll_at=clock_timestamp()+make_interval(secs=>delay_s),enabled=enabled AND failures<4 AND p_code NOT IN('last_unauthorized','invalid_tab') WHERE location_id=p_location_id;
 UPDATE ed_last_stage.locations SET lease_token=NULL,lease_until=NULL,next_request_at=greatest(next_request_at,clock_timestamp()+make_interval(secs=>delay_s)) WHERE location_id=p_location_id;
 RETURN true;
END $$;
CREATE FUNCTION public.edv9_last_reconcile_fixture(p_location_id uuid,p_lease_token uuid,p_offset integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 900 THEN RAISE EXCEPTION 'invalid_offset'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.key,'locationId',p_location_id)),'[]'::jsonb) INTO rows FROM (
  SELECT f.key FROM ed_last_stage.queue_routes r JOIN ed_last_stage.locations l USING(location_id),LATERAL jsonb_each(r.fixtures) f
  WHERE r.location_id=p_location_id AND r.source_kind='synthetic' AND r.enabled AND l.enabled AND r.expires_at>clock_timestamp() AND l.lease_token=p_lease_token AND l.lease_until>clock_timestamp()
  ORDER BY f.key LIMIT 100 OFFSET p_offset
 ) q;
 RETURN rows;
END $$;
REVOKE ALL ON FUNCTION public.edv9_last_reconcile_begin(uuid),public.edv9_last_reconcile_page(uuid,uuid,uuid[],integer),public.edv9_last_reconcile_fail(uuid,uuid,text,integer),public.edv9_last_reconcile_fixture(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edv9_last_reconcile_begin(uuid),public.edv9_last_reconcile_page(uuid,uuid,uuid[],integer),public.edv9_last_reconcile_fail(uuid,uuid,text,integer),public.edv9_last_reconcile_fixture(uuid,uuid,integer) TO service_role;
-- Extend route discovery without touching the original integration or queue worker contract.
DO $patch$
DECLARE src text; needle text;
BEGIN
 src=pg_get_functiondef('public.edv9_last_queue_begin(text)'::regprocedure);
 needle='AND EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=l.location_id';
 IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Queue selection changed; review required'; END IF;
 src=replace(src,needle,'AND (ed_last_stage.reconcile_due(l.location_id) OR EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=l.location_id');
 needle='OR e.state=''processing'' AND e.lease_until<=clock_timestamp()))';
 IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Queue selection terminator changed'; END IF;
 src=replace(src,needle,needle||')');EXECUTE src;
END $patch$;
CREATE FUNCTION ed_last_stage.recovery_tick() RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE due boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM ed_last_stage.reconcile_state s JOIN ed_last_stage.locations l USING(location_id) JOIN ed_last_stage.queue_routes r USING(location_id) CROSS JOIN ed_last_stage.queue_control c WHERE c.enabled AND s.enabled AND s.next_poll_at<=clock_timestamp() AND l.enabled AND r.enabled AND r.expires_at>clock_timestamp() AND (r.source_kind='synthetic' OR c.sandbox_enabled) AND l.next_request_at<=clock_timestamp() AND (l.lease_until IS NULL OR l.lease_until<=clock_timestamp())) INTO due;
 RETURN ed_last_stage.queue_tick(due);
END $$;
REVOKE ALL ON FUNCTION ed_last_stage.recovery_tick() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE ed_last_stage.retention_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),synthetic_enabled boolean NOT NULL DEFAULT false,days integer NOT NULL DEFAULT 7 CHECK(days BETWEEN 1 AND 90));
INSERT INTO ed_last_stage.retention_control(singleton) VALUES(true);
ALTER TABLE ed_last_stage.retention_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON ed_last_stage.retention_control TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON ed_last_stage.retention_control FROM PUBLIC,anon,authenticated;
GRANT SELECT ON ed_last_stage.retention_control TO service_role;
CREATE FUNCTION ed_last_stage.redact_expired_synthetic(p_apply boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c ed_last_stage.retention_control%rowtype; loc uuid; n_events integer=0;n_snaps integer=0; n integer;cutoff timestamptz;
BEGIN
 SELECT * INTO c FROM ed_last_stage.retention_control WHERE singleton;
 IF NOT FOUND THEN RAISE EXCEPTION 'retention_not_configured'; END IF;
 cutoff=clock_timestamp()-make_interval(days=>c.days);
 IF p_apply AND NOT c.synthetic_enabled THEN RETURN jsonb_build_object('enabled',false,'events',0,'snapshots',0); END IF;
 -- Lock locations in the same order as receive/claim/complete. Never redact live or queued data.
 FOR loc IN SELECT l.location_id FROM ed_last_stage.locations l JOIN ed_last_stage.queue_routes r USING(location_id) WHERE r.source_kind='synthetic' AND NOT r.enabled AND r.expires_at<clock_timestamp() AND NOT l.enabled AND (l.lease_until IS NULL OR l.lease_until<=clock_timestamp()) ORDER BY l.location_id FOR UPDATE OF l SKIP LOCKED LOOP
  IF p_apply THEN
   UPDATE ed_last_stage.events SET payload='{}'::jsonb,payload_redacted_at=clock_timestamp() WHERE event_id IN(SELECT event_id FROM ed_last_stage.events WHERE location_id=loc AND state IN('processed','ignored','dead') AND received_at<cutoff AND payload_redacted_at IS NULL LIMIT 1000);
   GET DIAGNOSTICS n=ROW_COUNT;n_events=n_events+n;
   UPDATE ed_last_stage.snapshots SET raw=jsonb_build_object('id',tab_id,'locationId',location_id,'retained_stub',true),raw_redacted_at=clock_timestamp(),is_delivery=false,revision=revision+1 WHERE location_id=loc AND raw_redacted_at IS NULL AND fetched_at<cutoff AND NOT EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=loc AND e.tab_id=ed_last_stage.snapshots.tab_id AND e.state IN('pending','retry','processing'));
   GET DIAGNOSTICS n=ROW_COUNT;n_snaps=n_snaps+n;
  ELSE
   SELECT count(*) INTO n FROM ed_last_stage.events WHERE location_id=loc AND state IN('processed','ignored','dead') AND received_at<cutoff AND payload_redacted_at IS NULL;n_events=n_events+n;
   SELECT count(*) INTO n FROM ed_last_stage.snapshots s WHERE s.location_id=loc AND s.raw_redacted_at IS NULL AND s.fetched_at<cutoff AND NOT EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=loc AND e.tab_id=s.tab_id AND e.state IN('pending','retry','processing'));n_snaps=n_snaps+n;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('applied',p_apply,'events',n_events,'snapshots',n_snaps,'scope','expired_synthetic_only');
END $$;
REVOKE ALL ON FUNCTION ed_last_stage.redact_expired_synthetic(boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ed_last_stage.recovery_maintenance() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM ed_last_stage.queue_maintenance();PERFORM ed_last_stage.redact_expired_synthetic(true);END $$;
REVOKE ALL ON FUNCTION ed_last_stage.recovery_maintenance() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
