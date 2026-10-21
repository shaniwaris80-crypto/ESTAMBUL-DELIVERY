-- Estambul Delivery: staff-only, read-only health for signed Last.app webhooks.
-- No personal order fields or credentials are returned.
create or replace function public.ed_staff_last_health()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $fn$
declare
  v_account uuid;
  v_authorized integer:=0;
  v_events integer:=0;
  v_processed integer:=0;
  v_failed integer:=0;
  v_latest timestamptz;
begin
  select m.account_id into v_account
    from public.ed_members m
    where m.user_id=(select auth.uid())
      and m.active and m.role in ('admin','dispatcher')
    order by m.account_id limit 1;
  if v_account is null then raise exception 'Access denied';end if;
  select count(*) into v_authorized from private.ed_last_locations l
    where l.account_id=v_account and l.enabled;
  select count(*),
         count(*) filter(where e.processed_at is not null and e.processing_error is null),
         count(*) filter(where e.processing_error is not null),
         max(e.received_at)
    into v_events,v_processed,v_failed,v_latest
  from private.ed_last_webhook_events e
    join private.ed_last_locations l on l.location_id=e.location_id
  where l.account_id=v_account and l.enabled
    and e.received_at>l.updated_at;
  return jsonb_build_object(
    'approved_locations',v_authorized,
    'new_events',v_events,
    'processed_events',v_processed,
    'failed_events',v_failed,
    'last_event_at',v_latest);
end;
$fn$;
revoke all on function public.ed_staff_last_health() from public,anon,authenticated;
grant execute on function public.ed_staff_last_health() to authenticated;
