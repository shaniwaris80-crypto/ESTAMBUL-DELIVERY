import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const css=read("docs/visual-rider-v5.css");
const rider=read("docs/rider.js");
const html=read("rider.html");
const edge=read("supabase/functions/ed-rider-accept-sms/index.ts");
test("payment unknown and existing legacy !important backgrounds have readable contrast",()=>{
 assert.match(read("docs/rider.css"),/\.payment-panel\{background:#f5f7f5!important/);
 assert.match(css,/body\.ed-visual-v5 #dashboard \.order-card \.payment-panel\.unknown\{/);
 assert.match(css,/background:#33251e!important/);
 assert.match(css,/\.payment-panel strong\{[\s\S]*?color:#fff!important/);
 assert.match(css,/\.payment-title\{[\s\S]*?color:#ffcd92!important/);
});
test("article rows are dark with explicitly readable product name and options",()=>{
 assert.match(css,/\.order-packing \.packing-item\{[\s\S]*?background:#12334a!important/);
 assert.match(css,/\.order-packing \.packing-item strong\{[\s\S]*?color:#fff!important/);
 assert.match(css,/\.order-packing \.packing-item small\{[\s\S]*?color:#c2d9eb!important/);
 assert.match(css,/\.packing-optional:has\(input:checked\)/);
});
test("new Rider orders show honest SMS outcome; never assert delivery from mere acceptance",()=>{
 assert.match(rider,/const smsOutcomes=new Map/);
 assert.match(rider,/smsOutcomes\.set\(order\.id,\{ok:false,message:via\+" NO CONFIRMADO:/);
 assert.match(rider,/Twilio ha aceptado el SMS de seguimiento\. Aún no se ha confirmado su recepción/);
 assert.match(rider,/SMS no verificado · sin mensajes adicionales por estados/);
 assert.doesNotMatch(rider,/Enlace inicial enviado · sin SMS por estados/);
 assert.match(rider,/sms-delivery-notice/);
});
test("read-only health check never triggers sending, attempt claim or token generation",()=>{
 const start=edge.indexOf('if(req.method==="GET"){'),end=edge.indexOf(' let input:{order_id?:unknown;resend?:unknown};',start);
 assert.ok(start>0&&end>start);
 const health=edge.slice(start,end);
 assert.match(health,/\.eq\("user_id",current\.data\.user\.id\)/);
 assert.match(health,/\.eq\("active",true\)/);
 assert.match(health,/ESTAMBUL_MESSAGING_ENABLED/);
 assert.match(health,/TWILIO_SMS_FROM/);
 assert.doesNotMatch(health,/Messages\.json|ed_claim_one_tracking_sms|ed_rider_accept_tracking/);
 assert.match(edge,/Access-Control-Allow-Methods":"GET, POST, OPTIONS"/);
 assert.match(edge,/if\(input\.resend===true\)return json/);
 assert.match(edge,/claimed!==true/);
});
test("visible Rider SMS readiness and forced new PWA shell",()=>{
 assert.match(html,/id="smsHealthPanel"/);
 assert.match(html,/id="smsHealthStatus"/);
 assert.match(html,/id="checkSmsHealth"/);
 assert.match(html,/docs\/rider\.js\?v=27/);
 assert.match(html,/rider-pro-v4\.css\?v=1/);
 assert.match(read("rider-sw.js"),/const CACHE="estambul-rider-shell-v30"/);
 assert.match(rider,/withAuth\("\/functions\/v1\/ed-rider-accept-sms",\{method:"GET"\}\)/);
});
test("manual LastPOS, no resend, no status-change texts and optional packing preserved",()=>{
 assert.match(rider,/if\(resend\)return; \/\/ Rider cannot re-issue a tracking token/);
 assert.match(read("docs/live.js"),/Asignación manual desde LastPOS/);
 assert.match(read("docs/rider-items.js"),/Puedes continuar el reparto sin marcar/);
 assert.doesNotMatch(edge,/status_changed|ed-send-notifications/);
});
