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

-- Important: existing provider-accepted sends cannot be undone.
-- Before rollout, import/honor prior successful tracking SMS receipts and statuses
-- as spent attempts, otherwise a historic order could get a second message:
-- 
-- INSERT INTO private.ed_one_tracking_sms_dispatch(order_id,account_id,provider_accepted,completed_at)
-- SELECT DISTINCT ON (r.order_id) r.order_id,r.account_id,
--   (r.result='provider_accepted'),r.attempted_at
-- FROM private.ed_tracking_sms_receipts r
-- ORDER BY r.order_id,r.attempted_at ASC
-- ON CONFLICT(order_id) DO NOTHING;
-- 
-- Production migration should run the above *inside the same transaction*
-- and also treat the existing accepted SMS status queue as historical sends.
-- Confirm exact legacy status-send records before production rollout.
