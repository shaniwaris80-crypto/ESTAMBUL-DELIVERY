-- Assign waiting Last.app orders as soon as an enrolled Rider goes ONLINE.
-- Existing normal order transition rules remain unchanged.
begin;
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
 -- Authorized auto-assignment when an enrolled Rider comes online; can only alter
 -- status/rider on imported, unassigned orders in this same account.
 if current_setting('ed.last_auto_online',true)='allowed'
   and old.status='pendiente' and old.rider_id is null
   and new.status='asignado' and new.rider_id is not null
   and new.account_id=old.account_id
   and new.reference is not distinct from old.reference
   and new.channel is not distinct from old.channel
   and new.customer_name is not distinct from old.customer_name
   and new.customer_phone is not distinct from old.customer_phone
   and new.destination is not distinct from old.destination
   and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng
   and new.amount is not distinct from old.amount
   and new.notes is not distinct from old.notes
   and new.payment_method is not distinct from old.payment_method
   and new.accepted_at is not distinct from old.accepted_at
   and exists(select 1 from private.ed_last_order_links lk
     join private.ed_last_locations loc on loc.location_id=lk.location_id
     where lk.order_id=old.id and loc.enabled and loc.account_id=old.account_id)
   and exists(select 1 from public.ed_riders r
     where r.id=new.rider_id and r.account_id=old.account_id and r.active and r.online
       and r.user_id is not null)
 then
   new.updated_at=now();
   return new;
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
create or replace function private.ed_last_claim_waiting_on_online()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
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
   order by o.created_at limit 25
   for update of o skip locked
  )
  update public.ed_orders o set rider_id=new.id,status='asignado'
  from to_assign t where t.id=o.id;
  perform set_config('ed.last_auto_online','',true);
 end if;
 return new;
end $function$;
drop trigger if exists ed_last_autoclaim_on_rider_online on public.ed_riders;
create trigger ed_last_autoclaim_on_rider_online
 after update of online on public.ed_riders
 for each row execute function private.ed_last_claim_waiting_on_online();
revoke all on function private.ed_last_claim_waiting_on_online() from public,anon,authenticated;
commit;
