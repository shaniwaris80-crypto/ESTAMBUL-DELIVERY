-- Final review: deny null lease tokens and reset the redaction marker on a new full snapshot.
DO $patch$
DECLARE src text; signature text; needle text='IF l.location_id IS NULL OR s.location_id IS NULL OR';
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.edv9_last_reconcile_page(uuid,uuid,uuid[],integer)','public.edv9_last_reconcile_fail(uuid,uuid,text,integer)'] LOOP
  src=pg_get_functiondef(signature::regprocedure);
  IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Lease guard changed: %',signature; END IF;
  src=replace(src,needle,'IF p_lease_token IS NULL OR l.lease_until IS NULL OR s.sweep_id IS NULL OR l.location_id IS NULL OR s.location_id IS NULL OR');EXECUTE src;
 END LOOP;
 src=pg_get_functiondef('public.edv9_last_complete(text,uuid,jsonb)'::regprocedure);
 needle='raw=excluded.raw,is_delivery=excluded.is_delivery';
 IF strpos(src,needle)=0 THEN RAISE EXCEPTION 'Snapshot update changed'; END IF;
 src=replace(src,needle,'raw=excluded.raw,raw_redacted_at=NULL,is_delivery=excluded.is_delivery');EXECUTE src;
END $patch$;
