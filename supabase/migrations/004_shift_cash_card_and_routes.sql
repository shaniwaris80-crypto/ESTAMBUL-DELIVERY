-- ESTAMBUL DELIVERY: cierre diario (zona Europe/Madrid), arqueo desglosado, informes y restricciones.
-- No marca dinero como cobrado automáticamente; solo agrupa el método de pago previsto.
begin;
alter table public.ed_orders add column if not exists delivered_at timestamptz;
create table if not exists public.ed_shift_closures(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 rider_id uuid not null,
 shift_day date not null,
 completed_count integer not null check(completed_count>=0),
 legacy_count integer not null default 0 check(legacy_count>=0),
 cash_expected numeric(12,2) not null default 0,
 card_total numeric(12,2) not null default 0,
 unknown_total numeric(12,2) not null default 0,
 cash_declared numeric(12,2) not null check(cash_declared>=0),
 cash_difference numeric(12,2) not null,
 notes text not null default '' check(length(notes)<=600),
 closed_at timestamptz not null default now(),
 closed_by uuid not null references auth.users(id),
 unique(account_id,rider_id,shift_day),
 foreign key(rider_id,account_id) references public.ed_riders(id,account_id)
);
create table if not exists public.ed_shift_closure_items(
 close_id uuid not null references public.ed_shift_closures(id) on delete cascade,
 order_id uuid not null references public.ed_orders(id) on delete restrict,
 reference text not null,
 customer_name text not null,
 payment_method text check(payment_method in ('efectivo','tarjeta')),
 amount numeric(10,2) not null check(amount>=0),
 legacy_timestamp boolean not null default false,
 primary key(close_id,order_id)
);
create index if not exists ed_closures_account_day on public.ed_shift_closures(account_id,shift_day desc);
alter table public.ed_shift_closures enable row level security;
alter table public.ed_shift_closure_items enable row level security;
revoke all on public.ed_shift_closures,public.ed_shift_closure_items from anon;
revoke insert,update,delete on public.ed_shift_closures,public.ed_shift_closure_items from authenticated;
grant select on public.ed_shift_closures,public.ed_shift_closure_items to authenticated;
drop policy if exists ed_shift_closures_reader on public.ed_shift_closures;
create policy ed_shift_closures_reader on public.ed_shift_closures for select to authenticated
 using(private.ed_is_staff(account_id) or private.ed_is_rider(account_id,rider_id));
drop policy if exists ed_shift_items_read on public.ed_shift_closure_items;
create policy ed_shift_items_read on public.ed_shift_closure_items for select to authenticated
 using(exists(select 1 from public.ed_shift_closures s where s.id=close_id
 and (private.ed_is_staff(s.account_id) or private.ed_is_rider(s.account_id,s.rider_id))));

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
      or new.rider_id is distinct from old.rider_id
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
    if new.rider_id is not null and
      not exists(select 1 from public.ed_riders r where r.id=new.rider_id and r.account_id=new.account_id and r.active)
    then raise exception 'Rider is not active'; end if;
    if old.status in ('entregado','cancelado') and
      (new.rider_id is distinct from old.rider_id or new.status is distinct from old.status)
    then raise exception 'Finalized orders cannot be reassigned'; end if;
  end if;
  if new.status='entregado' and old.status is distinct from new.status then
    new.delivered_at=now();
  else
    new.delivered_at=old.delivered_at;
  end if;
  new.updated_at=now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.ed_shift_metrics(p_rider uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with day_orders as (
   select amount,payment_method,delivered_at
   from public.ed_orders
   where rider_id=p_rider and status='entregado'
     and (coalesce(delivered_at,updated_at) at time zone 'Europe/Madrid')::date=p_day
 ), totals as (
   select count(*)::integer as completed_count,
     count(*) filter (where delivered_at is null)::integer as legacy_count,
     coalesce(sum(amount) filter (where payment_method='efectivo'),0)::numeric(12,2) as cash_expected,
     coalesce(sum(amount) filter (where payment_method='tarjeta'),0)::numeric(12,2) as card_total,
     coalesce(sum(amount) filter (where payment_method is null),0)::numeric(12,2) as unknown_total
   from day_orders
 )
 select jsonb_build_object(
   'shift_day',p_day,
   'completed_count',t.completed_count,
   'legacy_count',t.legacy_count,
   'cash_expected',t.cash_expected,
   'card_total',t.card_total,
   'unknown_total',t.unknown_total,
   'pending_count',(select count(*) from public.ed_orders o
      where o.rider_id=p_rider and o.status not in ('entregado','cancelado'))
 ) from totals t;
$function$;

CREATE OR REPLACE FUNCTION private.ed_shift_lines(p_rider uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',o.id,'reference',o.reference,'customer_name',o.customer_name,
   'payment_method',o.payment_method,'amount',o.amount,
   'legacy_timestamp',o.delivered_at is null)
   order by coalesce(o.delivered_at,o.updated_at),o.id),'[]'::jsonb)
 from public.ed_orders o
 where o.rider_id=p_rider and o.status='entregado'
  and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=p_day;
$function$;

CREATE OR REPLACE FUNCTION public.ed_shift_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  d date := (now() at time zone 'Europe/Madrid')::date;
  m jsonb;
  items jsonb;
  close_rec public.ed_shift_closures%rowtype;
begin
  select er.id as rider_id,er.account_id into r
  from public.ed_riders er
  join public.ed_members mem on mem.account_id=er.account_id
    and mem.user_id=er.user_id and mem.active and mem.role='rider'
  where er.user_id=(select auth.uid()) and er.active
  limit 1;
  if r.rider_id is null then raise exception 'Rider no autorizado';end if;

  m=private.ed_shift_metrics(r.rider_id,d);
  select * into close_rec from public.ed_shift_closures c
  where c.rider_id=r.rider_id and c.account_id=r.account_id and c.shift_day=d;
  if close_rec.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',li.order_id,'reference',li.reference,'customer_name',li.customer_name,
      'payment_method',li.payment_method,'amount',li.amount,
      'legacy_timestamp',li.legacy_timestamp) order by li.reference),'[]'::jsonb)
    into items
    from public.ed_shift_closure_items li where li.close_id=close_rec.id;
    m=jsonb_build_object('shift_day',d,
      'completed_count',close_rec.completed_count,'legacy_count',close_rec.legacy_count,
      'cash_expected',close_rec.cash_expected,'card_total',close_rec.card_total,
      'unknown_total',close_rec.unknown_total,'pending_count',0);
  else
    items=private.ed_shift_lines(r.rider_id,d);
  end if;
  return m || jsonb_build_object('closed',close_rec.id is not null,
    'cash_declared',close_rec.cash_declared,
    'cash_difference',close_rec.cash_difference,
    'closed_at',close_rec.closed_at,
    'grand_total',(m->>'cash_expected')::numeric+
      (m->>'card_total')::numeric+(m->>'unknown_total')::numeric,
    'cash_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='efectivo'),
    'card_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='tarjeta'),
    'unknown_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method' is null),
    'orders',items);
end $function$;

CREATE OR REPLACE FUNCTION public.ed_shift_close(p_declared_cash numeric, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  d date := (now() at time zone 'Europe/Madrid')::date;
  m jsonb;
  closure public.ed_shift_closures%rowtype;
begin
  if p_declared_cash is null or p_declared_cash<0 or p_declared_cash>999999
    or p_declared_cash<>round(p_declared_cash,2) then
    raise exception 'Indica efectivo contado valido con dos decimales';
  end if;
  if length(coalesce(p_notes,''))>600 then raise exception 'Observaciones demasiado largas';end if;

  select er.id as rider_id,er.account_id into r
  from public.ed_riders er
  join public.ed_members mem on mem.account_id=er.account_id
    and mem.user_id=er.user_id and mem.active and mem.role='rider'
  where er.user_id=(select auth.uid()) and er.active
  order by er.id limit 1 for update of er;

  if r.rider_id is null then raise exception 'Rider no autorizado';end if;
  if exists(select 1 from public.ed_shift_closures c
    where c.rider_id=r.rider_id and c.account_id=r.account_id and c.shift_day=d) then
    raise exception 'La jornada ya esta cerrada';
  end if;
  m=private.ed_shift_metrics(r.rider_id,d);
  if (m->>'pending_count')::integer>0 then
    raise exception 'No puedes cerrar: hay pedidos asignados sin finalizar';
  end if;
  insert into public.ed_shift_closures(account_id,rider_id,shift_day,
    completed_count,legacy_count,cash_expected,card_total,unknown_total,
    cash_declared,cash_difference,notes,closed_by)
  values(r.account_id,r.rider_id,d,
    (m->>'completed_count')::integer,(m->>'legacy_count')::integer,
    (m->>'cash_expected')::numeric,(m->>'card_total')::numeric,(m->>'unknown_total')::numeric,
    p_declared_cash,p_declared_cash-(m->>'cash_expected')::numeric,
    coalesce(p_notes,''),(select auth.uid()))
  returning * into closure;

  insert into public.ed_shift_closure_items(close_id,order_id,reference,customer_name,payment_method,amount,legacy_timestamp)
  select closure.id,o.id,o.reference,o.customer_name,o.payment_method,o.amount,o.delivered_at is null
  from public.ed_orders o
  where o.rider_id=r.rider_id and o.status='entregado'
    and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=d;
  update public.ed_riders set online=false where id=r.rider_id;
  return public.ed_shift_preview();
end $function$;

CREATE OR REPLACE FUNCTION private.ed_no_post_close_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.rider_id is not null
   and new.status not in ('entregado','cancelado')
   and exists (select 1 from public.ed_shift_closures c
     where c.rider_id=new.rider_id and c.account_id=new.account_id
       and c.shift_day=(now() at time zone 'Europe/Madrid')::date)
   and (tg_op='INSERT' or old.rider_id is distinct from new.rider_id or old.status is distinct from new.status)
  then raise exception 'Este repartidor ya ha terminado la jornada de hoy'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.ed_guard_shift_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.online and not old.online and exists(
  select 1 from public.ed_shift_closures c
  where c.rider_id=new.id and c.account_id=new.account_id
    and c.shift_day=(now() at time zone 'Europe/Madrid')::date
 ) then raise exception 'Jornada cerrada: no disponible hasta manana';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.ed_validate_shift_archeo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(
   select 1 from public.ed_orders o
   where o.rider_id=new.rider_id and o.account_id=new.account_id
     and o.status='entregado'
     and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=new.shift_day
     and o.payment_method is null
 ) then raise exception 'Hay pedidos sin forma de pago: el administrador debe clasificarlos antes del cierre';
 end if;
 return new;
end $function$;

revoke all on function public.ed_shift_preview(),public.ed_shift_close(numeric,text) from public,anon;
grant execute on function public.ed_shift_preview(),public.ed_shift_close(numeric,text) to authenticated;
revoke all on function private.ed_shift_metrics(uuid,date),private.ed_shift_lines(uuid,date) from public,anon,authenticated;
drop trigger if exists ed_prevent_post_close_assignment on public.ed_orders;
create trigger ed_prevent_post_close_assignment before insert or update on public.ed_orders for each row execute function private.ed_no_post_close_assignment();
drop trigger if exists ed_shift_availability_guard on public.ed_riders;
create trigger ed_shift_availability_guard before update on public.ed_riders for each row execute function private.ed_guard_shift_availability();
drop trigger if exists ed_require_payment_archeo on public.ed_shift_closures;
create trigger ed_require_payment_archeo before insert on public.ed_shift_closures for each row execute function private.ed_validate_shift_archeo();
commit;
