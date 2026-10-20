\set ON_ERROR_STOP on
-- All data is synthetic and rolled back. No auth.users or legacy tables exist.
BEGIN;
CREATE FUNCTION pg_temp.ok(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.ok(to_regclass('public.ed_orders') IS NULL,'no old order table');
SELECT pg_temp.ok(to_regclass('public.ed_riders') IS NULL,'no old rider table');
SELECT pg_temp.ok(to_regclass('auth.users') IS NULL,'no Auth dependency');
SELECT pg_temp.ok((SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='ed_last_stage'::regnamespace AND relkind='r'),'RLS enabled on all three tables');
SELECT pg_temp.ok((SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname LIKE 'edv9_last_%'),'all RPCs use SECURITY INVOKER');
SELECT pg_temp.ok((SELECT bool_and(NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE proname LIKE 'edv9_last_%'),'no public RPC execute');
SELECT pg_temp.ok(NOT has_schema_privilege('anon','ed_last_stage','USAGE') AND NOT has_schema_privilege('authenticated','ed_last_stage','USAGE'),'private schema denied to app users');
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.edv9_last_claim('11111111-1111-4111-8111-111111111111');
  RAISE EXCEPTION 'anon unexpectedly called worker';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: real anonymous RPC call blocked'; END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.edv9_last_claim('11111111-1111-4111-8111-111111111111');
  RAISE EXCEPTION 'authenticated unexpectedly called worker';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: real authenticated RPC call blocked'; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO ed_last_stage.locations(location_id,organization_id,tenant_id)
 VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
DO $$
DECLARE
 loc uuid:='11111111-1111-4111-8111-111111111111'; org uuid:='33333333-3333-4333-8333-333333333333';
 tid uuid:='22222222-2222-4222-8222-222222222222';
 payload jsonb; tab jsonb; first_claim jsonb; second_claim jsonb; result text;
BEGIN
 payload=jsonb_build_object('id','test-event-1','type','tab:created','created','2026-10-20T12:00:00Z','data',jsonb_build_object('id',tid,'locationId',loc));
 BEGIN
  PERFORM public.edv9_last_receive(loc,org,payload); RAISE EXCEPTION 'unexpected_approval';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'location_not_approved' THEN RAISE; END IF; END;
 PERFORM pg_temp.ok(public.edv9_last_claim(loc) IS NULL,'disabled location cannot fetch');
 UPDATE ed_last_stage.locations SET enabled=true WHERE location_id=loc;
 BEGIN
  PERFORM public.edv9_last_receive(loc,'55555555-5555-4555-8555-555555555555',payload); RAISE EXCEPTION 'unexpected_org';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'organization_mismatch' THEN RAISE; END IF; END;
 PERFORM pg_temp.ok(public.edv9_last_receive(loc,org,payload)='received','first event is stored');
 PERFORM pg_temp.ok(public.edv9_last_receive(loc,org,payload)='duplicate','duplicate webhook is idempotent');
 BEGIN
  PERFORM public.edv9_last_receive(loc,org,payload||'{"created":"2026-10-20T13:00:00Z"}'::jsonb); RAISE EXCEPTION 'unexpected_collision';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'event_id_conflict' THEN RAISE; END IF; END;
 first_claim=public.edv9_last_claim(loc);
 PERFORM pg_temp.ok(first_claim->>'event_id'='test-event-1','approved worker claims event');
 PERFORM pg_temp.ok(public.edv9_last_claim(loc) IS NULL,'second worker cannot share location lease');
 tab=jsonb_build_object('id',tid,'locationId',loc,'pickupType','ownDelivery','delivery',jsonb_build_object('address','Synthetic test only','courier',jsonb_build_object('id','rider-test','name','rider1')),'bills','[]'::jsonb);
 BEGIN
  PERFORM public.edv9_last_complete('test-event-1',(first_claim->>'lease_token')::uuid,tab||jsonb_build_object('locationId',org)); RAISE EXCEPTION 'unexpected_foreign_tab';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_tab' THEN RAISE; END IF; END;
 PERFORM pg_temp.ok(public.edv9_last_complete('test-event-1',(first_claim->>'lease_token')::uuid,tab)='processed','complete stores full tab');
 PERFORM pg_temp.ok((SELECT count(*)=1 FROM ed_last_stage.snapshots),'one snapshot per tab');
 PERFORM pg_temp.ok(public.edv9_last_complete('test-event-1',(first_claim->>'lease_token')::uuid,tab)='lost_lease','duplicate completion rejected');
 -- Older webhook: worker obtains the CURRENT full tab, so event.created is not a tab version.
 payload=payload||'{"id":"test-event-2","type":"tab:updated","created":"2026-10-19T12:00:00Z"}'::jsonb;
 PERFORM public.edv9_last_receive(loc,org,payload);
 UPDATE ed_last_stage.locations SET next_request_at='-infinity' WHERE location_id=loc;
 second_claim=public.edv9_last_claim(loc);
 PERFORM public.edv9_last_complete('test-event-2',(second_claim->>'lease_token')::uuid,tab);
 PERFORM pg_temp.ok((SELECT revision=1 FROM ed_last_stage.snapshots WHERE location_id=loc AND tab_id=tid),'same current snapshot from old event does not create new revision');
 payload=payload||'{"id":"test-event-3"}'::jsonb;
 PERFORM public.edv9_last_receive(loc,org,payload);
 UPDATE ed_last_stage.locations SET next_request_at='-infinity' WHERE location_id=loc;
 first_claim=public.edv9_last_claim(loc);
 -- Simulate an expired worker, then recover with a new fencing token.
 UPDATE ed_last_stage.events SET lease_until=clock_timestamp()-interval '1 second' WHERE event_id='test-event-3';
 UPDATE ed_last_stage.locations SET lease_until=clock_timestamp()-interval '1 second',next_request_at='-infinity' WHERE location_id=loc;
 second_claim=public.edv9_last_claim(loc);
 PERFORM pg_temp.ok(first_claim->>'lease_token'<>second_claim->>'lease_token','retry gets new fencing token');
 PERFORM pg_temp.ok(public.edv9_last_complete('test-event-3',(first_claim->>'lease_token')::uuid,tab)='lost_lease','old worker cannot overwrite recovered work');
 result=public.edv9_last_fail('test-event-3',(second_claim->>'lease_token')::uuid,'last_rate_limited',120);
 PERFORM pg_temp.ok(result='retry','transient provider failure is retryable');
 PERFORM pg_temp.ok((SELECT not_before>clock_timestamp()+interval '115 seconds' FROM ed_last_stage.events WHERE event_id='test-event-3'),'Retry-After is respected');
 PERFORM pg_temp.ok(public.edv9_last_claim(loc) IS NULL,'location-wide rate-limit cooldown blocks other fetches');
 UPDATE ed_last_stage.events SET not_before='-infinity' WHERE event_id='test-event-3';
 UPDATE ed_last_stage.locations SET next_request_at='-infinity' WHERE location_id=loc;
 second_claim=public.edv9_last_claim(loc);
 result=public.edv9_last_fail('test-event-3',(second_claim->>'lease_token')::uuid,'last_unauthorized');
 PERFORM pg_temp.ok(result='dead','bad credentials require intervention, not infinite retry');
 -- Next authoritative read says the delivery is cancelled; no courier reassignment occurs.
 payload=payload||'{"id":"test-event-4","type":"tab:cancelled"}'::jsonb;
 PERFORM public.edv9_last_receive(loc,org,payload);
 UPDATE ed_last_stage.locations SET next_request_at='-infinity' WHERE location_id=loc;
 second_claim=public.edv9_last_claim(loc);
 tab=tab||'{"cancelTime":"2026-10-20T14:00:00Z"}'::jsonb;
 PERFORM public.edv9_last_complete('test-event-4',(second_claim->>'lease_token')::uuid,tab);
 PERFORM pg_temp.ok((SELECT raw->>'cancelTime' IS NOT NULL AND raw#>>'{delivery,courier,id}'='rider-test' FROM ed_last_stage.snapshots),'cancellation preserved without guessed assignment');
 -- A former delivery becomes takeaway: remove active customer data from its snapshot.
 payload=payload||'{"id":"test-event-5","type":"tab:updated"}'::jsonb;
 PERFORM public.edv9_last_receive(loc,org,payload);
 UPDATE ed_last_stage.locations SET next_request_at='-infinity' WHERE location_id=loc;
 second_claim=public.edv9_last_claim(loc);
 PERFORM pg_temp.ok(public.edv9_last_complete('test-event-5',(second_claim->>'lease_token')::uuid,tab||'{"pickupType":"takeAway"}'::jsonb)='ignored','non-delivery update is not dispatchable');
 PERFORM pg_temp.ok((SELECT NOT is_delivery AND NOT(raw ? 'delivery') FROM ed_last_stage.snapshots),'takeaway tombstone prevents stale dispatch');
 -- Exhausted crashed worker becomes dead, without an unbounded sixth attempt.
 payload=payload||'{"id":"test-event-6"}'::jsonb;
 PERFORM public.edv9_last_receive(loc,org,payload);
 UPDATE ed_last_stage.events SET state='processing',attempts=5,lease_until=clock_timestamp()-interval '1 second' WHERE event_id='test-event-6';
 UPDATE ed_last_stage.locations SET lease_until=NULL,next_request_at='-infinity' WHERE location_id=loc;
 PERFORM public.edv9_last_claim(loc);
 PERFORM pg_temp.ok((SELECT state='dead' FROM ed_last_stage.events WHERE event_id='test-event-6'),'crashed worker attempts are bounded');
END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*)=0 FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='ed_last_stage'::regnamespace) AND NOT tgisinternal),'no application or notification triggers');
ROLLBACK;
