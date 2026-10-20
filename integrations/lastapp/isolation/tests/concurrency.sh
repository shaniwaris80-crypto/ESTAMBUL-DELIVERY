#!/usr/bin/env bash
set -euo pipefail
# Uses PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD for a disposable CI database only.
# Ten independent PostgreSQL sessions compete for one persisted location lease.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SET ROLE service_role;
INSERT INTO ed_last_stage.locations(location_id,organization_id,tenant_id,enabled)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
SELECT public.edv9_last_receive('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,
'{"id":"concurrent-1","type":"tab:created","data":{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}}'::jsonb);
SQL
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pids=()
for n in $(seq 1 10); do
  psql -X -v ON_ERROR_STOP=1 -At -c "SET ROLE service_role; SELECT public.edv9_last_claim('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');" >"$work/$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
count=$(grep -h '"lease_token"' "$work/"* | wc -l)
test "$count" -eq 1 || { echo "FAIL: expected one claim, got $count"; exit 1; }
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT attempts FROM ed_last_stage.events WHERE event_id='concurrent-1')<>1 THEN
  RAISE EXCEPTION 'Concurrent claim incremented attempts more than once';
 END IF;
END $$;
SQL
echo 'PASS: ten concurrent sessions produced exactly one lease and one attempt.'
