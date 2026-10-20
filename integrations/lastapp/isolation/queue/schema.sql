-- Additive queue control for inspected STAGING only. No legacy tables or secrets.
BEGIN;
CREATE TABLE ed_last_stage.queue_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 sandbox_enabled boolean NOT NULL DEFAULT false,
 last_tick_at timestamptz,
 last_dispatch_at timestamptz
);
INSERT INTO ed_last_stage.queue_control(singleton) VALUES(true);
CREATE TABLE ed_last_stage.queue_routes (
 location_id uuid PRIMARY KEY REFERENCES ed_last_stage.locations(location_id),
 source_kind text NOT NULL CHECK(source_kind IN ('sandbox','synthetic')),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 last_selected_at timestamptz NOT NULL DEFAULT '-infinity',
 fixtures jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fixtures)='object' AND octet_length(fixtures::text)<250000),
 CHECK(source_kind='synthetic' OR fixtures='{}'::jsonb)
);
CREATE TABLE ed_last_stage.queue_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '100 seconds',
 state text NOT NULL DEFAULT 'sent' CHECK(state IN ('sent','running','finished','expired')),
 request_id bigint,
 started_at timestamptz,
 finished_at timestamptz,
 report jsonb
);
CREATE INDEX queue_runs_inflight ON ed_last_stage.queue_runs(expires_at) WHERE state IN ('sent','running');
ALTER TABLE ed_last_stage.queue_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE ed_last_stage.queue_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ed_last_stage.queue_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON ed_last_stage.queue_control TO service_role USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON ed_last_stage.queue_routes TO service_role USING(true) WITH CHECK(true);
CREATE POLICY backend_only ON ed_last_stage.queue_runs TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON ed_last_stage.queue_control,ed_last_stage.queue_routes,ed_last_stage.queue_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON ed_last_stage.queue_control,ed_last_stage.queue_routes,ed_last_stage.queue_runs TO service_role;

CREATE FUNCTION public.edv9_last_queue_begin(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE run_id uuid; routes jsonb; allowed boolean;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 -- Serialize consumption and freeze eligibility only after validating the one-use ticket.
 UPDATE ed_last_stage.queue_runs SET state='running',started_at=clock_timestamp()
  WHERE token_hash=p_hash AND state='sent' AND expires_at>clock_timestamp() RETURNING id INTO run_id;
 IF run_id IS NULL THEN RETURN NULL; END IF;
 SELECT enabled INTO allowed FROM ed_last_stage.queue_control WHERE singleton;
 IF allowed THEN
  WITH ready AS (
   SELECT r.location_id,r.source_kind FROM ed_last_stage.queue_routes r
   JOIN ed_last_stage.locations l USING(location_id)
   WHERE r.enabled AND r.expires_at>clock_timestamp() AND l.enabled
    AND (r.source_kind='synthetic' OR (SELECT sandbox_enabled FROM ed_last_stage.queue_control WHERE singleton))
    AND (l.lease_until IS NULL OR l.lease_until<=clock_timestamp()) AND l.next_request_at<=clock_timestamp()
    AND EXISTS(SELECT 1 FROM ed_last_stage.events e WHERE e.location_id=l.location_id
      AND (e.state IN ('pending','retry') AND e.not_before<=clock_timestamp()
       OR e.state='processing' AND e.lease_until<=clock_timestamp()))
   ORDER BY r.last_selected_at,r.location_id LIMIT 8
  ), chosen AS (
   UPDATE ed_last_stage.queue_routes r SET last_selected_at=clock_timestamp()
   FROM ready x WHERE r.location_id=x.location_id RETURNING r.location_id,r.source_kind
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',location_id,'source_kind',source_kind)),'[]'::jsonb) INTO routes FROM chosen;
 ELSE routes='[]'::jsonb; END IF;
 RETURN jsonb_build_object('run_id',run_id,'routes',routes,'queue_enabled',coalesce(allowed,false));
END $$;

CREATE FUNCTION public.edv9_last_queue_claim(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ed_last_stage.queue_routes r CROSS JOIN ed_last_stage.queue_control c
  WHERE r.location_id=p_location_id AND r.enabled AND r.expires_at>clock_timestamp() AND c.enabled
   AND (r.source_kind='synthetic' OR c.sandbox_enabled)) THEN RETURN NULL; END IF;
 RETURN public.edv9_last_claim(p_location_id);
END $$;

CREATE FUNCTION public.edv9_last_queue_fixture(p_location_id uuid,p_tab_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f jsonb; a integer;
BEGIN
 SELECT r.fixtures->p_tab_id::text INTO f FROM ed_last_stage.queue_routes r
 JOIN ed_last_stage.locations l USING(location_id)
 WHERE r.location_id=p_location_id AND r.source_kind='synthetic' AND r.enabled AND l.enabled
  AND r.expires_at>clock_timestamp();
 IF f IS NULL THEN RAISE EXCEPTION 'fixture_not_approved'; END IF;
 SELECT attempts INTO a FROM ed_last_stage.events WHERE location_id=p_location_id AND tab_id=p_tab_id
  AND state='processing' AND lease_until>clock_timestamp() ORDER BY seq LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'fixture_without_claim'; END IF;
 RETURN jsonb_build_object('tab',f->'tab','fail_first',coalesce(f->'fail_first','false'::jsonb),'attempt',a);
END $$;

CREATE FUNCTION public.edv9_last_queue_finish(p_run_id uuid,p_report jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE safe jsonb='{}'::jsonb; k text; n integer;
BEGIN
 IF jsonb_typeof(p_report) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_report'; END IF;
 FOREACH k IN ARRAY ARRAY['processed','ignored','retry','dead','lost_lease','idle','storage_errors','attempted','synthetic_reads','sandbox_reads'] LOOP
  IF coalesce(p_report->>k,'0') !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'invalid_report'; END IF;
  n=coalesce((p_report->>k)::integer,0);
  IF n>100 THEN RAISE EXCEPTION 'invalid_report'; END IF;
  safe=safe||jsonb_build_object(k,n);
 END LOOP;
 FOREACH k IN ARRAY ARRAY['queue_enabled','sandbox_enabled','sandbox_token_present'] LOOP
  safe=safe||jsonb_build_object(k,coalesce(p_report->k,'false'::jsonb)='true'::jsonb);
 END LOOP;
 UPDATE ed_last_stage.queue_runs SET state='finished',finished_at=clock_timestamp(),report=safe
  WHERE id=p_run_id AND state='running' AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.edv9_last_queue_begin(text),public.edv9_last_queue_claim(uuid),public.edv9_last_queue_fixture(uuid,uuid),public.edv9_last_queue_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edv9_last_queue_begin(text),public.edv9_last_queue_claim(uuid),public.edv9_last_queue_fixture(uuid,uuid),public.edv9_last_queue_finish(uuid,jsonb) TO service_role;
COMMIT;
