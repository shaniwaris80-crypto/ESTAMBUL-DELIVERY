-- Estambul Delivery: cierre provisional explícito para repartos entregados sin forma de pago.
-- No infiere efectivo/tarjeta. Exige declaración, explicación y confirmación.
begin;
alter table public.ed_shift_closures
 add column if not exists is_provisional boolean not null default false;
comment on column public.ed_shift_closures.is_provisional is
 'Cierre con métodos de pago pendientes de conciliación; no confirma cobros.';
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
 ) and not new.is_provisional then
   raise exception 'Hay pagos sin clasificar: usa el cierre provisional con observaciones o completa los métodos de pago';
 end if;
 if new.is_provisional and (new.unknown_total<=0 or length(btrim(new.notes))<8) then
    raise exception 'El cierre provisional requiere importes sin clasificar y una observación de al menos 8 caracteres';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_shift_close_provisional(p_declared_cash numeric, p_notes text, p_acknowledge_unknown boolean)
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
 if p_acknowledge_unknown is distinct from true then
   raise exception 'Confirma que las entregas sin método de pago quedan pendientes de conciliación';
 end if;
 if p_declared_cash is null or p_declared_cash<0 or p_declared_cash>999999
     or p_declared_cash<>round(p_declared_cash,2) then
   raise exception 'Introduce el efectivo realmente contado con dos decimales';
 end if;
 if p_notes is null or length(btrim(p_notes))<8 or length(p_notes)>600 then
   raise exception 'Explica el motivo del cierre provisional (8-600 caracteres)';
 end if;
 select er.id as rider_id,er.account_id into r
 from public.ed_riders er
 join public.ed_members mem on mem.account_id=er.account_id
   and mem.user_id=er.user_id and mem.active and mem.role='rider'
 where er.user_id=(select auth.uid()) and er.active
 order by er.id limit 1 for update of er;
 if r.rider_id is null then raise exception 'Repartidor no autorizado'; end if;
 if exists(select 1 from public.ed_shift_closures c
   where c.rider_id=r.rider_id and c.account_id=r.account_id and c.shift_day=d) then
   raise exception 'Esta jornada ya tiene un cierre guardado';
 end if;
 m=private.ed_shift_metrics(r.rider_id,d);
 if (m->>'pending_count')::integer>0 then
   raise exception 'Hay pedidos pendientes o en ruta. Deben completarse o reasignarse antes de cerrar';
 end if;
 if (m->>'unknown_total')::numeric<=0 then
   raise exception 'No hay importes sin clasificar: utiliza el cierre normal';
 end if;
 insert into public.ed_shift_closures(
  account_id,rider_id,shift_day,completed_count,legacy_count,cash_expected,
  card_total,unknown_total,cash_declared,cash_difference,notes,closed_by,is_provisional
 ) values(
  r.account_id,r.rider_id,d,
  (m->>'completed_count')::integer,(m->>'legacy_count')::integer,
  (m->>'cash_expected')::numeric,(m->>'card_total')::numeric,
  (m->>'unknown_total')::numeric,p_declared_cash,
  p_declared_cash-(m->>'cash_expected')::numeric,
  btrim(p_notes),(select auth.uid()),true
 ) returning * into closure;
 insert into public.ed_shift_closure_items(
  close_id,order_id,reference,customer_name,payment_method,amount,legacy_timestamp
 ) select closure.id,o.id,o.reference,o.customer_name,o.payment_method,o.amount,o.delivered_at is null
 from public.ed_orders o
 where o.rider_id=r.rider_id and o.status='entregado'
  and (coalesce(o.delivered_at,o.updated_at) at time zone 'Europe/Madrid')::date=d;
 update public.ed_riders set online=false where id=r.rider_id;
 return public.ed_shift_preview();
end $function$;

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
 where er.user_id=(select auth.uid()) and er.active limit 1;
 if r.rider_id is null then raise exception 'Rider no autorizado'; end if;
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
  m=jsonb_build_object('shift_day',d,'completed_count',close_rec.completed_count,
    'legacy_count',close_rec.legacy_count,'cash_expected',close_rec.cash_expected,
    'card_total',close_rec.card_total,'unknown_total',close_rec.unknown_total,'pending_count',0);
 else
  items=private.ed_shift_lines(r.rider_id,d);
 end if;
 return m || jsonb_build_object('closed',close_rec.id is not null,
  'is_provisional',coalesce(close_rec.is_provisional,false),
  'notes',close_rec.notes,
  'cash_declared',close_rec.cash_declared,'cash_difference',close_rec.cash_difference,
  'closed_at',close_rec.closed_at,
  'grand_total',(m->>'cash_expected')::numeric+(m->>'card_total')::numeric+(m->>'unknown_total')::numeric,
  'cash_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='efectivo'),
  'card_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method'='tarjeta'),
  'unknown_count',(select count(*) from jsonb_array_elements(items) v where v->>'payment_method' is null),
  'orders',items);
end $function$;
revoke all on function public.ed_shift_close_provisional(numeric,text,boolean) from public,anon;
grant execute on function public.ed_shift_close_provisional(numeric,text,boolean) to authenticated;
revoke all on function public.ed_shift_preview() from public,anon;
grant execute on function public.ed_shift_preview() to authenticated;
commit;
