-- STAGING ONLY: prepare WhatsApp as a separately opt-in channel.
-- This migration is ADDITIVE. It MUST NOT be applied before staging review.
-- SMS remains functional and WhatsApp stays OFF until template approval.
BEGIN;
ALTER TABLE private.ed_one_tracking_sms_dispatch
 ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';
ALTER TABLE private.ed_one_tracking_sms_dispatch
 ADD COLUMN IF NOT EXISTS last_error_code text;
-- A unique order_id already prevents both SMS AND WhatsApp from sending
-- automatically for the same order. Never delete claims on an ambiguous timeout.
ALTER TABLE private.ed_one_tracking_sms_dispatch DROP CONSTRAINT IF EXISTS ed_one_tracking_message_channel_check;
ALTER TABLE private.ed_one_tracking_sms_dispatch
 ADD CONSTRAINT ed_one_tracking_message_channel_check
 CHECK(channel IN ('sms','whatsapp'));

CREATE OR REPLACE FUNCTION public.ed_claim_one_tracking_whatsapp(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE claimed_order uuid;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service role only'; END IF;
 IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order required'; END IF;
 INSERT INTO private.ed_one_tracking_sms_dispatch(order_id,account_id,channel)
 SELECT o.id,o.account_id,'whatsapp' FROM public.ed_orders o
 WHERE o.id=p_order_id AND o.accepted_at IS NOT NULL
 AND o.notifications_consent IS TRUE AND o.notification_channel='whatsapp'
 AND o.status IN ('asignado','recogido','en_ruta')
 ON CONFLICT (order_id) DO NOTHING RETURNING order_id INTO claimed_order;
 RETURN claimed_order IS NOT NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_claim_one_tracking_whatsapp(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ed_claim_one_tracking_whatsapp(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ed_finish_one_tracking_whatsapp(
 p_order_id uuid, p_accepted boolean, p_provider_sid text DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service role only'; END IF;
 UPDATE private.ed_one_tracking_sms_dispatch SET
 provider_accepted=coalesce(p_accepted,false),
 provider_message_id=left(p_provider_sid,120),
 last_error_code=left(p_error_code,100),
 completed_at=now()
 WHERE order_id=p_order_id AND channel='whatsapp' AND completed_at IS NULL;
 RETURN FOUND;
END $fn$;
REVOKE ALL ON FUNCTION public.ed_finish_one_tracking_whatsapp(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ed_finish_one_tracking_whatsapp(uuid,boolean,text,text) TO service_role;
COMMIT;
