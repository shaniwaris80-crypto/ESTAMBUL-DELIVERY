import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=x=>fs.readFileSync(new URL("../"+x,import.meta.url),"utf8");
const edge=read("supabase/functions/ed-rider-accept-sms/index.ts");
const sql=read("docs/staging/ed_one_whatsapp_tracking_review.sql");
const ui=read("docs/rider.js");
const script=await import("./create-estambul-whatsapp-template.mjs");

test("Spanish utility template has only reference and a sample tracking link",()=>{
 const tpl=script.template;
 assert.equal(tpl.language,"es");
 assert.equal(tpl.friendly_name,"estambul_delivery_tracking_es_v1");
 assert.equal(Object.keys(tpl.variables).length,2);
 assert.match(tpl.variables["2"],/^https:\/\/shaniwaris80-crypto\.github\.io\/ESTAMBUL-DELIVERY\/track\.html#token=[a-f0-9]{64}$/);
 assert.match(tpl.types["twilio/text"].body,/\{\{1\}\}/);
 assert.match(tpl.types["twilio/text"].body,/\{\{2\}\}/);
 assert.equal(script.approval.category,"UTILITY");
});
test("wrong-account 21655 is blocked before any message or claim",()=>{
 assert.match(edge,/if\(content\.account_sid!==accountSid\)return "wrong_template_account"/);
 assert.match(edge,/checkWhatsAppTemplate\(sid,secret,contentSid\)/);
 const check=edge.indexOf("const templateIssue=await checkWhatsAppTemplate");
 const claim=edge.indexOf('audit.rpc("ed_claim_one_tracking_whatsapp"');
 const send=edge.indexOf('form.set("ContentSid",contentSid)');
 assert.ok(check>0 && check<claim && claim<send);
 assert.match(edge,/approved\?\.whatsapp\?\.status==="approved"/);
});
test("WhatsApp is disabled by default and requires explicit channel-specific consent",()=>{
 assert.match(edge,/if\(order\.notification_channel==="whatsapp"\)/);
 assert.match(edge,/if\(!order\.notifications_consent\)return json\(\{\.\.\.result,whatsapp_status:"not_authorized"\}\)/);
 assert.match(edge,/env\("ESTAMBUL_WHATSAPP_ENABLED"\)!=="true"/);
 assert.match(edge,/TWILIO_WHATSAPP_CONTENT_SID/);
 assert.match(edge,/TWILIO_WHATSAPP_FROM/);
 assert.match(edge,/TWILIO_WHATSAPP_TEST_TO/);
 assert.match(edge,/from==="\+14155238886"/);
});
test("WhatsApp sends Twilio ContentSid and ContentVariables, never Body or MediaUrl",()=>{
 const start=edge.indexOf('if(order.notification_channel==="whatsapp"){');
 const end=edge.indexOf('if(!order.notifications_consent||order.notification_channel!=="sms")',start);
 assert.ok(start>0&&end>start);
 const section=edge.slice(start,end);
 assert.match(section,/form\.set\("ContentSid",contentSid\)/);
 assert.match(section,/form\.set\("ContentVariables",JSON\.stringify\(\{"1":String\(order\.reference\|\|"Pedido"\),"2":track\}\)\)/);
 assert.doesNotMatch(section,/form\.set\("(?:Body|MediaUrl)"/);
 assert.match(section,/AbortSignal\.timeout\(10000\)/);
 assert.match(section,/ed_finish_one_tracking_whatsapp/);
});
test("One immutable order claim spans BOTH SMS and WhatsApp",()=>{
 assert.match(sql,/ALTER TABLE private\.ed_one_tracking_sms_dispatch/);
 assert.match(sql,/INSERT INTO private\.ed_one_tracking_sms_dispatch\(order_id,account_id,channel\)/);
 assert.match(sql,/ON CONFLICT \(order_id\) DO NOTHING/);
 assert.match(sql,/ed_claim_one_tracking_whatsapp/);
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.ed_claim_one_tracking_whatsapp/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.ed_claim_one_tracking_whatsapp\(uuid\) TO service_role/);
 assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
test("Provider uncertainty is not retried, manual fallback only when NO automatic attempt",()=>{
 assert.match(edge,/errorCode="network_ambiguous"/);
 assert.match(edge,/already_sent_or_attempted/);
 assert.match(edge,/claimed!==true/);
 assert.match(ui,/const noAutomaticAttempt=\[/);
 assert.doesNotMatch(ui,/noAutomaticAttempt=.*"provider_rejected"/);
 assert.match(ui,/status==="provider_accepted"/);
 assert.match(ui,/No reenvíes automáticamente/);
 assert.match(ui,/shareTrackingByWhatsApp\(order,link,tab\)/);
});
test("SMS remains separate and notifies once, no new status SMS",()=>{
 assert.match(edge,/ed_claim_one_tracking_sms/);
 assert.match(edge,/order\.notification_channel!=="sms"/);
 assert.match(edge,/input\.resend===true/);
 assert.match(read("supabase/functions/ed-send-notifications/index.ts"),/Legacy status message dispatcher: intentionally disabled/);
});
test("No Twilio secret committed and CLI only acts using user local credentials",()=>{
 const cli=read("scripts/create-estambul-whatsapp-template.mjs");
 assert.match(cli,/process\.env\.TWILIO_ACCOUNT_SID/);
 assert.match(cli,/process\.env\.TWILIO_AUTH_TOKEN/);
 assert.match(cli,/if\(content\.account_sid!==sid\)/);
 assert.match(cli,/pathToFileURL\(process\.argv\[1\]\)/);
 assert.doesNotMatch(cli,/TWILIO_AUTH_TOKEN\s*=\s*["'][A-Za-z0-9]/);
});
