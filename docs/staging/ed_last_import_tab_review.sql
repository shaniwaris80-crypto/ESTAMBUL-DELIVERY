-- STAGING PROPOSAL ONLY: requires fixture verification. Never auto-deploy.
-- Derived from connected SQL definition on 2026-10-18.
-- Never infer a collection method from a previously-paid transaction.
CREATE OR REPLACE FUNCTION public.ed_last_import_tab(p_location_id text, p_tab_id text, p_tab jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 account uuid; oid uuid; existing public.ed_orders%rowtype;
 last_created timestamptz;
 delivery jsonb; customer jsonb; courier jsonb;
 pickup text; courier_id text; matched_rider uuid; courier_count integer;
 chosen_rider uuid; rider_explicit boolean:=false;
 cancelled boolean; code text; ref text; name text; addr text;
 notes text; channel text; method text; v_name text; v_notes text; v_channel text; v_method text; v_status text; v_lat double precision; v_lng double precision; total_cents numeric:=0; amount_eur numeric:=0;
 lat double precision; lng double precision; source text; status text;
 bill_method_min text; bill_method_max text;
 bill_total_confirmed boolean:=false;
 merchant_sms_default boolean:=false;
begin
 if (select auth.role())<>'service_role' then raise exception 'Unauthorized';end if;
 if p_location_id is null or p_tab_id is null or length(p_tab_id)>128 then
  raise exception 'Missing tab/location id';end if;
 if p_tab is null or jsonb_typeof(p_tab)<>'object' then
  raise exception 'Invalid tab document';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_location_id||':'||p_tab_id,0));
 select l.account_id into account
  from private.ed_last_locations l
  where l.location_id=p_location_id and l.enabled;
 if account is null then raise exception 'Location not approved for Rider sync';end if;
 if nullif(p_tab->>'locationId','') is not null
   and p_tab->>'locationId'<>p_location_id then
  raise exception 'Tab location mismatch';end if;
 pickup=lower(coalesce(p_tab->>'pickupType',''));
 delivery=p_tab->'delivery';
 if pickup not in ('owndelivery','delivery') or jsonb_typeof(delivery) is distinct from 'object' then
  return jsonb_build_object('ignored','non-delivery order');end if;

 addr=btrim(coalesce(delivery->>'address',''));
 if addr='' then raise exception 'Delivery address missing in Last tab';end if;
 customer=coalesce(p_tab->'customerInfo',p_tab->'customer','{}'::jsonb);
 v_name=left(btrim(concat_ws(' ',nullif(customer->>'name',''),nullif(customer->>'surname',''))),120);
 if v_name='' then v_name='Cliente';end if;
 code=left(coalesce(nullif(p_tab->>'code',''),p_tab_id),55);
 ref=left('LA-'||p_tab_id,80);
 v_notes=left(concat_ws(' | ',nullif(btrim(coalesce(delivery->>'details','')),''),
       nullif(btrim(coalesce(p_tab->>'customerNote','')),''),
       'Last.app #'||code),1000);

 if (delivery->>'latitude') ~ '^[-]?[0-9]+([.][0-9]+)?$' and
    (delivery->>'longitude') ~ '^[-]?[0-9]+([.][0-9]+)?$' then
  v_lat=(delivery->>'latitude')::double precision;
  v_lng=(delivery->>'longitude')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then v_lat=null;v_lng=null;end if;
 end if;

 source=lower(coalesce(p_tab->>'source',''));
 v_channel=case when source like '%uber%' then 'uber'
   when source like '%just%eat%' then 'justeat' else 'lastapp' end;
 -- Kebab Estambul merchant confirms transactional SMS authorization for
 -- GloriaFood and first-party LastPOS orders. Leave other channels off.
 merchant_sms_default=(
   v_channel='lastapp'
   and nullif(btrim(coalesce(customer->>'phoneNumber','')),'') is not null
   and (source like '%gloria%' or source like '%last%' or source like '%pos%'
        or source in ('','manual','tpv','owndelivery','restaurant'))
 );
 method=lower(coalesce(p_tab->>'preferredPaymentMethod',''));
 -- Last.app v2 puts preferredPaymentMethod inside bills, not at tab root.
 -- This is a suggested collection method, confirmed by the Rider on delivery.
 if method='' and jsonb_typeof(p_tab->'bills')='array' then
   select min(lower(b->>'preferredPaymentMethod')),
          max(lower(b->>'preferredPaymentMethod'))
     into bill_method_min,bill_method_max
   from jsonb_array_elements(p_tab->'bills') b
   where coalesce(b->>'deleted','false')<>'true'
     and lower(coalesce(b->>'preferredPaymentMethod','')) in ('cash','card','efectivo','tarjeta');
   if bill_method_min is not distinct from null
      or bill_method_min is distinct from bill_method_max then
      method='';
   else
      method=bill_method_min;
   end if;
 end if;
 v_method=case when method like '%cash%' or method like '%efectiv%' then 'efectivo'
   when method like '%card%' or method like '%tarje%' or method like '%online%' then 'tarjeta'
   else null end;
 -- The tab can be incomplete: never zero an existing known amount.
 if jsonb_typeof(p_tab->'bills')='array' then
  select count(*)>0,coalesce(sum((b->>'total')::numeric),0)
  into bill_total_confirmed,total_cents
  from jsonb_array_elements(p_tab->'bills') b
  where coalesce(b->>'deleted','false')<>'true'
    and (b->>'total')~'^[0-9]+([.][0-9]+)?
 amount_eur=greatest(0,round(total_cents/100,2));
 if (p_tab->>'creationTime') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
  begin
   last_created=(p_tab->>'creationTime')::timestamptz;
   if last_created>now()+interval '1 minute' or last_created<now()-interval '30 days' then
    last_created=now();end if;
  exception when others then last_created=now();end;
 else last_created=now();end if;
 cancelled=(nullif(p_tab->>'cancelTime','') is not null or
  p_tab->>'cancelled'='true');

 courier=delivery->'courier';
 courier_id=coalesce(nullif(courier->>'id',''),nullif(courier->>'externalId',''),
    nullif(delivery->>'courierId',''));
 if courier_id is not null then
  rider_explicit=true;
  select r.id into chosen_rider from public.ed_riders r where r.account_id=account
    and r.external_rider_id=courier_id and r.active and r.user_id is not null
  order by r.id limit 1;
 end if;
 if chosen_rider is null and nullif(courier->>'name','') is not null then
  -- Name alone is not a safe external key: use only if unambiguous and enrolled.
  rider_explicit=true;
  select count(*),min(r.id::text)::uuid into courier_count,chosen_rider
  from public.ed_riders r where r.account_id=account and r.active and r.user_id is not null
    and lower(btrim(r.display_name))=lower(btrim(courier->>'name'));
  if courier_count<>1 then chosen_rider=null;end if;
 end if;

 select lk.order_id into oid from private.ed_last_order_links lk
 where lk.location_id=p_location_id and lk.tab_id=p_tab_id;
 if oid is not null then
  select * into existing from public.ed_orders o where o.id=oid for update;
  if existing.status in ('entregado','cancelado') then
    return jsonb_build_object('order_id',oid,'status',existing.status,'final',true);end if;
  -- Never retain a stale rider when Last.app explicitly reassigns or unassigns.
 end if;
 -- No fallback dispatch: only courier assigned manually in Last.app may receive the order.
 v_status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel,created_at)
  values(account,ref,v_channel,v_name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),v_lat,v_lng,amount_eur,v_status,chosen_rider,v_notes,v_method,merchant_sms_default,
     case when merchant_sms_default then 'sms' else 'none' end,last_created)
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id,assignment_blocked)
   values(p_location_id,p_tab_id,oid,rider_explicit and chosen_rider is null);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=v_channel,customer_name=v_name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=v_lat,lng=v_lng,
   amount=case when bill_total_confirmed then amount_eur else existing.amount end,
   notes=v_notes,
   payment_method=case when existing.status in ('recogido','en_ruta') and existing.payment_method is not null then existing.payment_method else coalesce(v_method,existing.payment_method) end,
   rider_id=chosen_rider,
   status=case when cancelled then 'cancelado'
       when chosen_rider is null then 'pendiente'
       when existing.rider_id is distinct from chosen_rider then 'asignado'
       else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now(),
   assignment_blocked=(rider_explicit and chosen_rider is null)
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',v_status,
   'rider_assigned',chosen_rider is not null,'waiting_for_last_assignment',chosen_rider is null);
end $function$
;
 end if;
 -- Optional explicit tab total; only accept an actual numeric Last response.
 if not bill_total_confirmed and (p_tab->>'total')~'^[0-9]+([.][0-9]+)?
 amount_eur=greatest(0,round(total_cents/100,2));
 if (p_tab->>'creationTime') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
  begin
   last_created=(p_tab->>'creationTime')::timestamptz;
   if last_created>now()+interval '1 minute' or last_created<now()-interval '30 days' then
    last_created=now();end if;
  exception when others then last_created=now();end;
 else last_created=now();end if;
 cancelled=(nullif(p_tab->>'cancelTime','') is not null or
  p_tab->>'cancelled'='true');

 courier=delivery->'courier';
 courier_id=coalesce(nullif(courier->>'id',''),nullif(courier->>'externalId',''),
    nullif(delivery->>'courierId',''));
 if courier_id is not null then
  rider_explicit=true;
  select r.id into chosen_rider from public.ed_riders r where r.account_id=account
    and r.external_rider_id=courier_id and r.active and r.user_id is not null
  order by r.id limit 1;
 end if;
 if chosen_rider is null and nullif(courier->>'name','') is not null then
  -- Name alone is not a safe external key: use only if unambiguous and enrolled.
  rider_explicit=true;
  select count(*),min(r.id::text)::uuid into courier_count,chosen_rider
  from public.ed_riders r where r.account_id=account and r.active and r.user_id is not null
    and lower(btrim(r.display_name))=lower(btrim(courier->>'name'));
  if courier_count<>1 then chosen_rider=null;end if;
 end if;

 select lk.order_id into oid from private.ed_last_order_links lk
 where lk.location_id=p_location_id and lk.tab_id=p_tab_id;
 if oid is not null then
  select * into existing from public.ed_orders o where o.id=oid for update;
  if existing.status in ('entregado','cancelado') then
    return jsonb_build_object('order_id',oid,'status',existing.status,'final',true);end if;
  -- Never retain a stale rider when Last.app explicitly reassigns or unassigns.
 end if;
 -- No fallback dispatch: only courier assigned manually in Last.app may receive the order.
 v_status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel,created_at)
  values(account,ref,v_channel,v_name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),v_lat,v_lng,amount_eur,v_status,chosen_rider,v_notes,v_method,merchant_sms_default,
     case when merchant_sms_default then 'sms' else 'none' end,last_created)
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id,assignment_blocked)
   values(p_location_id,p_tab_id,oid,rider_explicit and chosen_rider is null);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=v_channel,customer_name=v_name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=v_lat,lng=v_lng,amount=amount_eur,notes=v_notes,
   payment_method=case when existing.status in ('recogido','en_ruta') and existing.payment_method is not null then existing.payment_method else coalesce(v_method,existing.payment_method) end,
   rider_id=chosen_rider,
   status=case when cancelled then 'cancelado'
       when chosen_rider is null then 'pendiente'
       when existing.rider_id is distinct from chosen_rider then 'asignado'
       else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now(),
   assignment_blocked=(rider_explicit and chosen_rider is null)
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',v_status,
   'rider_assigned',chosen_rider is not null,'waiting_for_last_assignment',chosen_rider is null);
end $function$
 then
  total_cents=(p_tab->>'total')::numeric;
  bill_total_confirmed=true;
 end if;
 if total_cents>100000000 then raise exception 'Last total exceeds safe range';end if;
 amount_eur=greatest(0,round(total_cents/100,2));
 if (p_tab->>'creationTime') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
  begin
   last_created=(p_tab->>'creationTime')::timestamptz;
   if last_created>now()+interval '1 minute' or last_created<now()-interval '30 days' then
    last_created=now();end if;
  exception when others then last_created=now();end;
 else last_created=now();end if;
 cancelled=(nullif(p_tab->>'cancelTime','') is not null or
  p_tab->>'cancelled'='true');

 courier=delivery->'courier';
 courier_id=coalesce(nullif(courier->>'id',''),nullif(courier->>'externalId',''),
    nullif(delivery->>'courierId',''));
 if courier_id is not null then
  rider_explicit=true;
  select r.id into chosen_rider from public.ed_riders r where r.account_id=account
    and r.external_rider_id=courier_id and r.active and r.user_id is not null
  order by r.id limit 1;
 end if;
 if chosen_rider is null and nullif(courier->>'name','') is not null then
  -- Name alone is not a safe external key: use only if unambiguous and enrolled.
  rider_explicit=true;
  select count(*),min(r.id::text)::uuid into courier_count,chosen_rider
  from public.ed_riders r where r.account_id=account and r.active and r.user_id is not null
    and lower(btrim(r.display_name))=lower(btrim(courier->>'name'));
  if courier_count<>1 then chosen_rider=null;end if;
 end if;

 select lk.order_id into oid from private.ed_last_order_links lk
 where lk.location_id=p_location_id and lk.tab_id=p_tab_id;
 if oid is not null then
  select * into existing from public.ed_orders o where o.id=oid for update;
  if existing.status in ('entregado','cancelado') then
    return jsonb_build_object('order_id',oid,'status',existing.status,'final',true);end if;
  -- Never retain a stale rider when Last.app explicitly reassigns or unassigns.
 end if;
 -- No fallback dispatch: only courier assigned manually in Last.app may receive the order.
 v_status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel,created_at)
  values(account,ref,v_channel,v_name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),v_lat,v_lng,amount_eur,v_status,chosen_rider,v_notes,v_method,merchant_sms_default,
     case when merchant_sms_default then 'sms' else 'none' end,last_created)
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id,assignment_blocked)
   values(p_location_id,p_tab_id,oid,rider_explicit and chosen_rider is null);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=v_channel,customer_name=v_name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=v_lat,lng=v_lng,amount=amount_eur,notes=v_notes,
   payment_method=case when existing.status in ('recogido','en_ruta') and existing.payment_method is not null then existing.payment_method else coalesce(v_method,existing.payment_method) end,
   rider_id=chosen_rider,
   status=case when cancelled then 'cancelado'
       when chosen_rider is null then 'pendiente'
       when existing.rider_id is distinct from chosen_rider then 'asignado'
       else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now(),
   assignment_blocked=(rider_explicit and chosen_rider is null)
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',v_status,
   'rider_assigned',chosen_rider is not null,'waiting_for_last_assignment',chosen_rider is null);
end $function$

