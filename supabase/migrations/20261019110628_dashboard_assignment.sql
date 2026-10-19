-- Manual assignment in Dashboard or LastPOS. No automatic dispatch; no orders deleted.
begin;
alter table public.ed_orders add column if not exists customer_phone text;
alter table public.ed_orders add column if not exists accepted_at timestamptz;
alter table private.ed_last_order_links add column if not exists dashboard_assignment_override boolean not null default false;
alter table private.ed_last_order_links add column if not exists last_courier_key text;
drop trigger if exists ed_last_autoclaim_on_rider_online on public.ed_riders;
drop function if exists private.ed_last_claim_waiting_on_online();
CREATE OR REPLACE FUNCTION private.ed_guard_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.account_id is distinct from old.account_id or new.id is distinct from old.id
  or new.created_at is distinct from old.created_at then
  raise exception 'Identity fields cannot be changed';
 end if;
 if not private.ed_is_staff(old.account_id) then
  if not private.ed_is_rider(old.account_id,old.rider_id) then
    raise exception 'Not the assigned rider';
  end if;
  if new.reference is distinct from old.reference
   or new.channel is distinct from old.channel
   or new.customer_name is distinct from old.customer_name
   or new.customer_phone is distinct from old.customer_phone
   or new.destination is distinct from old.destination
   or new.lat is distinct from old.lat or new.lng is distinct from old.lng
   or new.amount is distinct from old.amount
   or new.payment_method is distinct from old.payment_method
   or new.notifications_consent is distinct from old.notifications_consent
   or new.notification_channel is distinct from old.notification_channel
   or new.rider_id is distinct from old.rider_id
   or new.notes is distinct from old.notes then
    raise exception 'Rider may not modify customer or assignment information';
  end if;
  if new.accepted_at is distinct from old.accepted_at then
    if old.accepted_at is not null or new.accepted_at is null
      or old.status<>'asignado' or new.status is distinct from old.status
      or new.accepted_at>clock_timestamp()+interval '5 seconds'
      or new.accepted_at<clock_timestamp()-interval '5 seconds' then
       raise exception 'Rider may only accept an assigned order once';
    end if;
  elsif not (
   (old.status='asignado' and new.status='recogido') or
   (old.status='recogido' and new.status='en_ruta') or
   (old.status='en_ruta' and new.status='entregado')
  ) then
    raise exception 'Invalid rider status transition';
  end if;
 else
  -- Assignment authority for imported Last orders stays in Last.app.
  if coalesce(current_setting('ed.dashboard_assignment',true),'')<>'on' and
    (select auth.role())<>'service_role' and
    exists(select 1 from private.ed_last_order_links lk where lk.order_id=old.id)
    and (new.rider_id is distinct from old.rider_id or new.status is distinct from old.status)
  then raise exception 'Asigna o reasigna este pedido únicamente desde Last.app';end if;
  if new.rider_id is not null and
   not exists(select 1 from public.ed_riders r
    where r.id=new.rider_id and r.account_id=new.account_id and r.active) then
    raise exception 'Rider is not active';
  end if;
  if old.status in ('entregado','cancelado') and
   (new.rider_id is distinct from old.rider_id or new.status is distinct from old.status)
   then raise exception 'Finalized orders cannot be reassigned';
  end if;
  if new.rider_id is distinct from old.rider_id then new.accepted_at=null;end if;
 end if;
 if new.status='entregado' and old.status is distinct from new.status then
  new.delivered_at=now();
 else
  new.delivered_at=old.delivered_at;
 end if;
 new.updated_at=now();
 return new;
end $function$
;
create or replace function public.ed_dashboard_assign_order(p_order_id uuid,p_rider_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare o public.ed_orders%rowtype;
begin
 select * into o from public.ed_orders where id=p_order_id for update;
 if not found or not private.ed_is_staff(o.account_id) then raise exception 'Pedido no disponible para este usuario';end if;
 if o.status not in ('pendiente','asignado') then raise exception 'Solo se pueden asignar pedidos pendientes o asignados';end if;
 if p_rider_id is not null and not exists(
  select 1 from public.ed_riders r where r.id=p_rider_id and r.account_id=o.account_id and r.active and r.user_id is not null
 ) then raise exception 'El repartidor debe estar activo y tener acceso';end if;
 perform set_config('ed.dashboard_assignment','on',true);
 update public.ed_orders set rider_id=p_rider_id,status=case when p_rider_id is null then 'pendiente' else 'asignado' end
 where id=p_order_id;
 update private.ed_last_order_links lk set dashboard_assignment_override=true,updated_at=now(),
  last_courier_key=(select case when r.external_rider_id is not null then 'id:'||r.external_rider_id
    when r.display_name is not null then 'name:'||lower(btrim(r.display_name)) else null end
   from public.ed_riders r where r.id=o.rider_id)
 where lk.order_id=p_order_id;
 return jsonb_build_object('order_id',p_order_id,'rider_id',p_rider_id,'status',case when p_rider_id is null then 'pendiente' else 'asignado' end);
end $function$;
revoke all on function public.ed_dashboard_assign_order(uuid,uuid) from public,anon;
grant execute on function public.ed_dashboard_assign_order(uuid,uuid) to authenticated,service_role;
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
 v_last_courier_key text; prior_courier_key text; dashboard_override boolean:=false; preserve_dashboard boolean:=false;
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
 elsif nullif(courier->>'name','') is not null then
  -- Name alone is not a safe external key: use only if unambiguous and enrolled.
  rider_explicit=true;
  select count(*),min(r.id) into courier_count,chosen_rider
  from public.ed_riders r where r.account_id=account and r.active and r.user_id is not null
    and lower(btrim(r.display_name))=lower(btrim(courier->>'name'));
  if courier_count<>1 then chosen_rider=null;end if;
 end if;
 v_last_courier_key=case when courier_id is not null then 'id:'||courier_id
   when nullif(courier->>'name','') is not null then 'name:'||lower(btrim(courier->>'name')) else null end;

 select lk.order_id,lk.dashboard_assignment_override,lk.last_courier_key into oid,dashboard_override,prior_courier_key from private.ed_last_order_links lk
 where lk.location_id=p_location_id and lk.tab_id=p_tab_id;
 if oid is not null then
  select * into existing from public.ed_orders o where o.id=oid for update;
  if existing.status in ('entregado','cancelado') then
    return jsonb_build_object('order_id',oid,'status',existing.status,'final',true);end if;
  preserve_dashboard=dashboard_override and v_last_courier_key is not distinct from prior_courier_key;
  if dashboard_override and not preserve_dashboard then
   update private.ed_last_order_links set dashboard_assignment_override=false where order_id=oid;
  end if;
 end if;
 -- No fallback dispatch: only courier assigned manually in Last.app may receive the order.
 if preserve_dashboard then chosen_rider=existing.rider_id;end if;
 v_status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel,created_at)
  values(account,ref,v_channel,v_name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),v_lat,v_lng,amount_eur,v_status,chosen_rider,v_notes,v_method,false,'none',last_created)
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id,assignment_blocked,last_courier_key)
   values(p_location_id,p_tab_id,oid,rider_explicit and chosen_rider is null,v_last_courier_key);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=v_channel,customer_name=v_name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=v_lat,lng=v_lng,amount=amount_eur,notes=v_notes,
   payment_method=v_method,
   rider_id=chosen_rider,
   status=case when cancelled then 'cancelado'
       when preserve_dashboard then existing.status
       when chosen_rider is null then 'pendiente'
       when existing.rider_id is distinct from chosen_rider then 'asignado'
       else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now(),last_courier_key=v_last_courier_key,
   assignment_blocked=(rider_explicit and chosen_rider is null)
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',v_status,
   'rider_assigned',chosen_rider is not null,'waiting_for_last_assignment',chosen_rider is null);
end $function$
;
commit;
