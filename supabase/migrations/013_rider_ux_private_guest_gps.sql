-- ESTAMBUL DELIVERY / rider UX: archived settlements and explicit per-order guest GPS
-- Non-destructive: keeps orders, closure snapshots and accounting history intact.
begin;

create table if not exists public.ed_order_location_shares(
  order_id uuid primary key references public.ed_orders(id) on delete cascade,
  enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
alter table public.ed_order_location_shares enable row level security;
revoke all on public.ed_order_location_shares from public,anon,authenticated;
grant select on public.ed_order_location_shares to authenticated;
drop policy if exists ed_location_shares_assigned_or_staff on public.ed_order_location_shares;
create policy ed_location_shares_assigned_or_staff on public.ed_order_location_shares
 for select to authenticated using (
   exists (
    select 1 from public.ed_orders o
    where o.id=order_id
      and (private.ed_is_staff(o.account_id)
           or (o.rider_id is not null and private.ed_is_rider(o.account_id,o.rider_id)))
   )
 );

create or replace function public.ed_set_customer_location_share(p_order_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare o record; assigned_rider boolean; staff boolean;
begin
 if p_enabled is null then raise exception 'Debes indicar activar o desactivar';end if;
 select ord.id,ord.account_id,ord.rider_id,ord.status,r.online,r.active
 into o from public.ed_orders ord
 left join public.ed_riders r on r.id=ord.rider_id and r.account_id=ord.account_id
 where ord.id=p_order_id for update of ord;
 if o.id is null then raise exception 'Pedido no encontrado';end if;
 assigned_rider=o.rider_id is not null and private.ed_is_rider(o.account_id,o.rider_id);
 staff=private.ed_is_staff(o.account_id);
 -- Only the rider can opt in to showing their own location. Staff can turn it off.
 if p_enabled and not assigned_rider then raise exception 'Solo el rider asignado puede activar el mapa público';end if;
 if not p_enabled and not (assigned_rider or staff) then raise exception 'Acceso no autorizado';end if;
 if p_enabled and (o.status not in ('recogido','en_ruta') or o.online is distinct from true or o.active is distinct from true)
 then raise exception 'Activa el mapa únicamente durante un reparto en curso';end if;
 insert into public.ed_order_location_shares(order_id,enabled,changed_at,changed_by)
 values(o.id,p_enabled,clock_timestamp(),(select auth.uid()))
 on conflict(order_id) do update set enabled=excluded.enabled,
  changed_at=excluded.changed_at,changed_by=excluded.changed_by;
 return p_enabled;
end $function$;

-- Show only unsettled deliveries in the Rider app, never delete the accounting records.
create or replace function public.ed_rider_unclosed_completed_ids()
returns uuid[] language sql stable security definer set search_path to ''
as $function$
 select coalesce(array_agg(o.id),'{}'::uuid[])
 from public.ed_orders o
 join public.ed_riders r on r.id=o.rider_id and r.account_id=o.account_id
 join public.ed_members m on m.account_id=r.account_id and m.user_id=r.user_id
  and m.active and m.role='rider'
 where r.user_id=(select auth.uid()) and r.active and o.status='entregado'
  and not exists (select 1 from public.ed_shift_closure_items item where item.order_id=o.id);
$function$;

-- Guest token is required; only active, deliberately shared and recent GPS can be returned.
create or replace function public.ed_public_track(p_token text)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v record;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null;end if;
 select o.id,o.reference,o.status,o.created_at,o.updated_at,
  coalesce(b.display_name,acct.name) as brand,
  coalesce(b.primary_color,'#14263b') as primary_color,
  b.logo_url,b.google_review_url,
  case when o.status in ('asignado','recogido','en_ruta') and r.active
    and r.customer_call_enabled and r.phone ~ '^[+][1-9][0-9]{7,14}$'
   then r.phone else null end as call_phone,
  case when o.status='en_ruta' and r.active and r.online and s.enabled
    and p.updated_at > now() - interval '45 seconds'
   then jsonb_build_object('lat',p.latitude,'lng',p.longitude,
                         'accuracy_m',p.accuracy_m,'updated_at',p.updated_at)
   else null end as live_location,
  exists(select 1 from public.ed_customer_feedback f where f.order_id=o.id) as has_feedback
 into v
 from private.ed_public_tracking_tokens tok
 join public.ed_orders o on o.id=tok.order_id and o.account_id=tok.account_id
 join public.ed_accounts acct on acct.id=tok.account_id
 left join public.ed_brand_settings b on b.account_id=tok.account_id
 left join public.ed_riders r on r.id=o.rider_id and r.account_id=o.account_id
 left join public.ed_order_location_shares s on s.order_id=o.id
 left join public.ed_rider_positions p on p.rider_id=o.rider_id and p.account_id=o.account_id
 where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and tok.revoked_at is null and tok.expires_at>now();
 if v.id is null then return null;end if;
 return jsonb_build_object(
  'reference',v.reference,'status',v.status,'updated_at',v.updated_at,
  'brand',v.brand,'color',v.primary_color,'logo_url',v.logo_url,
  'rider_call_phone',v.call_phone,
  'live_location',v.live_location,
  'review_url',case when v.status='entregado' then v.google_review_url else null end,
  'can_feedback',v.status='entregado' and not v.has_feedback,'feedback_sent',v.has_feedback
 );
end $function$;

-- Dispatcher visibility mirrors closed financial snapshots even after hundreds of shifts.
create or replace function public.ed_staff_archived_order_ids(p_order_ids uuid[])
returns uuid[] language sql stable security definer set search_path to ''
as $function$
 select coalesce(array_agg(distinct i.order_id),'{}'::uuid[])
 from public.ed_shift_closure_items i
 join public.ed_shift_closures c on c.id=i.close_id
 join public.ed_orders o on o.id=i.order_id and o.account_id=c.account_id
 where i.order_id=any(coalesce(p_order_ids,'{}'::uuid[]))
   and private.ed_is_staff(c.account_id);
$function$;

revoke all on function public.ed_set_customer_location_share(uuid,boolean),
 public.ed_rider_unclosed_completed_ids(),public.ed_staff_archived_order_ids(uuid[]),
 public.ed_public_track(text) from public,anon;
grant execute on function public.ed_set_customer_location_share(uuid,boolean),
 public.ed_rider_unclosed_completed_ids(),public.ed_staff_archived_order_ids(uuid[]) to authenticated;
grant execute on function public.ed_public_track(text) to anon,authenticated;
commit;
