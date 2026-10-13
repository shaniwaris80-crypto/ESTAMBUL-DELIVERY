-- ESTAMBUL DELIVERY customer tracking and guest feedback MVP.
-- Each tracking link is a 256-bit bearer token; database stores SHA-256 hash only.
-- No SMS, WhatsApp, or promotional messages are sent.
begin;
create table if not exists public.ed_brand_settings(
 account_id uuid primary key references public.ed_accounts(id) on delete cascade,
 display_name text not null check(length(display_name) between 2 and 80),
 primary_color text not null default '#14263b' check(primary_color ~ '^#[0-9A-Fa-f]{6}$'),
 logo_url text check(logo_url is null or (length(logo_url)<=500 and logo_url ~ '^https://')),
 google_review_url text check(google_review_url is null or
  (length(google_review_url)<=500 and google_review_url ~ '^https://(www[.])?(google[.]com|google[.]es|google[.]co[.]uk|g[.]page|maps[.]app[.]goo[.]gl)/')),
 updated_at timestamptz not null default now()
);
insert into public.ed_brand_settings(account_id,display_name)
 select id,name from public.ed_accounts on conflict(account_id) do nothing;
alter table public.ed_brand_settings enable row level security;
revoke all on public.ed_brand_settings from public,anon,authenticated;
grant select,insert,update on public.ed_brand_settings to authenticated;
drop policy if exists ed_brand_staff on public.ed_brand_settings;
create policy ed_brand_staff on public.ed_brand_settings for all to authenticated
using(private.ed_is_staff(account_id)) with check(private.ed_is_staff(account_id));

create table if not exists private.ed_public_tracking_tokens(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 order_id uuid not null unique references public.ed_orders(id) on delete cascade,
 token_hash text not null unique check(length(token_hash)=64),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 issued_by uuid not null references auth.users(id),
 revoked_at timestamptz
);
revoke all on private.ed_public_tracking_tokens from public,anon,authenticated;

create table if not exists public.ed_customer_feedback(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 order_id uuid not null unique references public.ed_orders(id) on delete cascade,
 tracking_id uuid not null unique references private.ed_public_tracking_tokens(id) on delete cascade,
 rating integer not null check(rating between 1 and 5),
 comment text not null default '' check(length(comment)<=600),
 created_at timestamptz not null default now(),
 followup_status text not null default 'pending' check(followup_status in ('pending','contacted','resolved'))
);
alter table public.ed_customer_feedback enable row level security;
revoke all on public.ed_customer_feedback from public,anon,authenticated;
grant select,update(followup_status) on public.ed_customer_feedback to authenticated;
drop policy if exists ed_feedback_staff_read on public.ed_customer_feedback;
create policy ed_feedback_staff_read on public.ed_customer_feedback for select to authenticated
using(private.ed_is_staff(account_id));
drop policy if exists ed_feedback_staff_update on public.ed_customer_feedback;
create policy ed_feedback_staff_update on public.ed_customer_feedback for update to authenticated
using(private.ed_is_staff(account_id)) with check(private.ed_is_staff(account_id));

CREATE OR REPLACE FUNCTION public.ed_issue_tracking_token(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 acct uuid; t text;
begin
 select o.account_id into acct from public.ed_orders o where o.id=p_order_id;
 if acct is null or not private.ed_is_staff(acct) then
   raise exception 'Acceso denegado para compartir seguimiento';
 end if;
 -- Reusing an existing link must NOT erase existing feedback.
 -- Preserve the old link unless a staff member explicitly starts a new link
 -- for an order still awaiting a rating.
 if exists(select 1 from public.ed_customer_feedback f where f.order_id=p_order_id) then
   raise exception 'Este pedido ya tiene valoración; no se puede renovar el enlace';
 end if;
 t=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.ed_public_tracking_tokens(account_id,order_id,token_hash,expires_at,issued_by)
 values(acct,p_order_id,encode(extensions.digest(t,'sha256'),'hex'),now()+interval '21 days',(select auth.uid()))
 on conflict(order_id) do update
 set token_hash=excluded.token_hash,
     expires_at=excluded.expires_at,
     issued_by=excluded.issued_by,
     created_at=now(),revoked_at=null;
 return t;
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
 select o.id,o.reference,o.status,o.created_at,o.updated_at,acct.name as account_name,
    coalesce(b.display_name,acct.name) as brand,
    coalesce(b.primary_color,'#14263b') as primary_color,
    b.logo_url,b.google_review_url,
    exists(select 1 from public.ed_customer_feedback f where f.order_id=o.id) as has_feedback
 into v
 from private.ed_public_tracking_tokens tok
 join public.ed_orders o on o.id=tok.order_id and o.account_id=tok.account_id
 join public.ed_accounts acct on acct.id=tok.account_id
 left join public.ed_brand_settings b on b.account_id=tok.account_id
 where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and tok.revoked_at is null and tok.expires_at>now();
 if v.id is null then return null;end if;
 return jsonb_build_object(
  'reference',v.reference,'status',v.status,'updated_at',v.updated_at,
  'brand',v.brand,'color',v.primary_color,'logo_url',v.logo_url,
  'review_url',case when v.status='entregado' then v.google_review_url else null end,
  'can_feedback',v.status='entregado' and not v.has_feedback,'feedback_sent',v.has_feedback
 );
end $function$;

CREATE OR REPLACE FUNCTION public.ed_submit_feedback(p_token text, p_rating integer, p_comment text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 order_data record;
begin
 if p_rating is null or p_rating not between 1 and 5 then raise exception 'Puntuación entre 1 y 5';end if;
 if length(coalesce(p_comment,''))>600 then raise exception 'Máximo 600 caracteres';end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Enlace no válido';end if;
 select tok.id as link_id,tok.account_id,tok.order_id,o.status
 into order_data
 from private.ed_public_tracking_tokens tok join public.ed_orders o on o.id=tok.order_id
 where tok.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and tok.revoked_at is null and tok.expires_at>now()
 for update of tok;
 if order_data.link_id is null then raise exception 'Enlace caducado o inválido';end if;
 if order_data.status<>'entregado' then raise exception 'Puedes valorar cuando esté entregado';end if;
 insert into public.ed_customer_feedback(account_id,order_id,tracking_id,rating,comment)
 values(order_data.account_id,order_data.order_id,order_data.link_id,p_rating,btrim(coalesce(p_comment,'')));
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'Este pedido ya fue valorado';
end $function$;

revoke all on function public.ed_issue_tracking_token(uuid) from public,anon;
grant execute on function public.ed_issue_tracking_token(uuid) to authenticated;
revoke all on function public.ed_public_track(text),public.ed_submit_feedback(text,integer,text) from public;
grant execute on function public.ed_public_track(text),public.ed_submit_feedback(text,integer,text) to anon,authenticated;
commit;
