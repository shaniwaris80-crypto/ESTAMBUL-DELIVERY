-- ESTAMBUL DELIVERY · esquema v1 para pruebas multi-dispositivo.
-- Ejecutar una única vez en SQL Editor de un proyecto Supabase VACÍO.
-- No importa datos de Last.app ni activa geolocalización.
begin;
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ed_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.ed_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ed_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','dispatcher','rider')),
  active boolean not null default true,
  unique(account_id,user_id)
);
create index if not exists ed_members_user_ix on public.ed_members(user_id,account_id);

create table if not exists public.ed_riders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ed_accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  external_rider_id text,
  display_name text not null check(char_length(display_name) between 1 and 120),
  phone text,
  active boolean not null default true,
  online boolean not null default false,
  created_at timestamptz not null default now(),
  unique(id,account_id),
  unique(account_id,user_id),
  unique(account_id,external_rider_id)
);
create index if not exists ed_riders_account_ix on public.ed_riders(account_id);

create table if not exists public.ed_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ed_accounts(id) on delete cascade,
  reference text not null check(char_length(reference) between 1 and 80),
  channel text not null check(channel in ('lastapp','uber','justeat','test')),
  customer_name text not null check(char_length(customer_name) between 1 and 120),
  destination text not null check(char_length(destination) between 1 and 400),
  lat double precision,
  lng double precision,
  amount numeric(10,2) not null default 0 check (amount>=0),
  status text not null default 'pendiente' check(status in ('pendiente','asignado','recogido','en_ruta','entregado','cancelado')),
  rider_id uuid,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,reference),
  constraint ed_coordinates_pair check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180)),
  constraint ed_rider_account_fk foreign key (rider_id,account_id) references public.ed_riders(id,account_id),
  constraint ed_order_assignment_check check (
    (rider_id is null and status in ('pendiente','cancelado')) or
    (rider_id is not null and status in ('asignado','recogido','en_ruta','entregado','cancelado'))
  )
);
create index if not exists ed_orders_account_ix on public.ed_orders(account_id,status,created_at desc);
create index if not exists ed_orders_rider_ix on public.ed_orders(rider_id,status);

-- Helper functions are NOT exposed via PostgREST.
create or replace function private.ed_is_staff(p_account uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.ed_members m
    where m.account_id=p_account and m.user_id=(select auth.uid())
      and m.active and m.role in ('admin','dispatcher')
  )
$$;
create or replace function private.ed_is_rider(p_account uuid,p_rider uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
   select 1 from public.ed_riders r
   join public.ed_members m on m.account_id=r.account_id and m.user_id=r.user_id
   where r.id=p_rider and r.account_id=p_account and r.active
   and r.user_id=(select auth.uid()) and m.active and m.role='rider'
 )
$$;

create or replace function private.ed_guard_order_update()
returns trigger language plpgsql security definer set search_path=''
as $$
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
      or new.destination is distinct from old.destination
      or new.lat is distinct from old.lat or new.lng is distinct from old.lng
      or new.amount is distinct from old.amount or new.rider_id is distinct from old.rider_id
      or new.notes is distinct from old.notes then
      raise exception 'Riders may change only delivery status';
    end if;
    if not (
      (old.status='asignado' and new.status='recogido') or
      (old.status='recogido' and new.status='en_ruta') or
      (old.status='en_ruta' and new.status='entregado')
    ) then
      raise exception 'Invalid rider status transition';
    end if;
  else
    -- Staff must not assign orders to riders deactivated in this account.
    if new.rider_id is not null and
      not exists(select 1 from public.ed_riders r where r.id=new.rider_id and r.account_id=new.account_id and r.active)
    then raise exception 'Rider is not active'; end if;
    if old.status in ('entregado','cancelado') and
      (new.rider_id is distinct from old.rider_id or new.status is distinct from old.status)
    then raise exception 'Finalized orders cannot be reassigned'; end if;
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists ed_order_guard on public.ed_orders;
create trigger ed_order_guard before update on public.ed_orders
for each row execute function private.ed_guard_order_update();

create or replace function private.ed_guard_rider_update()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.id is distinct from old.id or new.account_id is distinct from old.account_id then
  raise exception 'Identity fields immutable';
 end if;
 if not private.ed_is_staff(old.account_id) then
  if not private.ed_is_rider(old.account_id,old.id) then raise exception 'Not this rider'; end if;
  if new.user_id is distinct from old.user_id
    or new.external_rider_id is distinct from old.external_rider_id
    or new.display_name is distinct from old.display_name
    or new.phone is distinct from old.phone
    or new.active is distinct from old.active
  then raise exception 'Riders may change only their online status'; end if;
 end if;
 return new;
end $$;
drop trigger if exists ed_rider_guard on public.ed_riders;
create trigger ed_rider_guard before update on public.ed_riders
for each row execute function private.ed_guard_rider_update();

-- Staff cannot deactivate a rider still assigned to open deliveries.
create or replace function private.ed_prevent_busy_deactivation()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if old.active and not new.active and exists(
  select 1 from public.ed_orders o where o.rider_id=old.id and o.status not in ('entregado','cancelado')
 ) then raise exception 'Reasigna primero sus pedidos pendientes'; end if;
 return new;
end $$;
drop trigger if exists ed_prevent_busy_rider on public.ed_riders;
create trigger ed_prevent_busy_rider before update on public.ed_riders
for each row execute function private.ed_prevent_busy_deactivation();

alter table public.ed_accounts enable row level security;
alter table public.ed_members enable row level security;
alter table public.ed_riders enable row level security;
alter table public.ed_orders enable row level security;
revoke all on public.ed_accounts,public.ed_members,public.ed_riders,public.ed_orders from anon, authenticated;
grant select on public.ed_accounts to authenticated;
grant select on public.ed_members to authenticated;
grant select,insert,update on public.ed_riders to authenticated;
grant select,insert,update on public.ed_orders to authenticated;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.ed_is_staff(uuid),private.ed_is_rider(uuid,uuid) to authenticated;
revoke all on function private.ed_guard_order_update(),private.ed_guard_rider_update(),private.ed_prevent_busy_deactivation() from public,anon,authenticated;

create policy ed_account_select on public.ed_accounts for select to authenticated
 using (exists (select 1 from public.ed_members m where m.account_id=id and m.user_id=(select auth.uid()) and m.active));
create policy ed_member_select on public.ed_members for select to authenticated
 using (user_id=(select auth.uid()) or (select private.ed_is_staff(account_id)));
create policy ed_riders_select on public.ed_riders for select to authenticated
 using ((select private.ed_is_staff(account_id)) or (select private.ed_is_rider(account_id,id)));
create policy ed_riders_insert on public.ed_riders for insert to authenticated
 with check ((select private.ed_is_staff(account_id)));
create policy ed_riders_update on public.ed_riders for update to authenticated
 using ((select private.ed_is_staff(account_id)) or (select private.ed_is_rider(account_id,id)))
 with check ((select private.ed_is_staff(account_id)) or (select private.ed_is_rider(account_id,id)));

create policy ed_orders_select on public.ed_orders for select to authenticated
 using ((select private.ed_is_staff(account_id)) or (rider_id is not null and (select private.ed_is_rider(account_id,rider_id))));
create policy ed_orders_insert on public.ed_orders for insert to authenticated
 with check ((select private.ed_is_staff(account_id)));
create policy ed_orders_update on public.ed_orders for update to authenticated
 using ((select private.ed_is_staff(account_id)) or (rider_id is not null and (select private.ed_is_rider(account_id,rider_id))))
 with check ((select private.ed_is_staff(account_id)) or (rider_id is not null and (select private.ed_is_rider(account_id,rider_id))));

-- Prevent inconsistent INSERT created as an assigned order on an inactive rider.
create or replace function private.ed_guard_order_insert()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.rider_id is not null and not exists(
  select 1 from public.ed_riders r where r.id=new.rider_id and r.account_id=new.account_id and r.active
 ) then raise exception 'Rider inactive'; end if;
 return new;
end $$;
drop trigger if exists ed_order_insert_guard on public.ed_orders;
create trigger ed_order_insert_guard before insert on public.ed_orders
 for each row execute function private.ed_guard_order_insert();
revoke all on function private.ed_guard_order_insert() from public,anon,authenticated;
commit;
