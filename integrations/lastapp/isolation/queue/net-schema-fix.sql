-- Correct ONLY the newly installed staging network extension; no operational data deletion.
-- Existing pg_net is non-relocatable. Stop this scheduler and ensure no HTTP work is in flight.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE ns text; active boolean; next_id bigint;
BEGIN
 SELECT enabled INTO active FROM ed_last_stage.queue_control WHERE singleton FOR UPDATE;
 IF active THEN RAISE EXCEPTION 'Pause EDV9 queue before network extension maintenance'; END IF;
 IF EXISTS(SELECT 1 FROM ed_last_stage.queue_runs WHERE state IN ('sent','running') AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Queue has in-flight work';
 END IF;
 IF EXISTS(SELECT 1 FROM net.http_request_queue) THEN RAISE EXCEPTION 'HTTP queue must be empty'; END IF;
 SELECT n.nspname INTO ns FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_net';
 IF ns='public' THEN
  -- No CASCADE: any unexpected dependency stops the transaction instead of being deleted.
  DROP EXTENSION pg_net;
  CREATE EXTENSION pg_net WITH SCHEMA extensions;
 ELSIF ns IS DISTINCT FROM 'extensions' THEN
  RAISE EXCEPTION 'Unreviewed network extension state';
 END IF;
 -- Preserve monotonic HTTP request references after recreating the new extension.
 SELECT coalesce(max(request_id),0)+1 INTO next_id FROM ed_last_stage.queue_runs;
 PERFORM setval('net.http_request_queue_id_seq',next_id,false);
END $$;
COMMIT;
