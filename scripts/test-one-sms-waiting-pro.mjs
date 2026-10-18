import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sms=read("supabase/functions/ed-rider-accept-sms/index.ts");
const statusSender=read("supabase/functions/ed-send-notifications/index.ts");
const rider=read("docs/rider.js");
const sql=read("docs/staging/one-sms-tracking-policy-review.sql");
const trackHtml=read("track.html"),trackJs=read("docs/track.js");
function presentation(){
 const window={};vm.runInNewContext(read("docs/track-state.js"),{window});
 return window.ESTAMBUL_TRACK_PRESENTATION.presentation;
}
test("Rider never sends Twilio notifications on collected / route / delivered changes",()=>{
 assert.doesNotMatch(rider,/functions\/v1\/ed-send-notifications/);
 assert.match(rider,/No status-change SMS/);
 assert.match(rider,/const status = button\.dataset\.next/);
 assert.match(rider,/body: JSON\.stringify\(status==="entregado"\?\{status,payment_method:confirmedPayment\}:\{status\}\)/);
});
test("legacy status messaging Edge worker contains NO network/database/Twilio send calls",()=>{
 assert.match(statusSender,/Single tracking link only/);
 assert.doesNotMatch(statusSender,/api\.twilio|fetch\s*\(|createClient|ed_claim_notifications|ed_claim_order_notifications|Messages\.json/);
 assert.match(statusSender,/accepted:0,failed:0/);
});
test("one SMS attempt is claimed permanently BEFORE Twilio is contacted",()=>{
 const smsOnly=sms.slice(sms.indexOf('if(!order.notifications_consent||order.notification_channel!=="sms")'));
 const claim=smsOnly.indexOf('audit.rpc("ed_claim_one_tracking_sms"');
 const provider=smsOnly.indexOf('fetch("https://api.twilio.com/');
 assert.ok(claim>0&&provider>claim);
 assert.match(sms,/if\(claimError\)return json\(\{\.\.\.result,sms_status:"dispatch_unavailable"\}\)/);
 assert.match(sms,/if\(claimed!==true\)return json\(\{\.\.\.result,sms_status:"already_sent_or_attempted"\}\)/);
 assert.match(sms,/if\(!service\)return json\(\{\.\.\.result,sms_status:"dispatch_unavailable"\}\)/);
});
test("Rider cannot request a second link or a second automated text",()=>{
 assert.match(sms,/if\(input\.resend===true\)return json\(\{error:/);
 assert.match(sms,/p_order_id:orderId,p_resend:false/);
 assert.match(rider,/resend:false/);
 assert.doesNotMatch(rider,/data-share="\+escapeText\(order\.id\)/);
 assert.doesNotMatch(rider,/Reenviar seguimiento<\/button>/);
});
test("database guard guarantees unique order attempt and rejects retry even when Twilio times out",()=>{
 assert.match(sql,/order_id uuid PRIMARY KEY REFERENCES public\.ed_orders/);
 assert.match(sql,/ON CONFLICT \(order_id\) DO NOTHING/);
 assert.match(sql,/ed_claim_one_tracking_sms/);
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\)/);
 assert.match(sql,/REVOKE ALL ON TABLE private\.ed_one_tracking_sms_dispatch FROM PUBLIC, anon, authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.ed_claim_one_tracking_sms\(uuid\) TO service_role/);
});
test("historical attempts are marked spent, including successful status-SMS events",()=>{
 assert.match(sql,/FROM private\.ed_tracking_sms_receipts r/);
 assert.match(sql,/FROM private\.ed_notification_queue q/);
 assert.match(sql,/q\.delivery_status IN \('sent','sending','failed'\)/);
 assert.match(sql,/delivery_status='skipped'/);
 assert.match(sql,/channel IN \('sms','whatsapp'\)/);
});
test("database status trigger stops enqueueing messages and Rider RPC ignores resend requests",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION private\.ed_queue_customer_notification/);
 assert.match(sql,/BEGIN\s+RETURN NEW;\s+END \$fn\$/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.ed_rider_accept_tracking/);
 assert.match(sql,/IF o\.accepted_at IS NOT NULL THEN/);
 assert.match(sql,/link_created',false,'already_accepted',true/);
 assert.doesNotMatch(sql,/IF p_resend\s*=\s*true THEN/);
});
test("customer page uses one link with automatic refresh, never outgoing SMS",()=>{
 assert.match(trackHtml,/Un enlace, todo el seguimiento/);
 assert.match(trackHtml,/id="waitingTitle"/);
 assert.match(trackHtml,/id="waitingFreshness"/);
 assert.match(trackHtml,/id="progressText"/);
 assert.match(trackHtml,/id="arrivalConfidence"/);
 assert.match(trackHtml,/id="orderProgress"/);
 assert.match(trackJs,/setInterval\(\(\)=>\{if\(document\.visibilityState==="visible"\)void refresh\(\);\},7000\)/);
 assert.doesNotMatch(trackJs,/Twilio|Messages\.json|ed-send-notifications/);
});
test("waiting copy correctly describes all real order states",()=>{
 const fn=presentation();
 const states=["pendiente","asignado","recogido","en_ruta","entregado","cancelado"];
 for(const status of states){
  const p=fn(status);
  assert.ok(p.icon&&p.title&&p.description&&p.next&&p.step);
 }
 assert.equal(fn("pendiente").progress,20);
 assert.equal(fn("asignado").progress,40);
 assert.equal(fn("recogido").progress,60);
 assert.equal(fn("en_ruta").progress,80);
 assert.equal(fn("entregado").progress,100);
 assert.equal(fn("cancelado").progress,0);
});
test("ETA only shows server-supplied values; no invented waiting duration",()=>{
 assert.match(trackJs,/data\.eta_minutes!=null&&Number\.isFinite\(eta\)&&eta>=0/);
 assert.match(trackJs,/No mostramos un tiempo inventado/);
 assert.match(trackJs,/canEstimate\s*\?/);
 assert.doesNotMatch(read("docs/track-state.js"),/eta_minutes:|fetch\(|setInterval/);
});
test("customer live map requires server-provided opt-in live location",()=>{
 assert.match(trackJs,/data\.status==="en_ruta"&&data\.live_location/);
 assert.match(trackJs,/el\("liveMapPanel"\)\.hidden=!hasGps/);
 assert.match(trackJs,/el\("riderMap"\)\.removeAttribute\("src"\)/);
 assert.match(trackHtml,/id="liveMapPanel"[^>]*hidden/);
});
test("customer waiting UI honors privacy, mobile layout and hidden state",()=>{
 const css=read("docs/track-pro-v2.css");
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/\[hidden\]\{display:none!important\}/);
 assert.match(css,/waiting-hero/);
 assert.match(trackHtml,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(trackHtml,/id="orderContent" hidden/);
 assert.match(trackHtml,/referrerpolicy="strict-origin-when-cross-origin"/);
});
