-- Rider acceptance creates one private customer tracking link.
-- The Edge Function sends at most one SMS after this first successful claim.
-- Calls are serialized per order so concurrent taps cannot mint duplicate links.
begin;

create or replace function public.ed_rider_accept_tracking(
 p_order_id uuid,
 p_resend boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
 o public.ed_orders%rowtype;
 t text;
begin
 if (select auth.uid()) is null then
  raise exception 'Inicia sesión como Rider';
 end if;

 select * into o
 from public.ed_orders
 where id=p_order_id
 for update;

 if not found or not private.ed_is_rider(o.account_id,o.rider_id) then
  raise exception 'Pedido no asignado a este Rider';
 end if;

 -- Retries and concurrent taps must not issue another token or another SMS.
 if o.accepted_at is not null then
  return jsonb_build_object(
   'accepted',true,
   'already_accepted',true,
   'link_created',false,
   'token',null
  );
 end if;

 if o.status <> 'asignado' then
  raise exception 'Solo se puede aceptar un pedido asignado';
 end if;

 if exists (
  select 1 from public.ed_customer_feedback f where f.order_id=o.id
 ) then
  raise exception 'No se puede emitir un enlace nuevo para un pedido ya valorado';
 end if;

 update public.ed_orders
 set accepted_at=clock_timestamp()
 where id=o.id;

 t=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.ed_public_tracking_tokens(
  account_id,order_id,token_hash,expires_at,issued_by
 ) values(
  o.account_id,o.id,encode(extensions.digest(t,'sha256'),'hex'),
  now()+interval '21 days',(select auth.uid())
 )
 on conflict(order_id) do update
 set token_hash=excluded.token_hash,
     expires_at=excluded.expires_at,
     issued_by=excluded.issued_by,
     created_at=now(),
     revoked_at=null;

 return jsonb_build_object(
  'accepted',true,
  'already_accepted',false,
  'link_created',true,
  'token',t
 );
end
$function$;

revoke all on function public.ed_rider_accept_tracking(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.ed_rider_accept_tracking(uuid,boolean)
 to authenticated,service_role;

commit;
