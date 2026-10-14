-- LastPOS may supply courier.id and courier.name even when the courier UUID
-- was never enrolled as external_rider_id in ESTAMBUL DELIVERY.
-- Preserve source-of-truth manual assignment: prefer explicit external ID;
-- if unresolved, fall back ONLY to a unique active enrolled rider name.
BEGIN;
DO $fix$
DECLARE src text;
DECLARE oldfrag text := ' elsif nullif(courier->>''name'','''') is not null then';
DECLARE newfrag text := ' end if;' || chr(10) || ' if chosen_rider is null and nullif(courier->>''name'','''') is not null then';
BEGIN
  src := pg_get_functiondef('public.ed_last_import_tab(text,text,jsonb)'::regprocedure);
  IF position(oldfrag in src)=0 THEN
    RAISE EXCEPTION 'Unrecognized Last import function; no change applied';
  END IF;
  src := replace(src,oldfrag,newfrag);
  EXECUTE src;
END
$fix$;
COMMIT;
