-- Customer tracking link can show an explicitly opted-in Rider work phone during active assignments only.
-- Manual WhatsApp share is implemented in admin JavaScript, not inside a server trigger.
begin;
alter table public.ed_riders add column if not exists customer_call_enabled boolean not null default false;
comment on column public.ed_riders.customer_call_enabled is
 'Staff authorizes publishing the Rider work phone in guest tracking only while the assignment is active';
CREATE OR REPLACE FUNCTION private.ed_guard_rider_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare verified_invite boolean := false;
begin
 if new.id is distinct from old.id or new.account_id is distinct from old.account_id then
  raise exception 'Identity fields immutable';
 end if;
 if private.ed_is_staff(old.account_id) then return new; end if;
 if private.ed_is_rider(old.account_id,old.id) then
  if new.user_id is distinct from old.user_id
    or new.external_rider_id is distinct from old.external_rider_id
    or new.display_name is distinct from old.display_name
    or new.phone is distinct from old.phone
    or new.customer_call_enabled is distinct from old.customer_call_enabled
    or new.active is distinct from old.active
  then raise exception 'Riders may change only their online status'; end if;
  return new;
 end if;
 select exists(
  select 1 from private.ed_rider_invitations i
  join auth.users u on lower(btrim(u.email))=i.email
  where i.rider_id=old.id and i.account_id=old.account_id
   and u.id=(select auth.uid()) and u.email_confirmed_at is not null
   and (i.claimed_by is null or i.claimed_by=u.id)
 ) into verified_invite;
 if not verified_invite or old.user_id is not null or old.active
  or new.user_id is distinct from (select auth.uid()) or not new.active
  or new.online is distinct from old.online
  or new.external_rider_id is distinct from old.external_rider_id
  or new.display_name is distinct from old.display_name
  or new.phone is distinct from old.phone
  or new.customer_call_enabled is distinct from old.customer_call_enabled
 then raise exception 'Not authorized to activate this rider'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_public_track(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v record;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null;end if;
 select o.id,o.reference,o.status,o.created_at,o.updated_at,
  coalesce(b.display_name,acct.name) as brand,
  coalesce(b.primary_color,'#14263b') as primary_color,
  b.logo_url,b.google_review_url,
  case
   when o.status in ('asignado','recogido','en_ruta') and r.active
    and r.customer_call_enabled and r.phone ~ '^[+][1-9][0-9]{7,14}$'
   then r.phone else null
  end as call_phone,
  exists(select 1 from public.ed_customer_feedback f where f.order_id=o.id) as has_feedback
 into v
 from private.ed_public_tracking_tokens tok
 join public.ed_orders o on o.id=tok.order_id and o.account_id=tok.account_id
 join public.ed_accounts acct on acct.id=tok.account_id
 left join public.ed_brand_settings b on b.account_id=tok.account_id
 left join public.ed_riders r on r.id=o.rider_id and r.account_id=o.account_id
 where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and tok.revoked_at is null and tok.expires_at>now();
 if v.id is null then return null;end if;
 return jsonb_build_object(
 'reference',v.reference,'status',v.status,'updated_at',v.updated_at,
 'brand',v.brand,'color',v.primary_color,'logo_url',v.logo_url,
 'rider_call_phone',v.call_phone,
 'review_url',case when v.status='entregado' then v.google_review_url else null end,
 'can_feedback',v.status='entregado' and not v.has_feedback,'feedback_sent',v.has_feedback
 );
end $function$;
revoke all on function public.ed_public_track(text) from public;
grant execute on function public.ed_public_track(text) to anon,authenticated;
commit;
