-- ESTAMBUL DELIVERY — admin-only email authorization for five Rider profiles.
-- Rider confirms their own email by sign-up. No passwords or Last.app mutations.
create or replace function public.ed_admin_authorize_rider_email(p_rider_number integer,p_email text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
 v_accounts uuid[];
 v_account uuid;
 v_rider uuid;
 v_user uuid;
 v_active boolean;
 v_email text;
 v_invite uuid;
 v_matches integer;
begin
 if (select auth.uid()) is null then
   raise exception 'Debes iniciar sesión como administrador.';
 end if;
 if p_rider_number is null or p_rider_number not between 1 and 5 then
   raise exception 'Solo están permitidos Rider 1 a Rider 5.';
 end if;
 v_email:=lower(btrim(coalesce(p_email,'')));
 if length(v_email)>254 or v_email !~ '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$' then
   raise exception 'Introduce un correo electrónico de Rider válido.';
 end if;
 select array_agg(distinct m.account_id) into v_accounts
 from public.ed_members m
 where m.user_id=(select auth.uid()) and m.role='admin' and m.active;
 if coalesce(array_length(v_accounts,1),0)<>1 then
   raise exception 'Acceso no autorizado o cuenta administrativa ambigua.';
 end if;
 v_account:=v_accounts[1];
 select count(*) into v_matches from public.ed_riders r
 where r.account_id=v_account
   and lower(regexp_replace(r.display_name,'[ _-]','','g'))='rider'||p_rider_number::text;
 if v_matches<>1 then
   raise exception 'No hay exactamente un perfil Rider para ese número.';
 end if;
 select r.id,r.user_id,r.active into v_rider,v_user,v_active
 from public.ed_riders r
 where r.account_id=v_account
   and lower(regexp_replace(r.display_name,'[ _-]','','g'))='rider'||p_rider_number::text
 for update;
 if v_user is not null or v_active then
   raise exception 'Este Rider ya está vinculado o activado.';
 end if;
 if exists(select 1 from public.ed_members m
     join auth.users u on u.id=m.user_id
     where m.active and m.role<>'rider' and lower(btrim(u.email))=v_email)
 then
   raise exception 'Ese correo ya está vinculado a otra función.';
 end if;
 if exists(select 1 from private.ed_rider_invitations i
   where i.email=v_email and (i.rider_id<>v_rider or i.account_id<>v_account))
 then
   raise exception 'Ese correo ya está autorizado para otro Rider.';
 end if;
 insert into private.ed_rider_invitations(account_id,rider_id,email)
 values(v_account,v_rider,v_email)
 on conflict(account_id,rider_id) do update
 set email=excluded.email
 where private.ed_rider_invitations.claimed_by is null
   and private.ed_rider_invitations.invitation_sent_at is null
 returning id into v_invite;
 if v_invite is null then
   raise exception 'Esta invitación ya fue enviada o reclamada.';
 end if;
 return jsonb_build_object('saved',true,'rider_number',p_rider_number);
end
$fn$;
revoke all on function public.ed_admin_authorize_rider_email(integer,text) from public,anon,authenticated;
grant execute on function public.ed_admin_authorize_rider_email(integer,text) to authenticated;
