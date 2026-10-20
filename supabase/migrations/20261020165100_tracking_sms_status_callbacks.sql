-- Store provider delivery callbacks for the one tracking SMS per order.
-- Callback rows are private, keyed by Twilio SID, and safe for duplicate/out-of-order events.
begin;

alter table private.ed_tracking_sms_receipts
  add column if not exists delivery_status text not null default 'not_submitted',
  add column if not exists attempt_count smallint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table private.ed_tracking_sms_receipts
  drop constraint if exists ed_tracking_sms_receipts_delivery_status_check;
alter table private.ed_tracking_sms_receipts
  add constraint ed_tracking_sms_receipts_delivery_status_check
  check (delivery_status in (
    'not_submitted','provider_accepted','provider_rejected','unknown',
    'queued','sending','sent','delivered','undelivered','failed'
  ));
alter table private.ed_tracking_sms_receipts
  drop constraint if exists ed_tracking_sms_receipts_attempt_count_check;
alter table private.ed_tracking_sms_receipts
  add constraint ed_tracking_sms_receipts_attempt_count_check
  check (attempt_count between 1 and 2);

-- One receipt row is the durable at-most-once guard for each accepted order.
create unique index if not exists ed_tracking_sms_receipts_order_unique
  on private.ed_tracking_sms_receipts(order_id);
create unique index if not exists ed_tracking_sms_receipts_provider_sid_unique
  on private.ed_tracking_sms_receipts(provider_sid)
  where provider_sid is not null;

create table if not exists private.ed_tracking_sms_callback_buffer(
  provider_sid text primary key check(provider_sid ~ '^SM[0-9a-fA-F]{32}$'),
  delivery_status text not null check(delivery_status in ('queued','sending','sent','delivered','undelivered','failed')),
  provider_error text,
  received_at timestamptz not null default now()
);
revoke all on private.ed_tracking_sms_callback_buffer from public,anon,authenticated;

drop function if exists public.ed_log_tracking_sms(uuid,text,boolean,text,text);
create function public.ed_log_tracking_sms(
  p_order_id uuid,
  p_token text,
  p_success boolean,
  p_provider_sid text default null,
  p_error text default null,
  p_attempt_count integer default 1,
  p_delivery_status text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acct uuid;
  token_digest text;
  initial_status text;
  buffered_status text;
  changed integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role only';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid token';
  end if;
  if p_attempt_count is null or p_attempt_count not between 1 and 2 then
    raise exception 'Invalid attempt count';
  end if;
  if p_delivery_status is not null and p_delivery_status not in (
    'provider_accepted','provider_rejected','unknown'
  ) then raise exception 'Invalid delivery status'; end if;
  if p_provider_sid is not null and p_provider_sid !~ '^SM[0-9a-fA-F]{32}$' then
    raise exception 'Invalid provider SID';
  end if;

  token_digest=encode(extensions.digest(p_token,'sha256'),'hex');
  select t.account_id into acct
  from private.ed_public_tracking_tokens t
  where t.order_id=p_order_id and t.token_hash=token_digest
    and t.revoked_at is null and t.expires_at>now();
  if acct is null then raise exception 'Tracking link not authorized for order'; end if;

  select b.delivery_status into buffered_status
  from private.ed_tracking_sms_callback_buffer b
  where b.provider_sid=p_provider_sid;
  initial_status=coalesce(buffered_status,p_delivery_status,
    case when p_success then 'provider_accepted' else 'provider_rejected' end);

  insert into private.ed_tracking_sms_receipts(
    account_id,order_id,token_hash,result,provider_sid,provider_error,
    attempted_at,attempt_count,delivery_status,updated_at
  ) values(
    acct,p_order_id,token_digest,
    case when p_success then 'provider_accepted' else 'provider_rejected' end,
    p_provider_sid,left(p_error,200),now(),p_attempt_count,initial_status,now()
  )
  on conflict(order_id) do update set
    result=excluded.result,
    provider_sid=coalesce(excluded.provider_sid,private.ed_tracking_sms_receipts.provider_sid),
    provider_error=excluded.provider_error,
    attempted_at=excluded.attempted_at,
    attempt_count=greatest(private.ed_tracking_sms_receipts.attempt_count,excluded.attempt_count),
    delivery_status=case
      when private.ed_tracking_sms_receipts.delivery_status='delivered' then 'delivered'
      when initial_status='delivered' then 'delivered'
      when initial_status in ('failed','undelivered') then initial_status
      when private.ed_tracking_sms_receipts.delivery_status in ('failed','undelivered')
        then private.ed_tracking_sms_receipts.delivery_status
      when initial_status in ('sent','sending','queued') then initial_status
      else excluded.delivery_status
    end,
    updated_at=now()
  where private.ed_tracking_sms_receipts.token_hash=excluded.token_hash;

  get diagnostics changed = row_count;
  if changed=0 then
    raise exception 'A tracking SMS receipt already exists for another token';
  end if;
  if p_provider_sid is not null then
    delete from private.ed_tracking_sms_callback_buffer
    where provider_sid=p_provider_sid;
  end if;
  return true;
end
$function$;

revoke all on function public.ed_log_tracking_sms(uuid,text,boolean,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.ed_log_tracking_sms(uuid,text,boolean,text,text,integer,text)
  to service_role;

create or replace function public.ed_update_tracking_sms_status(
  p_provider_sid text,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized text=lower(coalesce(p_status,''));
  rank_new integer;
  affected integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Service role only';
  end if;
  if p_provider_sid is null or p_provider_sid !~ '^SM[0-9a-fA-F]{32}$' then
    raise exception 'Invalid provider SID';
  end if;
  if normalized not in ('queued','sending','sent','delivered','undelivered','failed') then
    raise exception 'Invalid provider status';
  end if;
  rank_new=case normalized
    when 'queued' then 1 when 'sending' then 2 when 'sent' then 3
    when 'undelivered' then 4 when 'failed' then 4 when 'delivered' then 5
  end;

  update private.ed_tracking_sms_receipts r set
    delivery_status=case
      when r.delivery_status='delivered' then 'delivered'
      when case r.delivery_status
        when 'queued' then 1 when 'sending' then 2 when 'sent' then 3
        when 'undelivered' then 4 when 'failed' then 4 when 'delivered' then 5
        else 0 end > rank_new then r.delivery_status
      else normalized
    end,
    provider_error=case when normalized in ('failed','undelivered')
      then left(p_error,200)
      when normalized='delivered' then null
      else r.provider_error end,
    updated_at=now()
  where r.provider_sid=p_provider_sid;
  get diagnostics affected=row_count;

  if affected=0 then
    insert into private.ed_tracking_sms_callback_buffer(provider_sid,delivery_status,provider_error,received_at)
    values(p_provider_sid,normalized,left(p_error,200),now())
    on conflict(provider_sid) do update set
      delivery_status=case
        when private.ed_tracking_sms_callback_buffer.delivery_status='delivered' then 'delivered'
        when case private.ed_tracking_sms_callback_buffer.delivery_status
          when 'queued' then 1 when 'sending' then 2 when 'sent' then 3
          when 'undelivered' then 4 when 'failed' then 4 when 'delivered' then 5
        end > rank_new then private.ed_tracking_sms_callback_buffer.delivery_status
        else excluded.delivery_status
      end,
      provider_error=coalesce(excluded.provider_error,private.ed_tracking_sms_callback_buffer.provider_error),
      received_at=now();
  end if;

  delete from private.ed_tracking_sms_callback_buffer
  where received_at<now()-interval '7 days';
  return true;
end
$function$;

revoke all on function public.ed_update_tracking_sms_status(text,text,text)
  from public,anon,authenticated;
grant execute on function public.ed_update_tracking_sms_status(text,text,text)
  to service_role;

commit;
