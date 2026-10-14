-- Enable default transaction SMS for already-imported, still-active
-- first-party LastPOS deliveries. Restaurant owner confirms service notice consent.
-- New LastPOS and GloriaFood imports were enabled by migrations 021/022.
-- No change to status or rider, no retroactive sends, no Uber/Just Eat.
BEGIN;

WITH eligible AS (
 SELECT o.id
 FROM public.ed_orders o
 JOIN private.ed_last_order_links lk ON lk.order_id=o.id
 JOIN private.ed_last_locations loc ON loc.location_id=lk.location_id
   AND loc.account_id=o.account_id AND loc.enabled
 WHERE o.channel='lastapp'
   AND o.status IN ('pendiente','asignado','recogido','en_ruta')
   AND o.accepted_at IS NULL
   AND o.notifications_consent=false
   AND o.notification_channel='none'
   AND o.customer_phone ~ '^\+[1-9][0-9]{7,14}$'
   AND EXISTS (
     SELECT 1 FROM private.ed_last_webhook_events e
     WHERE e.event_type='tab:created'
       AND e.data->'data'->>'id'=lk.tab_id
       AND lower(coalesce(e.data->'data'->>'source',''))
           IN ('owndelivery','restaurant','manual','tpv')
       AND lower(coalesce(e.data->'data'->>'pickupType',''))
           IN ('owndelivery','delivery')
   )
)
UPDATE public.ed_orders o
SET notifications_consent=true, notification_channel='sms'
FROM eligible e
WHERE o.id=e.id;

COMMIT;
