-- Correct Last.app payment preference mapping and private Rider payment confirmation.
-- Add a one-order SMS claim; sender authentication stays in Edge Function.
-- No customer SMS sent by this migration, no retrospective order classification.
BEGIN;
DO $patch$
DECLARE src text; def text;
BEGIN
 src := pg_get_functiondef('public.ed_last_import_tab(text,text,jsonb)'::regprocedure);
 IF strpos(src,' lat double precision; lng double precision; source text; status text;')=0 THEN RAISE EXCEPTION 'Missing import_decl expected signature'; END IF;
 src := replace(src,' lat double precision; lng double precision; source text; status text;',' lat double precision; lng double precision; source text; status text;
 bill_method_min text; bill_method_max text;');
 IF strpos(src,'or source in ('''',''manual'',''tpv''))')=0 THEN RAISE EXCEPTION 'Missing merchant_own expected signature'; END IF;
 src := replace(src,'or source in ('''',''manual'',''tpv''))','or source in ('''',''manual'',''tpv'',''owndelivery'',''restaurant''))');
 IF strpos(src,' method=lower(coalesce(p_tab->>''preferredPaymentMethod'',''''));')=0 THEN RAISE EXCEPTION 'Missing bill_payment expected signature'; END IF;
 src := replace(src,' method=lower(coalesce(p_tab->>''preferredPaymentMethod'',''''));',' method=lower(coalesce(p_tab->>''preferredPaymentMethod'',''''));
 -- Last.app v2 puts preferredPaymentMethod inside bills, not at tab root.
 -- This is a suggested collection method, confirmed by the Rider on delivery.
 if method='''' and jsonb_typeof(p_tab->''bills'')=''array'' then
   select min(lower(b->>''preferredPaymentMethod'')),
          max(lower(b->>''preferredPaymentMethod''))
     into bill_method_min,bill_method_max
   from jsonb_array_elements(p_tab->''bills'') b
   where coalesce(b->>''deleted'',''false'')<>''true''
     and lower(coalesce(b->>''preferredPaymentMethod'','''')) in (''cash'',''card'',''efectivo'',''tarjeta'');
   if bill_method_min is not distinct from null
      or bill_method_min is distinct from bill_method_max then
      method='''';
   else
      method=bill_method_min;
   end if;
 end if;');
 IF strpos(src,'   payment_method=v_method,')=0 THEN RAISE EXCEPTION 'Missing payment_updates expected signature'; END IF;
 src := replace(src,'   payment_method=v_method,','   payment_method=case when existing.status in (''recogido'',''en_ruta'') and existing.payment_method is not null then existing.payment_method else coalesce(v_method,existing.payment_method) end,');
 EXECUTE src;
 def := pg_get_functiondef('private.ed_guard_order_update()'::regprocedure);
 IF strpos(def,'or new.payment_method is distinct from old.payment_method')=0 OR strpos(def,'  if new.accepted_at is distinct from old.accepted_at then')=0 THEN
   RAISE EXCEPTION 'Order guard signature mismatch';
 END IF;
 def := replace(def,'or new.payment_method is distinct from old.payment_method','or (new.payment_method is distinct from old.payment_method
      and not (old.status=''en_ruta'' and new.status=''entregado''
        and new.payment_method in (''efectivo'',''tarjeta'')))');
 def := replace(def,'  if new.accepted_at is distinct from old.accepted_at then','  -- The assigned rider confirms the method actually collected at delivery.
  if old.status=''en_ruta'' and new.status=''entregado''
    and coalesce(new.payment_method,'''') not in (''efectivo'',''tarjeta'') then
    raise exception ''Confirma efectivo o tarjeta antes de entregar'';
  end if;
  if new.accepted_at is distinct from old.accepted_at then');
 EXECUTE def;
END $patch$;
CREATE OR REPLACE FUNCTION public.ed_claim_order_notifications(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE result jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order id required'; END IF;
  UPDATE private.ed_notification_queue q SET delivery_status='skipped',
    last_error='status, consent, phone or timeout no longer current'
  WHERE q.order_id=p_order_id AND q.delivery_status='awaiting_provider'
    AND (q.queued_at < now()-interval '6 hours'
      OR NOT EXISTS (SELECT 1 FROM public.ed_orders o
        WHERE o.id=q.order_id AND o.account_id=q.account_id
          AND o.status=q.event_status AND o.notifications_consent
          AND o.notification_channel=q.channel AND o.customer_phone=q.destination));
  WITH selected AS (
    SELECT q.id FROM private.ed_notification_queue q
      JOIN public.ed_orders o ON o.id=q.order_id AND o.account_id=q.account_id
    WHERE q.order_id=p_order_id AND q.delivery_status='awaiting_provider'
      AND o.status=q.event_status AND o.notifications_consent
      AND o.notification_channel=q.channel AND o.customer_phone=q.destination
      AND q.queued_at>now()-interval '6 hours'
    ORDER BY q.queued_at ASC FOR UPDATE OF q SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE private.ed_notification_queue q
    SET delivery_status='sending',attempted_at=now()
    FROM selected WHERE q.id=selected.id
    RETURNING q.id,q.channel,q.destination,q.event_status,q.body,q.order_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'channel',c.channel,'to',c.destination,'status',c.event_status,
    'body',c.body,'reference',o.reference)),'[]'::jsonb)
  INTO result FROM claimed c JOIN public.ed_orders o ON o.id=c.order_id;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_claim_order_notifications(uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ed_claim_order_notifications(uuid) TO service_role;
COMMIT;