-- Rider acceptance triggers Edge Function for SMS; private receipt records contain only hashes.
-- No secret key, SMS body, phone or raw tracking token is persisted here.
begin;
create table if not exists private.ed_tracking_sms_receipts(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.ed_accounts(id) on delete cascade,
 order_id uuid not null references public.ed_orders(id) on delete cascade,
 token_hash text not null unique check(length(token_hash)=64),
 result text not null check(result in ('provider_accepted','provider_rejected')),
 provider_sid text,
 provider_error text,
 attempted_at timestamptz not null default now()
);
revoke all on private.ed_tracking_sms_receipts from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ed_log_tracking_sms(p_order_id uuid, p_token text, p_success boolean, p_provider_sid text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare acct uuid;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role only';end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token';end if;
 select t.account_id into acct from private.ed_public_tracking_tokens t
 where t.order_id=p_order_id and t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
   and t.revoked_at is null and t.expires_at>now();
 if acct is null then raise exception 'Tracking link not authorized for order';end if;
 insert into private.ed_tracking_sms_receipts(account_id,order_id,token_hash,result,provider_sid,provider_error)
 values(acct,p_order_id,encode(extensions.digest(p_token,'sha256'),'hex'),
  case when p_success then 'provider_accepted' else 'provider_rejected' end,
  left(p_provider_sid,110),left(p_error,200))
 on conflict(token_hash) do nothing;
 return true;
end $function$;

revoke all on function public.ed_log_tracking_sms(uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.ed_log_tracking_sms(uuid,text,boolean,text,text) to service_role;
commit;
