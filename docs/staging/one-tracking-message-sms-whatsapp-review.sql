-- STAGING FIRST: at most one outbound tracking link across SMS and WhatsApp.
-- Additive migration: does not change default SMS behavior or existing user consent.
BEGIN;
ALTER TABLE private.ed_one_tracking_sms_dispatch
 ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ed_one_tracking_dispatch_channel_check'
  AND conrelid='private.ed_one_tracking_sms_dispatch'::regclass)
 THEN
  ALTER TABLE private.ed_one_tracking_sms_dispatch
   ADD CONSTRAINT ed_one_tracking_dispatch_channel_check
   CHECK(channel IN ('sms','whatsapp'));
 END IF;
END $$;

-- Same PRIMARY KEY(order_id) as legacy SMS: switching channels cannot send two links.
-- Only the service-role Edge Function can claim a new first attempt.
CREATE OR REPLACE FUNCTION public.ed_claim_one_tracking_message(
 p_order_id uuid,p_channel text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE claimed uuid;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service role only'; END IF;
 IF p_order_id IS NULL OR p_channel NOT IN ('sms','whatsapp')
 THEN RAISE EXCEPTION 'Invalid tracking claim'; END IF;
 INSERT INTO private.ed_one_tracking_sms_dispatch(order_id,account_id,channel)
 SELECT o.id,o.account_id,p_channel
 FROM public.ed_orders o
 WHERE o.id=p_order_id AND o.accepted_at IS NOT NULL
  AND o.notifications_consent IS TRUE AND o.notification_channel=p_channel
  AND o.status IN ('asignado','recogido','en_ruta')
 ON CONFLICT(order_id) DO NOTHING
 RETURNING order_id INTO claimed;
 RETURN claimed IS NOT NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_claim_one_tracking_message(uuid,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ed_claim_one_tracking_message(uuid,text) TO service_role;

COMMENT ON FUNCTION public.ed_claim_one_tracking_message(uuid,text) IS
 'Exactly one automated attempt per order across SMS/WhatsApp; no automatic retry after provider timeout';
COMMIT;
