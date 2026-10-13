-- ESTAMBUL DELIVERY - service-role only Twilio dispatcher, staged until sender activation.
begin;
alter table private.ed_notification_queue drop constraint if exists ed_notification_queue_delivery_status_check;
alter table private.ed_notification_queue add constraint ed_notification_queue_delivery_status_check
 check(delivery_status in ('awaiting_provider','ready','sending','sent','failed','skipped'));
alter table private.ed_notification_queue
 add column if not exists last_error text,
 add column if not exists attempted_at timestamptz;

CREATE OR REPLACE FUNCTION public.ed_claim_notifications(p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Access denied'; end if;
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Limit invalid';end if;
 -- Discard stale events, withdrawn consent, numbers changed, or status superseded.
 update private.ed_notification_queue q set delivery_status='skipped',last_error='status, consent or phone no longer current'
 where delivery_status='awaiting_provider' and (
  queued_at<now()-interval '6 hours' or not exists(
   select 1 from public.ed_orders o where o.id=q.order_id and o.account_id=q.account_id
    and o.status=q.event_status and o.notifications_consent
    and o.notification_channel=q.channel and o.customer_phone=q.destination)
 );
 with selected as (
  select q.id from private.ed_notification_queue q join public.ed_orders o on o.id=q.order_id
  where q.delivery_status='awaiting_provider'
   and o.status=q.event_status and o.notifications_consent and o.notification_channel=q.channel
   and o.customer_phone=q.destination
   and q.queued_at>now()-interval '6 hours'
  order by q.queued_at asc for update of q skip locked limit p_limit
 ), claimed as (
  update private.ed_notification_queue q set delivery_status='sending',attempted_at=now()
  from selected where q.id=selected.id
  returning q.id,q.channel,q.destination,q.event_status,q.body,q.order_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',c.id,'channel',c.channel,'to',c.destination,'status',c.event_status,
   'body',c.body,'reference',o.reference)),'[]'::jsonb)
 into result from claimed c join public.ed_orders o on o.id=c.order_id;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.ed_finish_notification(p_id uuid, p_ok boolean, p_provider_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Access denied';end if;
 update private.ed_notification_queue set
  delivery_status=case when p_ok then 'sent' else 'failed' end,
  sent_at=case when p_ok then now() else null end,
  provider_message_id=left(p_provider_id,120),
  last_error=case when p_ok then null else left(coalesce(p_error,'provider error'),300) end
 where id=p_id and delivery_status='sending';
 return found;
end $function$;
revoke all on function public.ed_claim_notifications(integer),public.ed_finish_notification(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.ed_claim_notifications(integer),public.ed_finish_notification(uuid,boolean,text,text) to service_role;
commit;
