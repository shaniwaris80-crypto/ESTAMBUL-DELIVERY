-- Estambul Delivery: payment type not actual settlement.
alter table public.ed_orders add column if not exists payment_method text
  check(payment_method in ('efectivo','tarjeta'));
comment on column public.ed_orders.payment_method is 'Efectivo/tarjeta; null = no especificado. No confirma el cobro.';

-- All new columns must be protected against Rider updates.
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
  new.updated_at=now();
  return new;
end $function$;
