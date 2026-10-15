-- Single-SMS policy: safely close claimed secondary SMS jobs without pretending to send.
-- Apply to staging first. No existing messages are updated by this migration.
create or replace function public.ed_skip_secondary_sms(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
 if (select auth.role()) is distinct from 'service_role' then
  raise exception 'Access denied';
 end if;
 update private.ed_notification_queue
 set delivery_status='skipped_policy',
     sent_at=null,
     provider_message_id=null,
     last_error='Secondary SMS intentionally disabled: tracking link sent at acceptance'
 where id=p_id and channel='sms' and delivery_status='sending';
 return found;
end;
$$;
revoke all on function public.ed_skip_secondary_sms(uuid) from public, anon, authenticated;
grant execute on function public.ed_skip_secondary_sms(uuid) to service_role;
