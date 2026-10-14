-- Secure append-only Last.app v2 webhook inbox. Events are not processed until the
-- integration token and reviewed synchronization worker are configured.
begin;
create table if not exists private.ed_last_webhook_events (
 event_id text primary key check (char_length(event_id) between 1 and 128),
 event_type text not null check (char_length(event_type) between 2 and 100),
 location_id text,
 organization_id text,
 event_created_at text,
 data jsonb not null,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 processing_error text
);
create index if not exists ed_last_webhook_events_pending_idx
 on private.ed_last_webhook_events (received_at) where processed_at is null;
revoke all on private.ed_last_webhook_events from public, anon, authenticated;
create or replace function public.ed_receive_last_webhook(
 p_event_id text,
 p_event_type text,
 p_location_id text,
 p_organization_id text,
 p_event_created_at text,
 p_data jsonb
) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_event_id is null or char_length(p_event_id) not between 1 and 128
    or p_event_type is null or char_length(p_event_type) not between 2 and 100
    or p_data is null then
  raise exception 'Invalid Last webhook event';
 end if;
 insert into private.ed_last_webhook_events (
  event_id,event_type,location_id,organization_id,event_created_at,data
 ) values (
  p_event_id,p_event_type,p_location_id,p_organization_id,p_event_created_at,p_data
 ) on conflict (event_id) do nothing;
 return true;
end $$;
revoke all on function public.ed_receive_last_webhook(text,text,text,text,text,jsonb)
 from public, anon, authenticated;
grant execute on function public.ed_receive_last_webhook(text,text,text,text,text,jsonb)
 to service_role;
commit;
