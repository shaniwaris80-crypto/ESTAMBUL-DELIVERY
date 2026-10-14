-- Protect Last courier explicitly assigned but not yet mapped to an enrolled Rider.
-- Rider auto-claim only processes unassigned orders with no explicit courier dependency.
begin;
alter table private.ed_last_order_links add column if not exists assignment_blocked boolean not null default false;
CREATE OR REPLACE FUNCTION public.ed_last_import_tab(p_location_id text, p_tab_id text, p_tab jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 account uuid; oid uuid; existing public.ed_orders%rowtype;
 delivery jsonb; customer jsonb; courier jsonb;
 pickup text; courier_id text; matched_rider uuid; courier_count integer;
 chosen_rider uuid; rider_explicit boolean:=false;
 cancelled boolean; code text; ref text; name text; addr text;
 notes text; channel text; method text; v_name text; v_notes text; v_channel text; v_method text; v_status text; v_lat double precision; v_lng double precision; total_cents numeric:=0; amount_eur numeric:=0;
 lat double precision; lng double precision; source text; status text;
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
 method=lower(coalesce(p_tab->>'preferredPaymentMethod',''));
 v_method=case when method like '%cash%' or method like '%efectiv%' then 'efectivo'
   when method like '%card%' or method like '%tarje%' or method like '%online%' then 'tarjeta'
   else null end;
 if jsonb_typeof(p_tab->'bills')='array' then
  select coalesce(sum(case when (b->>'total')~'^[-]?[0-9]+([.][0-9]+)?$'
      then (b->>'total')::numeric else 0 end),0)
  into total_cents from jsonb_array_elements(p_tab->'bills') b;
 end if;
 amount_eur=greatest(0,round(total_cents/100,2));
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
 elsif nullif(courier->>'name','') is not null then
  -- Name alone is not a safe external key: use only if unambiguous and enrolled.
  rider_explicit=true;
  select count(*),min(r.id) into courier_count,chosen_rider
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
  if chosen_rider is null and existing.rider_id is not null then chosen_rider=existing.rider_id;end if;
 end if;
 if chosen_rider is null and not rider_explicit then
  -- Online and enrolled only. Least open orders; deterministic tie-break.
  select r.id into chosen_rider from public.ed_riders r
   where r.account_id=account and r.active and r.online and r.user_id is not null
   order by (select count(*) from public.ed_orders o
       where o.rider_id=r.id and o.status in ('asignado','recogido','en_ruta')),
      r.created_at,r.id limit 1 for update of r skip locked;
 end if;
 v_status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel)
  values(account,ref,v_channel,v_name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),v_lat,v_lng,amount_eur,v_status,chosen_rider,v_notes,v_method,false,'none')
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id,assignment_blocked)
   values(p_location_id,p_tab_id,oid,rider_explicit and chosen_rider is null);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=v_channel,customer_name=v_name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=v_lat,lng=v_lng,amount=amount_eur,notes=v_notes,
   payment_method=v_method,
   rider_id=case when existing.status in ('pendiente','asignado') then chosen_rider else existing.rider_id end,
   status=case when cancelled then 'cancelado'
       when existing.status in ('pendiente','asignado') then v_status else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now(),
   assignment_blocked=(rider_explicit and chosen_rider is null)
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',v_status,
   'rider_assigned',chosen_rider is not null,'waiting_for_online_rider',chosen_rider is null);
end $function$
;
CREATE OR REPLACE FUNCTION private.ed_last_claim_waiting_on_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.online and new.active and new.user_id is not null
   and old.online is distinct from new.online then
  perform set_config('ed.last_auto_online','allowed',true);
  with to_assign as (
   select o.id from public.ed_orders o
   join private.ed_last_order_links lk on lk.order_id=o.id
   join private.ed_last_locations loc on loc.location_id=lk.location_id
    and loc.enabled and loc.account_id=new.account_id
   where o.account_id=new.account_id and o.status='pendiente' and o.rider_id is null
   and not lk.assignment_blocked
   order by o.created_at limit 25
   for update of o skip locked
  )
  update public.ed_orders o set rider_id=new.id,status='asignado'
  from to_assign t where t.id=o.id;
  perform set_config('ed.last_auto_online','',true);
 end if;
 return new;
end $function$
;
commit;