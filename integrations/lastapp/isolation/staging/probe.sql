-- Staging-only synthetic probe. Admin provisions hash + expiry; no persistent test secret.
CREATE TABLE ed_last_stage.probes (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 location_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 organization_id uuid NOT NULL DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL DEFAULT gen_random_uuid(),
 tab_id uuid NOT NULL DEFAULT gen_random_uuid(),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 finished_at timestamptz,
 passed boolean,
 report jsonb
);
ALTER TABLE ed_last_stage.probes ENABLE ROW LEVEL SECURITY;
CREATE POLICY backend_only ON ed_last_stage.probes TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE ed_last_stage.probes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON TABLE ed_last_stage.probes TO service_role;
CREATE INDEX snapshots_source_event ON ed_last_stage.snapshots(source_event_id);

CREATE FUNCTION public.edv9_last_probe_begin(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p ed_last_stage.probes%rowtype;
BEGIN
 SELECT * INTO p FROM ed_last_stage.probes WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR p.used_at IS NOT NULL OR p.expires_at<=clock_timestamp()
   OR p.expires_at>clock_timestamp()+interval '10 minutes' THEN RETURN NULL; END IF;
 UPDATE ed_last_stage.probes SET used_at=clock_timestamp() WHERE token_hash=p_token_hash;
 INSERT INTO ed_last_stage.locations(location_id,organization_id,tenant_id,enabled)
 VALUES(p.location_id,p.organization_id,p.tenant_id,true);
 RETURN jsonb_build_object('location_id',p.location_id,'organization_id',p.organization_id,'tab_id',p.tab_id);
END $$;
CREATE FUNCTION public.edv9_last_probe_finish(p_token_hash text,p_checks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p ed_last_stage.probes%rowtype; checks jsonb; result jsonb; good boolean;
BEGIN
 SELECT * INTO p FROM ed_last_stage.probes WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR p.used_at IS NULL OR p.finished_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_probe'; END IF;
 IF jsonb_typeof(p_checks) IS DISTINCT FROM 'object' OR octet_length(p_checks::text)>4000 THEN RAISE EXCEPTION 'invalid_probe'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_checks) WHERE jsonb_typeof(value)<>'boolean') THEN RAISE EXCEPTION 'invalid_probe'; END IF;
 checks=jsonb_build_object(
  'one_event',(SELECT count(*)=1 FROM ed_last_stage.events WHERE location_id=p.location_id),
  'one_snapshot',(SELECT count(*)=1 FROM ed_last_stage.snapshots WHERE location_id=p.location_id),
  'processed',(SELECT count(*)=1 FROM ed_last_stage.events WHERE location_id=p.location_id AND state='processed' AND attempts=1),
  'full_tab_saved',EXISTS(SELECT 1 FROM ed_last_stage.snapshots WHERE location_id=p.location_id AND tab_id=p.tab_id AND raw->>'source'='EDV9_SYNTHETIC_TEST' AND is_delivery)
 );
 good=(SELECT count(*)>=6 AND bool_and(value='true'::jsonb) FROM jsonb_each(p_checks))
   AND (SELECT bool_and(value='true'::jsonb) FROM jsonb_each(checks));
 result=jsonb_build_object('passed',coalesce(good,false),'http',p_checks,'database',checks,'last_source','synthetic','sms_sent',false);
 UPDATE ed_last_stage.locations SET enabled=false WHERE location_id=p.location_id;
 UPDATE ed_last_stage.probes SET finished_at=clock_timestamp(),passed=coalesce(good,false),report=result WHERE token_hash=p_token_hash;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.edv9_last_probe_begin(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.edv9_last_probe_finish(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edv9_last_probe_begin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.edv9_last_probe_finish(text,jsonb) TO service_role;
