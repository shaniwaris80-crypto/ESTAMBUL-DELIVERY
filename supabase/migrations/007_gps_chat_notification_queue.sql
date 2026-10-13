-- Estambul Delivery: permissioned foreground GPS, private per-order chat and transactional message queue.
-- Messenger transport stays disabled until an approved provider and explicit customer consent are configured.
begin;
create table if not exists public.ed_rider_positions(
 rider_id uuid primary key, account_id uuid not null,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 accuracy_m integer check(accuracy_m between 0 and 3000),
 updated_at timestamptz not null default now(),
 foreign key(rider_id,account_id) references public.ed_riders(id,account_id) on delete cascade
);
alter table public.ed_rider_positions enable row level security;
revoke all on public.ed_rider_positions from public,anon,authenticated;
grant select on public.ed_rider_positions to authenticated;
drop policy if exists ed_position_authorized on public.ed_rider_positions;
create policy ed_position_authorized on public.ed_rider_positions for select to authenticated using(
 updated_at > now()-interval '2 minutes'
 and exists(select 1 from public.ed_riders r where r.id=rider_id and r.account_id=account_id
   and r.online and r.active)
 and exists(select 1 from public.ed_orders o where o.rider_id=rider_id and o.account_id=account_id
   and o.status in ('recogido','en_ruta'))
 and (private.ed_is_staff(account_id) or private.ed_is_rider(account_id,rider_id))
);
create table if not exists public.ed_order_chat(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.ed_orders(id) on delete cascade,
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 sender_role text not null check(sender_role in ('customer','rider')),
 body text not null check(length(body) between 1 and 450),
 created_at timestamptz not null default now()
);
create index if not exists ed_order_chat_by_order on public.ed_order_chat(order_id,created_at desc);
alter table public.ed_order_chat enable row level security;
revoke all on public.ed_order_chat from public,anon,authenticated;
grant select on public.ed_order_chat to authenticated;
drop policy if exists ed_chat_staff_rider_read on public.ed_order_chat;
create policy ed_chat_staff_rider_read on public.ed_order_chat for select to authenticated using(
 private.ed_is_staff(account_id) or
 exists(select 1 from public.ed_orders o where o.id=order_id and o.account_id=account_id
  and private.ed_is_rider(o.account_id,o.rider_id))
);
alter table public.ed_orders add column if not exists notifications_consent boolean not null default false;
alter table public.ed_orders add column if not exists notification_channel text not null default 'none'
 check(notification_channel in ('none','sms','whatsapp'));
create table if not exists private.ed_notification_queue(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.ed_orders(id) on delete cascade,
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 channel text not null check(channel in ('sms','whatsapp')),
 destination text not null check(length(destination) between 6 and 35),
 event_status text not null,
 body text not null check(length(body)<=500),
 queued_at timestamptz not null default now(),
 delivery_status text not null default 'awaiting_provider'
 check(delivery_status in ('awaiting_provider','ready','sent','failed')),
 sent_at timestamptz,
 provider_message_id text,
 unique(order_id,channel,event_status)
);
revoke all on private.ed_notification_queue from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.ed_chat_link_order(p_token text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select o.id
 from private.ed_public_tracking_tokens t join public.ed_orders o on o.id=t.order_id and o.account_id=t.account_id
 where p_token ~ '^[a-f0-9]{64}$' and t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and t.revoked_at is null and t.expires_at>now() and o.rider_id is not null
  and o.status in ('asignado','recogido','en_ruta','entregado')
  and o.updated_at>now()-interval '48 hours'
 limit 1
$function$;

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

CREATE OR REPLACE FUNCTION private.ed_queue_customer_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare label text;
begin
 if new.notifications_consent and new.notification_channel in ('sms','whatsapp')
    and new.customer_phone is not null and length(btrim(new.customer_phone)) >= 6
    and new.status in ('asignado','recogido','en_ruta','entregado','cancelado')
    and old.status is distinct from new.status then
  label=case new.status when 'asignado' then 'Tu pedido tiene repartidor asignado.'
   when 'recogido' then 'El rider ha recogido tu pedido.'
   when 'en_ruta' then 'Tu pedido esta en camino.'
   when 'entregado' then 'Tu pedido figura como entregado.'
   when 'cancelado' then 'Tu pedido ha sido cancelado. Contacta con el restaurante.'
   else 'Hay novedades en tu pedido.'end;
  insert into private.ed_notification_queue(order_id,account_id,channel,destination,event_status,body)
  values(new.id,new.account_id,new.notification_channel,new.customer_phone,new.status,
    'ESTAMBUL DELIVERY: pedido #' || new.reference || '. ' || label)
  on conflict(order_id,channel,event_status) do nothing;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_customer_chat_history(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare oid uuid;
begin
 oid=private.ed_chat_link_order(p_token);
 if oid is null then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'role',m.sender_role,'body',m.body,'at',m.created_at)
  order by m.created_at),'[]'::jsonb)
 from (select * from public.ed_order_chat where order_id=oid order by created_at desc limit 50) m);
end $function$;

CREATE OR REPLACE FUNCTION public.ed_customer_chat_send(p_token text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare oid uuid; status_now text;
begin
 oid=private.ed_chat_link_order(p_token);
 if oid is null then raise exception 'Chat no disponible para este enlace';end if;
 select status into status_now from public.ed_orders where id=oid;
 if status_now='entregado' then raise exception 'Chat cerrado al entregar el pedido';end if;
 if p_body is null or length(btrim(p_body))<1 or length(p_body)>450 then raise exception 'Mensaje de 1 a 450 caracteres';end if;
 if (select count(*) from public.ed_order_chat m where m.order_id=oid and m.sender_role='customer'
  and m.created_at>now()-interval '1 minute')>=5 then raise exception 'Espera antes de enviar más mensajes';end if;
 insert into public.ed_order_chat(order_id,account_id,sender_role,body)
 select o.id,o.account_id,'customer',btrim(p_body) from public.ed_orders o where o.id=oid;
 return jsonb_build_object('ok',true);
end $function$;

CREATE OR REPLACE FUNCTION public.ed_rider_chat_send(p_order_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rec record;
begin
 select o.id,o.account_id into rec from public.ed_orders o where o.id=p_order_id
  and o.status in ('asignado','recogido','en_ruta')
  and private.ed_is_rider(o.account_id,o.rider_id);
 if rec.id is null then raise exception 'No tienes permiso para responder a este pedido';end if;
 if p_body is null or length(btrim(p_body))<1 or length(p_body)>450 then raise exception 'Mensaje de 1 a 450 caracteres';end if;
 if (select count(*) from public.ed_order_chat m where m.order_id=rec.id and m.sender_role='rider'
  and m.created_at>now()-interval '1 minute')>=8 then raise exception 'Espera antes de enviar más mensajes';end if;
 insert into public.ed_order_chat(order_id,account_id,sender_role,body)
 values(rec.id,rec.account_id,'rider',btrim(p_body));
 return jsonb_build_object('ok',true);
end $function$;

CREATE OR REPLACE FUNCTION public.ed_stop_rider_position()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 delete from public.ed_rider_positions p where exists(
  select 1 from public.ed_riders r where r.id=p.rider_id and r.user_id=(select auth.uid())
   and r.account_id=p.account_id and private.ed_is_rider(r.account_id,r.id));
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_update_rider_position(p_lat double precision, p_lng double precision, p_accuracy integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record;
begin
 if p_lat is null or p_lng is null or not (p_lat between -90 and 90) or not (p_lng between -180 and 180)
    or (p_accuracy is not null and not (p_accuracy between 0 and 3000)) then
   raise exception 'Coordenadas o precision no validas';
 end if;
 select r.id,r.account_id,r.online into v from public.ed_riders r
 where r.user_id=(select auth.uid()) and r.active and r.online and
    private.ed_is_rider(r.account_id,r.id)
 limit 1;
 if v.id is null then raise exception 'El Rider debe estar activo y online';end if;
 if not exists(select 1 from public.ed_orders o where o.rider_id=v.id and o.account_id=v.account_id and o.status in ('recogido','en_ruta')) then
    raise exception 'La ubicacion solo se comparte durante repartos en curso';
 end if;
 insert into public.ed_rider_positions(rider_id,account_id,latitude,longitude,accuracy_m,updated_at)
 values(v.id,v.account_id,p_lat,p_lng,p_accuracy,now())
 on conflict(rider_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
    accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at
 where public.ed_rider_positions.updated_at < now()-interval '10 seconds';
 return true;
end $function$;
revoke all on function public.ed_update_rider_position(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.ed_update_rider_position(double precision,double precision,integer) to authenticated;
revoke all on function public.ed_stop_rider_position() from public,anon,authenticated;
grant execute on function public.ed_stop_rider_position() to authenticated;
revoke all on function public.ed_customer_chat_history(text) from public,anon,authenticated;
grant execute on function public.ed_customer_chat_history(text) to anon,authenticated;
revoke all on function public.ed_customer_chat_send(text,text) from public,anon,authenticated;
grant execute on function public.ed_customer_chat_send(text,text) to anon,authenticated;
revoke all on function public.ed_rider_chat_send(uuid,text) from public,anon,authenticated;
grant execute on function public.ed_rider_chat_send(uuid,text) to authenticated;

revoke all on function private.ed_chat_link_order(text) from public,anon,authenticated;
drop trigger if exists ed_customer_notification_queue on public.ed_orders;
create trigger ed_customer_notification_queue after update of status on public.ed_orders
for each row execute function private.ed_queue_customer_notification();
commit;
