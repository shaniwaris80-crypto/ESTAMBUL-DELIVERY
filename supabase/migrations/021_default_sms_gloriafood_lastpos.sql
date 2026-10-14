-- Default transactional SMS notices for new GloriaFood / first-party LastPOS
-- orders with customer phone. Merchant attests consent, and admins may opt
-- out per order. Uber Eats and Just Eat are not included.
-- Do not backfill existing orders or send historic messages.
BEGIN;
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.ed_last_import_tab(text,text,jsonb)'::regprocedure);
  IF strpos(src, ' lat double precision; lng double precision; source text; status text;')=0 OR
     strpos(src, ' v_channel=case when source like ''%uber%'' then ''uber''
   when source like ''%just%eat%'' then ''justeat'' else ''lastapp'' end;')=0 OR
     strpos(src, 'v_notes,v_method,false,''none'',last_created)')=0 THEN
     RAISE EXCEPTION 'Last order importer does not match expected base version';
  END IF;
  IF strpos(src,'merchant_sms_default boolean')<>0 THEN
     RAISE EXCEPTION 'SMS default already implemented; refusing duplicate patch';
  END IF;
  src := replace(src,' lat double precision; lng double precision; source text; status text;',' lat double precision; lng double precision; source text; status text;
 merchant_sms_default boolean:=false;');
  src := replace(src,' v_channel=case when source like ''%uber%'' then ''uber''
   when source like ''%just%eat%'' then ''justeat'' else ''lastapp'' end;',' v_channel=case when source like ''%uber%'' then ''uber''
   when source like ''%just%eat%'' then ''justeat'' else ''lastapp'' end;
 -- Kebab Estambul merchant confirms transactional SMS authorization for
 -- GloriaFood and first-party LastPOS orders. Leave other channels off.
 merchant_sms_default=(
   v_channel=''lastapp''
   and nullif(btrim(coalesce(customer->>''phoneNumber'','''')),'''') is not null
   and (source like ''%gloria%'' or source like ''%last%'' or source like ''%pos%''
        or source in ('''',''manual'',''tpv''))
 );');
  src := replace(src,'v_notes,v_method,false,''none'',last_created)','v_notes,v_method,merchant_sms_default,
     case when merchant_sms_default then ''sms'' else ''none'' end,last_created)');
  EXECUTE src;
END
$patch$;
COMMIT;
