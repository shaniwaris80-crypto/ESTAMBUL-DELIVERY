-- ESTAMBUL DELIVERY: varios arqueos por Rider y día.
-- Cada arqueo tiene snapshot único; al reabrir, el siguiente NO suma pedidos de cierres previos.
begin;
alter table public.ed_riders add column if not exists shift_opened_at timestamptz;
alter table public.ed_shift_closures drop constraint if exists ed_shift_closures_account_id_rider_id_shift_day_key;
alter table public.ed_shift_closures alter column closed_at set default clock_timestamp();
create index if not exists ed_shift_closures_rider_day_time
 on public.ed_shift_closures(rider_id,shift_day,closed_at desc);
drop trigger if exists ed_shift_availability_guard on public.ed_riders;
drop trigger if exists ed_prevent_post_close_assignment on public.ed_orders;
CREATE OR REPLACE FUNCTION private.ed_finish_shift(p_cash numeric, p_notes text, p_provisional boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 r record; d date := (now() at time zone 'Europe/Madrid')::date;
 m jsonb; previous_close record; new_close public.ed_shift_closures%rowtype;
begin
 if p_cash is null or p_cash<0 or p_cash>999999 or p_cash<>round(p_cash,2) then
   raise exception 'Introduce efectivo contado válido con dos decimales';end if;
 if length(coalesce(p_notes,''))>600 then raise exception 'Observaciones demasiado largas';end if;
 select er.id as rider_id,er.account_id,er.shift_opened_at into r
 from public.ed_riders er
 join public.ed_members mem on mem.account_id=er.account_id
  and mem.user_id=er.user_id and mem.active and mem.role='rider'
 where er.user_id=(select auth.uid()) and er.active
 order by er.id limit 1 for update of er;
 if r.rider_id is null then raise exception 'Rider no autorizado';end if;
 select c.closed_at into previous_close
 from public.ed_shift_closures c where c.rider_id=r.rider_id and c.shift_day=d
 order by c.closed_at desc,c.id desc limit 1;
 if previous_close.closed_at is not null
   and (r.shift_opened_at is null or r.shift_opened_at<=previous_close.closed_at) then
   raise exception 'Este turno ya está cerrado. Ponte online para iniciar otro.';
 end if;
 m=private.ed_shift_metrics(r.rider_id,d);
 if (m->>'pending_count')::integer>0 then
   raise exception 'Debes entregar o reasignar los pedidos pendientes antes del cierre';end if;
 if (m->>'completed_count')::integer=0 then
   raise exception 'No hay nuevas entregas desde el último arqueo';end if;
 if p_provisional then
   if (m->>'unknown_total')::numeric<=0 or length(btrim(coalesce(p_notes,'')))<8 then
     raise exception 'Para cerrar provisionalmente explica los pagos sin clasificar (mínimo 8 caracteres)';end if;
 else
   if (m->>'unknown_total')::numeric>0 then
     raise exception 'Usa cierre provisional para pagos sin clasificar';end if;
 end if;
 insert into public.ed_shift_closures(account_id,rider_id,shift_day,completed_count,legacy_count,
  cash_expected,card_total,unknown_total,cash_declared,cash_difference,notes,closed_by,is_provisional)
 values(r.account_id,r.rider_id,d,
  (m->>'completed_count')::integer,(m->>'legacy_count')::integer,
  (m->>'cash_expected')::numeric,(m->>'card_total')::numeric,(m->>'unknown_total')::numeric,
  p_cash,p_cash-(m->>'cash_expected')::numeric,coalesce(p_notes,''),(select auth.uid()),p_provisional)
 returning * into new_close;
 insert into public.ed_shift_closure_items(close_id,order_id,reference,customer_name,payment_method,amount,legacy_timestamp)
 select new_close.id,o.id,o.reference,o.customer_name,o.payment_method,o.amount,o.delivered_at is null
 from public.ed_orders o
 where o.rider_id=r.rider_id and o.status='entregado'
  and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=d
  and not exists(select 1 from public.ed_shift_closure_items li where li.order_id=o.id);
 update public.ed_riders set online=false where id=r.rider_id;
 return public.ed_shift_preview();
end $function$;

CREATE OR REPLACE FUNCTION private.ed_mark_shift_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.online and not old.online then
   new.shift_opened_at=clock_timestamp();
 else
   new.shift_opened_at=old.shift_opened_at;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_shift_close(p_declared_cash numeric, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 return private.ed_finish_shift(p_declared_cash,p_notes,false);
end $function$;

CREATE OR REPLACE FUNCTION public.ed_shift_close_provisional(p_declared_cash numeric, p_notes text, p_acknowledge_unknown boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_acknowledge_unknown is distinct from true then raise exception 'Confirma los pagos pendientes';end if;
 return private.ed_finish_shift(p_declared_cash,p_notes,true);
end $function$;

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
   and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=p_day
   and not exists(select 1 from public.ed_shift_closure_items li where li.order_id=o.id);
$function$;

CREATE OR REPLACE FUNCTION private.ed_shift_metrics(p_rider uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with day_orders as (
   select o.amount,o.payment_method,o.delivered_at
   from public.ed_orders o
   where o.rider_id=p_rider and o.status='entregado'
    and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=p_day
    and not exists(select 1 from public.ed_shift_closure_items li where li.order_id=o.id)
 ), totals as (
   select count(*)::integer as completed_count,
     count(*) filter(where delivered_at is null)::integer as legacy_count,
     coalesce(sum(amount) filter(where payment_method='efectivo'),0)::numeric(12,2) as cash_expected,
     coalesce(sum(amount) filter(where payment_method='tarjeta'),0)::numeric(12,2) as card_total,
     coalesce(sum(amount) filter(where payment_method is null),0)::numeric(12,2) as unknown_total
   from day_orders
 )
 select jsonb_build_object(
   'shift_day',p_day,'completed_count',t.completed_count,'legacy_count',t.legacy_count,
   'cash_expected',t.cash_expected,'card_total',t.card_total,'unknown_total',t.unknown_total,
   'pending_count',(select count(*) from public.ed_orders o
      where o.rider_id=p_rider and o.status not in ('entregado','cancelado'))
 ) from totals t;
$function$;

CREATE OR REPLACE FUNCTION public.ed_shift_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 r record; d date := (now() at time zone 'Europe/Madrid')::date;
 m jsonb; items jsonb; old_close public.ed_shift_closures%rowtype;
 is_closed boolean := false;
begin
 select er.id as rider_id,er.account_id,er.online,er.shift_opened_at into r
 from public.ed_riders er
 join public.ed_members mem on mem.account_id=er.account_id
  and mem.user_id=er.user_id and mem.active and mem.role='rider'
 where er.user_id=(select auth.uid()) and er.active limit 1;
 if r.rider_id is null then raise exception 'Rider no autorizado';end if;
 select * into old_close from public.ed_shift_closures c
 where c.rider_id=r.rider_id and c.account_id=r.account_id and c.shift_day=d
 order by c.closed_at desc,c.id desc limit 1;
 is_closed=old_close.id is not null
  and (r.shift_opened_at is null or r.shift_opened_at<=old_close.closed_at);
 if is_closed then
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',li.order_id,'reference',li.reference,'customer_name',li.customer_name,
   'payment_method',li.payment_method,'amount',li.amount,
   'legacy_timestamp',li.legacy_timestamp) order by li.reference),'[]'::jsonb)
  into items from public.ed_shift_closure_items li where li.close_id=old_close.id;
  m=jsonb_build_object('shift_day',d,
   'completed_count',old_close.completed_count,'legacy_count',old_close.legacy_count,
   'cash_expected',old_close.cash_expected,'card_total',old_close.card_total,
   'unknown_total',old_close.unknown_total,'pending_count',0);
 else
  m=private.ed_shift_metrics(r.rider_id,d);
  items=private.ed_shift_lines(r.rider_id,d);
 end if;
 return m || jsonb_build_object('closed',is_closed,
  'is_provisional',case when is_closed then old_close.is_provisional else false end,
  'notes',case when is_closed then old_close.notes else null end,
  'cash_declared',case when is_closed then old_close.cash_declared else null end,
  'cash_difference',case when is_closed then old_close.cash_difference else null end,
  'closed_at',case when is_closed then old_close.closed_at else null end,
  'previous_closures',(select count(*) from public.ed_shift_closures c
    where c.rider_id=r.rider_id and c.shift_day=d),
  'grand_total',(m->>'cash_expected')::numeric+(m->>'card_total')::numeric+(m->>'unknown_total')::numeric,
  'cash_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='efectivo'),
  'card_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='tarjeta'),
  'unknown_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method' is null),
  'orders',items);
end $function$;

CREATE OR REPLACE FUNCTION private.ed_validate_shift_archeo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.ed_orders o
   where o.rider_id=new.rider_id and o.account_id=new.account_id and o.status='entregado'
    and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=new.shift_day
    and o.payment_method is null
    and not exists(select 1 from public.ed_shift_closure_items li where li.order_id=o.id))
   and not new.is_provisional then
    raise exception 'Hay pagos sin clasificar: cierra provisionalmente con observaciones';
 end if;
 if new.is_provisional and (new.unknown_total<=0 or length(btrim(new.notes))<8) then
    raise exception 'Cierre provisional requiere observaciones (mínimo 8 caracteres)';
 end if;
 return new;
end $function$;

drop trigger if exists ed_mark_shift_open on public.ed_riders;
create trigger ed_mark_shift_open before update on public.ed_riders
 for each row execute function private.ed_mark_shift_open();
revoke all on function private.ed_shift_metrics(uuid,date),private.ed_shift_lines(uuid,date),
 private.ed_finish_shift(numeric,text,boolean) from public,anon,authenticated;
revoke all on function public.ed_shift_preview(),public.ed_shift_close(numeric,text),
 public.ed_shift_close_provisional(numeric,text,boolean) from public,anon;
grant execute on function public.ed_shift_preview(),public.ed_shift_close(numeric,text),
 public.ed_shift_close_provisional(numeric,text,boolean) to authenticated;
commit;
