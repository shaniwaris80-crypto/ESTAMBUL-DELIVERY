import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const edge=read("supabase/functions/ed-rider-accept-sms/index.ts");
const sql=read("docs/staging/one-tracking-message-sms-whatsapp-review.sql");
const rider=read("docs/rider.js");
const tpl=read("scripts/twilio-whatsapp-template.mjs");
test("consent is channel-specific; no blanket SMS opt-in converted to WhatsApp",()=>{
 assert.match(sql,/o\.notifications_consent IS TRUE AND o\.notification_channel=p_channel/);
 assert.match(sql,/p_channel NOT IN \('sms','whatsapp'\)/);
 assert.match(edge,/!order\.notifications_consent/);
 assert.match(edge,/channel=order\.notification_channel==="whatsapp"/);
});
test("same PRIMARY KEY per order guards WhatsApp vs SMS duplicates",()=>{
 assert.match(sql,/private\.ed_one_tracking_sms_dispatch/);
 assert.match(sql,/ON CONFLICT\(order_id\) DO NOTHING/);
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\) IS DISTINCT FROM 'service_role'/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.ed_claim_one_tracking_message\(uuid,text\) TO service_role/);
 assert.match(edge,/ed_claim_one_tracking_sms/);
 assert.match(edge,/ed_claim_one_tracking_message/);
 assert.match(edge,/claimed!==true/);
});
test("WhatsApp auto is OFF by default and uses a registered Sender + valid HX SID",()=>{
 assert.match(edge,/ED_WHATSAPP_AUTO_ENABLED"\)!=="true"/);
 assert.match(edge,/TWILIO_WHATSAPP_FROM/);
 assert.match(edge,/TWILIO_WHATSAPP_CONTENT_SID/);
 assert.match(edge,/HX\[0-9a-fA-F\]\{32\}/);
 assert.match(edge,/whatsapp_manual_only/);
});
test("Twilio 21655 is checked BEFORE spending the one-send database claim",()=>{
 const check=edge.indexOf('await fetch("https://content.twilio.com/v1/Content/"');
 const claim=edge.indexOf('audit.rpc("ed_claim_one_tracking_message"');
 assert.ok(check>0&&claim>check);
 assert.match(edge,/whatsapp_template_not_found/);
 assert.match(edge,/ApprovalRequests/);
 assert.match(edge,/approvalData\.whatsapp\?\.status!=="approved"/);
 assert.match(edge,/whatsapp_template_unapproved/);
});
test("Twilio WhatsApp request uses ContentSid/ContentVariables and not SMS Body",()=>{
 assert.match(edge,/form\.set\("To",channel==="whatsapp"\?"whatsapp:"\+to:to\)/);
 assert.match(edge,/form\.set\("ContentSid",contentSid\)/);
 assert.match(edge,/form\.set\("ContentVariables",JSON\.stringify/);
 assert.match(edge,/channel==="whatsapp"\?"whatsapp_provider_accepted"/);
 assert.match(edge,/if\(channel==="sms"\)await audit\.rpc\("ed_log_tracking_sms"/);
});
test("one link, no status-change SMS or WhatsApp and no automatic retry",()=>{
 assert.match(edge,/if\(input\.resend===true\)return json/);
 assert.match(read("supabase/functions/ed-send-notifications/index.ts"),/Single tracking link only/);
 assert.match(edge,/The permanent dispatch claim MUST be committed before contacting Twilio/);
 assert.doesNotMatch(edge,/setTimeout\([\s\S]*?Messages\.json/);
});
test("Rider distinguishes accepted WhatsApp from SMS and never retries failed WhatsApp",()=>{
 assert.match(rider,/whatsapp_provider_accepted/);
 assert.match(rider,/whatsapp_provider_rejected/);
 assert.match(rider,/Twilio ha aceptado el WhatsApp de seguimiento/);
 assert.match(rider,/WhatsApp no activo/);
 assert.match(rider,/whatsapp_template_not_found/);
 assert.match(rider,/No se reintentará automáticamente/);
});
test("Twilio template provisioning script has real Spanish UTILITY text, secret-safe credentials and no sends",()=>{
 assert.match(tpl,/friendly_name:"estambul_entrega_seguimiento_es"/);
 assert.match(tpl,/language:"es"/);
 assert.match(tpl,/"twilio\/text"/);
 assert.match(tpl,/category:"UTILITY"/);
 assert.match(tpl,/TWILIO_AUTH_TOKEN/);
 assert.match(tpl,/TWILIO_WHATSAPP_CONTENT_SID/);
 assert.doesNotMatch(tpl,/Messages\.json/);
});
