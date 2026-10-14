-- Patch UUID aggregate on the Last manual courier name branch.
-- PostgreSQL does not provide min(uuid); cast to text before aggregation.
BEGIN;
DO $patch$
DECLARE body_sql text;
BEGIN
  body_sql := pg_get_functiondef('public.ed_last_import_tab(text,text,jsonb)'::regprocedure);
  IF strpos(body_sql, 'min(r.id)') = 0 THEN
    RAISE EXCEPTION 'Expected Last rider lookup was not found';
  END IF;
  body_sql := replace(body_sql,'min(r.id)','min(r.id::text)::uuid');
  EXECUTE body_sql;
END
$patch$;
COMMIT;
