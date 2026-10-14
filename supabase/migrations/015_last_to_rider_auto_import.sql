-- Last.app -> Rider: secure location mapping, idempotent import and automatic rider allocation.
-- Dormant until a verified Last.app location is explicitly bound to the ED account.
begin;
create table if not exists private.ed_last_locations (
 location_id text primary key check(length(location_id) between 1 and 128),
 organization_id text,
 location_name text,
 account_id uuid references public.ed_accounts(id),
 enabled boolean not null default false,
 received_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not enabled or account_id is not null)
);
create unique index if not exists ed_last_one_location_per_account
 on private.ed_last_locations(account_id) where enabled;
create table if not exists private.ed_last_order_links (
 location_id text not null references private.ed_last_locations(location_id),
 tab_id text not null,
 order_id uuid not null unique references public.ed_orders(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(location_id,tab_id)
);
revoke all on private.ed_last_locations,private.ed_last_order_links from public,anon,authenticated;

-- Service role is the only backend trusted for Last.app synchronization.
-- This also lets the existing order mutation guard apply its normal staff-side restrictions.
create or replace function private.ed_is_staff(p_account uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
 select (select auth.role())='service_role' or exists(
  select 1 from public.ed_members m
   where m.account_id=p_account and m.user_id=(select auth.uid())
    and m.active and m.role in ('admin','dispatcher')
 )
$function$;

create or replace function public.ed_last_record_location(
 p_location_id text,p_organization_id text,p_location_name text
) returns boolean language plpgsql security definer set search_path to ''
as $function$
begin
 if (select auth.role())<>'service_role' then raise exception 'Unauthorized';end if;
 if p_location_id is null or length(p_location_id) not between 1 and 128 then
  raise exception 'Missing Last location';end if;
 insert into private.ed_last_locations(location_id,organization_id,location_name)
 values(p_location_id,left(p_organization_id,128),left(p_location_name,160))
 on conflict(location_id) do update set
 organization_id=coalesce(excluded.organization_id,private.ed_last_locations.organization_id),
 location_name=coalesce(excluded.location_name,private.ed_last_locations.location_name),
 updated_at=now();
 return true;
end $function$;

-- One-time association only after checking real Last.app locationId in the admin.
create or replace function public.ed_last_bind_location(
 p_location_id text,p_account_id uuid
) returns boolean language plpgsql security definer set search_path to ''
as $function$
begin
 if (select auth.role())<>'service_role' then raise exception 'Unauthorized';end if;
 if not exists(select 1 from public.ed_accounts a where a.id=p_account_id) then
  raise exception 'Account not found';end if;
 update private.ed_last_locations set account_id=p_account_id,enabled=true,updated_at=now()
 where location_id=p_location_id;
 if not found then raise exception 'Location must first be received from Last webhook';end if;
 return true;
end $function$;

create or replace function public.ed_last_get_event(p_event_id text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
 select case when (select auth.role())='service_role' then
 (select jsonb_build_object('id',e.event_id,'type',e.event_type,
  'location_id',e.location_id,'organization_id',e.organization_id,'data',e.data)
 from private.ed_last_webhook_events e where e.event_id=p_event_id)
 else null end
$function$;

create or replace function public.ed_last_mark_event(p_event_id text,p_error text default null)
 returns boolean language plpgsql security definer set search_path to ''
as $function$
begin
 if (select auth.role())<>'service_role' then raise exception 'Unauthorized';end if;
 update private.ed_last_webhook_events set processed_at=case when p_error is null then now() else null end,
   processing_error=left(p_error,400)
 where event_id=p_event_id;
 return found;
end $function$;

-- Only delivery tabs for an explicitly enabled location can reach a Rider.
create or replace function public.ed_last_import_tab(
 p_location_id text,p_tab_id text,p_tab jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 account uuid; oid uuid; existing public.ed_orders%rowtype;
 delivery jsonb; customer jsonb; courier jsonb;
 pickup text; courier_id text; matched_rider uuid; courier_count integer;
 chosen_rider uuid; rider_explicit boolean:=false;
 cancelled boolean; code text; ref text; name text; addr text;
 notes text; channel text; method text; total_cents numeric:=0; amount_eur numeric:=0;
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
 name=left(btrim(concat_ws(' ',nullif(customer->>'name',''),nullif(customer->>'surname',''))),120);
 if name='' then name='Cliente';end if;
 code=left(coalesce(nullif(p_tab->>'code',''),p_tab_id),55);
 ref=left('LA-'||p_tab_id,80);
 notes=left(concat_ws(' | ',nullif(btrim(coalesce(delivery->>'details','')),''),
       nullif(btrim(coalesce(p_tab->>'customerNote','')),''),
       'Last.app #'||code),1000);

 if (delivery->>'latitude') ~ '^[-]?[0-9]+([.][0-9]+)?$' and
    (delivery->>'longitude') ~ '^[-]?[0-9]+([.][0-9]+)?$' then
  lat=(delivery->>'latitude')::double precision;
  lng=(delivery->>'longitude')::double precision;
  if lat not between -90 and 90 or lng not between -180 and 180 then lat=null;lng=null;end if;
 end if;

 source=lower(coalesce(p_tab->>'source',''));
 channel=case when source like '%uber%' then 'uber'
   when source like '%just%eat%' then 'justeat' else 'lastapp' end;
 method=lower(coalesce(p_tab->>'preferredPaymentMethod',''));
 method=case when method like '%cash%' or method like '%efectiv%' then 'efectivo'
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
  if chosen_rider is null and rider_explicit then chosen_rider=existing.rider_id;end if;
 end if;
 if chosen_rider is null and not rider_explicit then
  -- Online and enrolled only. Least open orders; deterministic tie-break.
  select r.id into chosen_rider from public.ed_riders r
   where r.account_id=account and r.active and r.online and r.user_id is not null
   order by (select count(*) from public.ed_orders o
       where o.rider_id=r.id and o.status in ('asignado','recogido','en_ruta')),
      r.created_at,r.id limit 1 for update of r skip locked;
 end if;
 status=case when cancelled then 'cancelado'
    when chosen_rider is not null then 'asignado' else 'pendiente' end;

 if oid is null then
  insert into public.ed_orders(account_id,reference,channel,customer_name,customer_phone,
     destination,lat,lng,amount,status,rider_id,notes,payment_method,
     notifications_consent,notification_channel)
  values(account,ref,channel,name,left(nullif(customer->>'phoneNumber',''),35),
     left(addr,400),lat,lng,amount_eur,status,chosen_rider,notes,method,false,'none')
  returning id into oid;
  insert into private.ed_last_order_links(location_id,tab_id,order_id)
   values(p_location_id,p_tab_id,oid);
 else
  -- Only pending/assigned fields are synchronized. Rider-owned picked-up states survive.
  update public.ed_orders o set
   channel=channel,customer_name=name,customer_phone=left(nullif(customer->>'phoneNumber',''),35),
   destination=left(addr,400),lat=lat,lng=lng,amount=amount_eur,notes=notes,
   payment_method=method,
   rider_id=case when existing.status in ('pendiente','asignado') then chosen_rider else existing.rider_id end,
   status=case when cancelled then 'cancelado'
       when existing.status in ('pendiente','asignado') then status else existing.status end
  where o.id=oid;
  update private.ed_last_order_links set updated_at=now()
  where location_id=p_location_id and tab_id=p_tab_id;
 end if;
 return jsonb_build_object('order_id',oid,'status',status,
   'rider_assigned',chosen_rider is not null,'waiting_for_online_rider',chosen_rider is null);
end $function$;

create or replace function public.ed_last_cancel_tab(p_location_id text,p_tab_id text)
 returns boolean language plpgsql security definer set search_path to ''
as $function$
declare oid uuid;
begin
 if (select auth.role())<>'service_role' then raise exception 'Unauthorized';end if;
 select lk.order_id into oid from private.ed_last_order_links lk
 join private.ed_last_locations l on l.location_id=lk.location_id
 where lk.location_id=p_location_id and lk.tab_id=p_tab_id and l.enabled;
 if oid is null then return false;end if;
 update public.ed_orders o set status='cancelado'
 where o.id=oid and o.status not in ('entregado','cancelado');
 return true;
end $function$;

revoke all on function
 public.ed_last_record_location(text,text,text),
 public.ed_last_bind_location(text,uuid),
 public.ed_last_get_event(text),
 public.ed_last_mark_event(text,text),
 public.ed_last_import_tab(text,text,jsonb),
 public.ed_last_cancel_tab(text,text)
 from public,anon,authenticated;
grant execute on function
 public.ed_last_record_location(text,text,text),
 public.ed_last_bind_location(text,uuid),
 public.ed_last_get_event(text),
 public.ed_last_mark_event(text,text),
 public.ed_last_import_tab(text,text,jsonb),
 public.ed_last_cancel_tab(text,text)
 to service_role;
commit;