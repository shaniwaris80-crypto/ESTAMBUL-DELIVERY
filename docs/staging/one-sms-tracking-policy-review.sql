-- REVIEW IN STAGING BEFORE ANY PRODUCTION DEPLOYMENT.
-- Customer communications policy: at most ONE automatic tracking SMS attempt per order.
-- The tracking page carries all subsequent status updates, without new SMS.
-- Apply the migration together with BOTH updated Edge Functions and Rider UI.
-- Never enable the old status-notification cron/worker during a partial rollout.
BEGIN;

CREATE TABLE IF NOT EXISTS private.ed_one_tracking_sms_dispatch (
  order_id uuid PRIMARY KEY REFERENCES public.ed_orders(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.ed_accounts(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  provider_accepted boolean,
  provider_message_id text,
  completed_at timestamptz
);
ALTER TABLE private.ed_one_tracking_sms_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ed_one_tracking_sms_dispatch FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE private.ed_one_tracking_sms_dispatch TO service_role;

CREATE OR REPLACE FUNCTION public.ed_claim_one_tracking_sms(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE claimed_order uuid;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service role only'; END IF;
 IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order required'; END IF;
 INSERT INTO private.ed_one_tracking_sms_dispatch(order_id,account_id)
 SELECT o.id,o.account_id FROM public.ed_orders o
 WHERE o.id=p_order_id AND o.accepted_at IS NOT NULL
  AND o.notifications_consent IS TRUE AND o.notification_channel='sms'
  AND o.status IN ('asignado','recogido','en_ruta')
 ON CONFLICT (order_id) DO NOTHING
 RETURNING order_id INTO claimed_order;
 RETURN claimed_order IS NOT NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_claim_one_tracking_sms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ed_claim_one_tracking_sms(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ed_finish_one_tracking_sms(
 p_order_id uuid,p_accepted boolean,p_provider_sid text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service role only'; END IF;
 UPDATE private.ed_one_tracking_sms_dispatch SET
  provider_accepted=coalesce(p_accepted,false),
  provider_message_id=left(p_provider_sid,120),
  completed_at=now()
 WHERE order_id=p_order_id AND completed_at IS NULL;
 RETURN FOUND;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_finish_one_tracking_sms(uuid,boolean,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ed_finish_one_tracking_sms(uuid,boolean,text) TO service_role;

-- Treat historical SMS attempts as already spent BEFORE enabling a new Edge sender.
-- This prevents a previous Twilio acceptance from receiving a new link after migration.
INSERT INTO private.ed_one_tracking_sms_dispatch(
 order_id,account_id,attempted_at,provider_accepted,completed_at
)
SELECT DISTINCT ON (r.order_id)
 r.order_id,r.account_id,r.attempted_at,
 (r.result='provider_accepted'),r.attempted_at
FROM private.ed_tracking_sms_receipts r
ORDER BY r.order_id,r.attempted_at DESC
ON CONFLICT(order_id) DO NOTHING;

-- Also respect previous status SMS attempts. Do not resend merely because an
-- old server already sent something before switching to the one-link policy.
INSERT INTO private.ed_one_tracking_sms_dispatch(
 order_id,account_id,attempted_at,provider_accepted,completed_at
)
SELECT DISTINCT ON (q.order_id)
 q.order_id,q.account_id,coalesce(q.attempted_at,q.queued_at),
 (q.delivery_status='sent'),coalesce(q.attempted_at,q.queued_at)
FROM private.ed_notification_queue q
WHERE q.channel='sms' AND q.delivery_status IN ('sent','sending','failed')
ORDER BY q.order_id,coalesce(q.attempted_at,q.queued_at) DESC
ON CONFLICT(order_id) DO NOTHING;

-- Rider direct RPC must not bypass the one-link rule by setting p_resend=true.
-- Token hashes are not reversible; an already accepted Rider sees the existing
-- customer tracking state rather than issuing a second private token.
CREATE OR REPLACE FUNCTION public.ed_rider_accept_tracking(
 p_order_id uuid,p_resend boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE o record; token text;
BEGIN
 SELECT e.id,e.account_id,e.rider_id,e.status,e.accepted_at,e.customer_phone,
        e.notifications_consent,e.notification_channel,r.online,r.active
 INTO o FROM public.ed_orders e JOIN public.ed_riders r
 ON r.id=e.rider_id AND r.account_id=e.account_id
 WHERE e.id=p_order_id FOR UPDATE OF e;
 IF o.id IS NULL OR NOT private.ed_is_rider(o.account_id,o.rider_id)
   OR NOT o.active OR NOT o.online
   OR o.status NOT IN ('asignado','recogido','en_ruta') THEN
  RAISE EXCEPTION 'No autorizado para aceptar este pedido';
 END IF;
 IF o.accepted_at IS NOT NULL THEN
  RETURN jsonb_build_object('accepted',true,'link_created',false,'already_accepted',true);
 END IF;
 IF o.status<>'asignado' THEN
  RAISE EXCEPTION 'Solo se acepta antes de marcar recogido';
 END IF;
 UPDATE public.ed_orders SET accepted_at=clock_timestamp() WHERE id=o.id;
 token=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO private.ed_public_tracking_tokens(account_id,order_id,token_hash,expires_at,issued_by)
 VALUES(o.account_id,o.id,encode(extensions.digest(token,'sha256'),'hex'),
 now()+interval '21 days',(select auth.uid()));
 RETURN jsonb_build_object('accepted',true,'link_created',true,
   'token',token,
   'can_whatsapp',coalesce(o.notifications_consent,false)
    and o.notification_channel='whatsapp' and o.customer_phone is not null,
   'first_accept',true);
END $fn$;
REVOKE ALL ON FUNCTION public.ed_rider_accept_tracking(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ed_rider_accept_tracking(uuid,boolean) TO authenticated;

-- No state-change notifications: the same private URL updates itself automatically.
-- This function remains attached to the existing trigger to prevent old updates
-- from creating rows, including for a rider whose phone previously opted in.
CREATE OR REPLACE FUNCTION private.ed_queue_customer_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 RETURN NEW;
END $fn$;

-- Old awaiting messages must NOT be drained by a cron/worker after deployment.
UPDATE private.ed_notification_queue
SET delivery_status='skipped',
    last_error='one-link customer policy: use private tracking page, no status SMS'
WHERE delivery_status='awaiting_provider'
  AND channel IN ('sms','whatsapp');

COMMIT;

