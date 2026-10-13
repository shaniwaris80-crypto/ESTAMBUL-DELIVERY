-- ESTAMBUL DELIVERY — invitations without individual emails in GitHub.
-- Email invitations are provisioned privately in Supabase, never in this repository.
create table if not exists private.ed_rider_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ed_accounts(id) on delete cascade,
  rider_id uuid not null,
  email text not null unique check(email=lower(btrim(email))),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ed_invitation_rider_account foreign key(rider_id,account_id) references public.ed_riders(id,account_id),
  unique(account_id,rider_id)
);
revoke all on private.ed_rider_invitations from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ed_activate_rider()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  verified_email text;
  invited_account uuid;
  invited_rider uuid;
  claimed_user uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para activar Rider.';
  end if;
  select lower(btrim(u.email)) into verified_email
  from auth.users u
  where u.id=(select auth.uid()) and u.email_confirmed_at is not null;

  if verified_email is null then
    raise exception 'Primero debes confirmar tu correo electrónico.';
  end if;

  select i.account_id,i.rider_id,i.claimed_by
  into invited_account,invited_rider,claimed_user
  from private.ed_rider_invitations i
  where i.email=verified_email
  for update;

  if invited_rider is null then
    raise exception 'El correo no tiene una invitación de repartidor.';
  end if;
  if claimed_user is not null and claimed_user<>(select auth.uid()) then
    raise exception 'Esta invitación ya está utilizada.';
  end if;
  if not exists (
    select 1 from public.ed_riders r
    where r.id=invited_rider and r.account_id=invited_account
      and (r.user_id is null or r.user_id=(select auth.uid()))
  ) then
    raise exception 'Este repartidor ya está vinculado a otro usuario.';
  end if;

  if exists (
    select 1 from public.ed_members m
    where m.account_id=invited_account and m.user_id=(select auth.uid())
      and m.role <> 'rider'
  ) then
    raise exception 'Esta cuenta ya tiene otro rol.';
  end if;

  update public.ed_riders r set user_id=(select auth.uid()),active=true
  where r.id=invited_rider and r.account_id=invited_account;

  insert into public.ed_members(account_id,user_id,role,active)
  values (invited_account,(select auth.uid()),'rider',true)
  on conflict(account_id,user_id)
  do update set active=true where public.ed_members.role='rider';

  update private.ed_rider_invitations i
  set claimed_by=coalesce(i.claimed_by,(select auth.uid())),
      claimed_at=coalesce(i.claimed_at,now())
  where i.rider_id=invited_rider and i.account_id=invited_account;

  return invited_rider;
end;
$function$;

CREATE OR REPLACE FUNCTION private.ed_guard_rider_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  verified_invite boolean := false;
begin
 if new.id is distinct from old.id or new.account_id is distinct from old.account_id then
  raise exception 'Identity fields immutable';
 end if;
 if private.ed_is_staff(old.account_id) then
  return new;
 end if;
 if private.ed_is_rider(old.account_id,old.id) then
  if new.user_id is distinct from old.user_id
    or new.external_rider_id is distinct from old.external_rider_id
    or new.display_name is distinct from old.display_name
    or new.phone is distinct from old.phone
    or new.active is distinct from old.active
  then raise exception 'Riders may change only their online status'; end if;
  return new;
 end if;

 -- Initial activation may be performed only by a verified invited rider,
 -- and may change only user_id and active. Other edits remain prohibited.
 select exists (
  select 1 from private.ed_rider_invitations i
   join auth.users u on lower(btrim(u.email))=i.email
  where i.rider_id=old.id and i.account_id=old.account_id
   and u.id=(select auth.uid()) and u.email_confirmed_at is not null
   and (i.claimed_by is null or i.claimed_by=u.id)
 ) into verified_invite;

 if not verified_invite
   or old.user_id is not null
   or old.active
   or new.user_id is distinct from (select auth.uid())
   or not new.active
   or new.online is distinct from old.online
   or new.external_rider_id is distinct from old.external_rider_id
   or new.display_name is distinct from old.display_name
   or new.phone is distinct from old.phone
 then
  raise exception 'Not authorized to activate this rider';
 end if;
 return new;
end $function$;

revoke all on function public.ed_activate_rider() from public,anon;
grant execute on function public.ed_activate_rider() to authenticated;
