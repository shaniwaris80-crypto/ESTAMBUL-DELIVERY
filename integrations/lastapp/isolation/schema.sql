-- Standalone staging bootstrap, NOT a production migration.
-- Run only in a new disposable PostgreSQL database; no historical migration required.
BEGIN;
DO $$
BEGIN
  IF current_setting('ed_last_stage.bootstrap', true) IS DISTINCT FROM 'ISOLATED_TEST_DATABASE' THEN
    RAISE EXCEPTION 'Explicit isolated database bootstrap guard required';
  END IF;
  IF to_regclass('public.ed_orders') IS NOT NULL OR to_regclass('private.ed_last_locations') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing bootstrap alongside the legacy integration';
  END IF;
END $$;

CREATE SCHEMA ed_last_stage;
REVOKE ALL ON SCHEMA ed_last_stage FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ed_last_stage TO service_role;

CREATE TABLE ed_last_stage.locations (
  location_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_until timestamptz,
  next_request_at timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE ed_last_stage.events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 1 AND 128),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  location_id uuid NOT NULL REFERENCES ed_last_stage.locations(location_id),
  tab_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'tab:created','tab:updated','tab:closed','tab:cancelled','tab:delivery-status-updated')),
  source_created_at timestamptz,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','retry','processed','ignored','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease_token uuid,
  lease_until timestamptz,
  not_before timestamptz NOT NULL DEFAULT '-infinity',
  error_code text
);
CREATE INDEX events_ready ON ed_last_stage.events(location_id, seq)
  WHERE state IN ('pending','retry','processing');
CREATE TABLE ed_last_stage.snapshots (
  location_id uuid NOT NULL REFERENCES ed_last_stage.locations(location_id),
  tab_id uuid NOT NULL,
  source_event_id text NOT NULL REFERENCES ed_last_stage.events(event_id),
  revision bigint NOT NULL DEFAULT 1,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  is_delivery boolean NOT NULL,
  raw jsonb NOT NULL CHECK (jsonb_typeof(raw) = 'object'),
  PRIMARY KEY(location_id, tab_id)
);

ALTER TABLE ed_last_stage.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ed_last_stage.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ed_last_stage.snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON ed_last_stage.locations TO service_role USING (true) WITH CHECK (true);
CREATE POLICY backend_only ON ed_last_stage.events TO service_role USING (true) WITH CHECK (true);
CREATE POLICY backend_only ON ed_last_stage.snapshots TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON ALL TABLES IN SCHEMA ed_last_stage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ed_last_stage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ed_last_stage TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ed_last_stage TO service_role;

-- Authentication of HTTP webhooks is outside this DB contract. Only the backend
-- role can call these RPCs; no browser/rider/customer access is granted.
CREATE FUNCTION public.edv9_last_receive(p_location_id uuid, p_organization_id uuid, p_payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  l ed_last_stage.locations%rowtype;
  existing ed_last_stage.events%rowtype;
  eid text; kind text; tid uuid; created_at timestamptz;
BEGIN
  SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=p_location_id FOR SHARE;
  IF NOT FOUND OR NOT l.enabled THEN RAISE EXCEPTION 'location_not_approved'; END IF;
  IF p_organization_id IS NOT NULL AND p_organization_id<>l.organization_id THEN
    RAISE EXCEPTION 'organization_mismatch';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>160000 THEN
    RAISE EXCEPTION 'invalid_event';
  END IF;
  eid=p_payload->>'id'; kind=p_payload->>'type';
  IF eid IS NULL OR length(eid) NOT BETWEEN 1 AND 128 OR kind IS NULL OR kind NOT IN (
    'tab:created','tab:updated','tab:closed','tab:cancelled','tab:delivery-status-updated') THEN
    RAISE EXCEPTION 'unsupported_or_invalid_event';
  END IF;
  IF jsonb_typeof(p_payload->'data') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_event'; END IF;
  IF p_payload#>>'{data,locationId}' IS NOT NULL AND (p_payload#>>'{data,locationId}')::uuid<>l.location_id THEN
    RAISE EXCEPTION 'location_mismatch';
  END IF;
  IF p_payload#>>'{data,organizationId}' IS NOT NULL AND (p_payload#>>'{data,organizationId}')::uuid<>l.organization_id THEN
    RAISE EXCEPTION 'organization_mismatch';
  END IF;
  tid=(CASE WHEN kind='tab:delivery-status-updated' THEN p_payload#>>'{data,tabId}' ELSE p_payload#>>'{data,id}' END)::uuid;
  IF tid IS NULL THEN RAISE EXCEPTION 'invalid_tab_id'; END IF;
  created_at=(p_payload->>'created')::timestamptz;
  INSERT INTO ed_last_stage.events(event_id,location_id,tab_id,event_type,source_created_at,payload)
    VALUES(eid,l.location_id,tid,kind,created_at,p_payload) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN 'received'; END IF;
  SELECT * INTO existing FROM ed_last_stage.events WHERE event_id=eid;
  IF existing.location_id IS DISTINCT FROM l.location_id OR existing.payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'event_id_conflict';
  END IF;
  RETURN 'duplicate';
END $$;

-- One in-flight fetch per location. The lease token fences late workers after
-- recovery. A 500 ms interval caps this module at 2 requests/s per location;
-- never run it beside the old importer with the same quota without coordination.
CREATE FUNCTION public.edv9_last_claim(p_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE l ed_last_stage.locations%rowtype; e ed_last_stage.events%rowtype; token uuid;
BEGIN
  SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=p_location_id FOR UPDATE;
  IF NOT FOUND OR NOT l.enabled OR l.lease_until>clock_timestamp() OR l.next_request_at>clock_timestamp() THEN RETURN NULL; END IF;
  UPDATE ed_last_stage.events SET state='dead',error_code='lease_exhausted',lease_token=NULL,lease_until=NULL
    WHERE location_id=p_location_id AND state='processing' AND lease_until<=clock_timestamp() AND attempts>=5;
  SELECT * INTO e FROM ed_last_stage.events
    WHERE location_id=p_location_id AND attempts<5 AND not_before<=clock_timestamp()
      AND (state IN ('pending','retry') OR (state='processing' AND lease_until<=clock_timestamp()))
    ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  token=gen_random_uuid();
  UPDATE ed_last_stage.events SET state='processing',attempts=attempts+1,
    lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',error_code=NULL
    WHERE event_id=e.event_id;
  UPDATE ed_last_stage.locations SET lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',
    next_request_at=clock_timestamp()+interval '500 milliseconds' WHERE location_id=p_location_id;
  RETURN jsonb_build_object('event_id',e.event_id,'tab_id',e.tab_id,'location_id',p_location_id,
    'event_type',e.event_type,'lease_token',token);
END $$;

CREATE FUNCTION public.edv9_last_complete(p_event_id text, p_lease_token uuid, p_tab jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE l ed_last_stage.locations%rowtype; e ed_last_stage.events%rowtype; loc uuid; deliver boolean; doc jsonb;
BEGIN
  SELECT location_id INTO loc FROM ed_last_stage.events WHERE event_id=p_event_id;
  SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=loc FOR UPDATE;
  SELECT * INTO e FROM ed_last_stage.events WHERE event_id=p_event_id FOR UPDATE;
  IF e.event_id IS NULL OR NOT l.enabled OR l.lease_token IS DISTINCT FROM p_lease_token
    OR e.lease_token IS DISTINCT FROM p_lease_token OR e.state<>'processing'
    OR l.lease_until<=clock_timestamp() OR e.lease_until<=clock_timestamp() THEN RETURN 'lost_lease'; END IF;
  IF jsonb_typeof(p_tab) IS DISTINCT FROM 'object' OR octet_length(p_tab::text)>1000000
    OR (p_tab->>'id')::uuid IS DISTINCT FROM e.tab_id
    OR (p_tab->>'locationId')::uuid IS DISTINCT FROM loc THEN RAISE EXCEPTION 'invalid_tab'; END IF;
  deliver=coalesce(lower(p_tab->>'pickupType') IN ('delivery','owndelivery')
    AND jsonb_typeof(p_tab->'delivery')='object',false);
  -- Non-delivery tabs become minimal inactive snapshots, including when an
  -- existing delivery changes to takeaway. Never leave stale dispatch data active.
  doc=CASE WHEN deliver THEN p_tab ELSE jsonb_build_object('id',e.tab_id,'locationId',loc,'pickupType',p_tab->'pickupType') END;
  INSERT INTO ed_last_stage.snapshots(location_id,tab_id,source_event_id,is_delivery,raw)
    VALUES(loc,e.tab_id,e.event_id,deliver,doc)
    ON CONFLICT(location_id,tab_id) DO UPDATE SET
      revision=ed_last_stage.snapshots.revision+CASE WHEN ed_last_stage.snapshots.raw IS DISTINCT FROM excluded.raw THEN 1 ELSE 0 END,
      raw=excluded.raw,is_delivery=excluded.is_delivery,source_event_id=excluded.source_event_id,fetched_at=clock_timestamp();
  UPDATE ed_last_stage.events SET state=CASE WHEN deliver THEN 'processed' ELSE 'ignored' END,
    lease_token=NULL,lease_until=NULL,error_code=NULL WHERE event_id=e.event_id;
  UPDATE ed_last_stage.locations SET lease_token=NULL,lease_until=NULL WHERE location_id=loc;
  RETURN CASE WHEN deliver THEN 'processed' ELSE 'ignored' END;
END $$;

CREATE FUNCTION public.edv9_last_fail(p_event_id text, p_lease_token uuid, p_error_code text, p_retry_after_seconds integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE l ed_last_stage.locations%rowtype; e ed_last_stage.events%rowtype; loc uuid; terminal boolean; delay_s integer;
BEGIN
  IF p_error_code IS NULL OR p_error_code NOT IN ('last_unauthorized','last_not_found','last_rate_limited','last_unavailable','last_timeout','invalid_tab','worker_error') THEN
    RAISE EXCEPTION 'invalid_error_code';
  END IF;
  IF p_retry_after_seconds IS NULL OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN RAISE EXCEPTION 'invalid_retry_delay'; END IF;
  SELECT location_id INTO loc FROM ed_last_stage.events WHERE event_id=p_event_id;
  SELECT * INTO l FROM ed_last_stage.locations WHERE location_id=loc FOR UPDATE;
  SELECT * INTO e FROM ed_last_stage.events WHERE event_id=p_event_id FOR UPDATE;
  IF e.event_id IS NULL OR l.lease_token IS DISTINCT FROM p_lease_token OR e.lease_token IS DISTINCT FROM p_lease_token
    OR e.state<>'processing' OR l.lease_until<=clock_timestamp() THEN RETURN 'lost_lease'; END IF;
  terminal=e.attempts>=5 OR p_error_code IN ('last_unauthorized','last_not_found','invalid_tab');
  delay_s=greatest(p_retry_after_seconds,least(300,5*power(2,e.attempts-1)::integer));
  UPDATE ed_last_stage.events SET state=CASE WHEN terminal THEN 'dead' ELSE 'retry' END,
    not_before=clock_timestamp()+make_interval(secs=>delay_s),error_code=p_error_code,lease_token=NULL,lease_until=NULL
    WHERE event_id=e.event_id;
  UPDATE ed_last_stage.locations SET lease_token=NULL,lease_until=NULL,
    next_request_at=CASE WHEN p_error_code='last_rate_limited' THEN greatest(next_request_at,clock_timestamp()+make_interval(secs=>delay_s)) ELSE next_request_at END
    WHERE location_id=loc;
  RETURN CASE WHEN terminal THEN 'dead' ELSE 'retry' END;
END $$;

REVOKE ALL ON FUNCTION public.edv9_last_receive(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.edv9_last_claim(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.edv9_last_complete(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.edv9_last_fail(text,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edv9_last_receive(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edv9_last_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.edv9_last_complete(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edv9_last_fail(text,uuid,text,integer) TO service_role;
COMMIT;
