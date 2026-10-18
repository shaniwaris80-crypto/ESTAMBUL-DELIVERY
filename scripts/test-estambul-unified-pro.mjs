import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {analyzeLastFinance} from "../docs/last-finance-diagnostic.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const rider=read("docs/rider.js"),staff=read("docs/live.js"),staffHtml=read("live.html"),riderHtml=read("rider.html");
const worker=read("supabase/functions/ed-last-auto-sync/index.ts");
const native=read("apps/rider/lib/connected.ts"),nativeUI=read("apps/rider/app/connected.tsx");
test("LastPOS remains sole assigner for real orders, and staff UI never offers assignment there",()=>{
 assert.match(worker,/ed_last_import_tab/);
 assert.match(staff,/o\.channel!=="test"[\s\S]*?Gestionar en Last\.app/);
 assert.match(staff,/o\.channel!=="test"[\s\S]*?Asignación manual desde LastPOS/);
 assert.match(staff,/if\(!o\|\|busy\|\|o\.channel!=="test"\)return/);
 assert.match(staff,/body:JSON\.stringify\(\{rider_id:rid,status:rid\?"asignado":"pendiente"\}\)/);
 assert.match(rider,/rider_id=eq\." \+ encodeURIComponent\(rider\.id\)/);
 assert.match(native,/&rider_id=eq\."\+rider\.id/);
});
test("manager sees source-of-truth banner and no automatic dispatcher",()=>{
 assert.match(staffHtml,/asignaciones reales se realizan manualmente en/i);
 assert.match(staffHtml,/LastPOS/);
 assert.match(read("docs/live-pro-v4.css"),/#staffView>\.v2-admin-nav/);
 assert.match(staffHtml,/id="proAvailableRiders"/);
 assert.match(staffHtml,/id="proWaitingOrders"/);
 assert.match(staffHtml,/id="proSyncLabel"/);
 assert.match(staff,/proAvailableRiders/);
 assert.doesNotMatch(staff,/autoAssign|autoDispatch|leastBusyRider|assignRandom/i);
});
test("Rider payment choice remains stable through refresh and swipes",()=>{
 assert.match(rider,/const paymentDrafts=new Map\(\)/);
 assert.match(rider,/capturePaymentDrafts\(\)/);
 assert.match(rider,/paymentInteractionUntil=Date\.now\(\)\+20000/);
 assert.match(rider,/document\.activeElement\?\.matches\('select\[data-payment-for\]'\)/);
 assert.match(rider,/activeSwipe===null/);
 assert.match(rider,/paymentDrafts\.get\(order\.id\)/);
 assert.match(rider,/paymentDrafts\.clear\(\)/);
});
test("real Rider delivery still checks the real payment method and concurrent assignment",()=>{
 assert.match(rider,/\["efectivo","tarjeta"\]\.includes\(confirmedPayment\)/);
 assert.match(rider,/payment_method:confirmedPayment/);
 assert.match(rider,/rider_id=eq\." \+ encodeURIComponent\(rider\.id\)/);
 assert.match(rider,/status=eq\." \+ encodeURIComponent\(order\.status\)/);
 assert.match(rider,/if \(!Array\.isArray\(rows\) \|\| rows\.length !== 1\)/);
});
test("Last reported zero price gets a verification warning; no generated amount",()=>{
 assert.match(rider,/verificar importe en Last\.app/);
 assert.match(nativeUI,/Importe 0 €: verifica el total en Last\.app/);
 const x=analyzeLastFinance({bills:[]});
 assert.equal(x.totalCents,null);
 assert.equal(x.totalSource,"unknown");
});
test("prepaid/online is not misclassified as cash nor rider-collected card",()=>{
 assert.match(native,/export type DeliveryCollection="efectivo"\|"tarjeta"\|"online"/);
 assert.match(native,/connectedPaymentConfirmation=process\.env\.EXPO_PUBLIC_RIDER_PAYMENT_CONFIRM_ENABLED==="true"/);
 assert.match(native,/payment_method:method==="online"\?null/);
 assert.match(nativeUI,/Ya pagado online · revisión gerente/);
 assert.match(nativeUI,/!collection/);
 assert.match(native,/JSON\.stringify\(collectionUpdate\(next,collection\)\)/);
 const x=analyzeLastFinance({bills:[{total:2590,payments:[{amount:2590}]}]});
 assert.equal(x.paidAlready,true);assert.equal(x.paidCents,2590);
 assert.equal(x.preferredCollectionMethod,null);
});
test("Last imports remain unaltered unless item snapshot feature explicitly activated",()=>{
 assert.match(worker,/env\("ED_RIDER_ITEMS_INGEST_ENABLED"\)==="true"/);
 assert.match(worker,/await rpc<Dict>\("ed_last_import_tab"/);
 assert.match(worker,/try[\s\S]*?ed_last_upsert_item_snapshot[\s\S]*?catch/);
 const sql=read("docs/staging/ed_last_import_tab_review.sql");
 assert.match(sql,/STAGING PROPOSAL ONLY/);
});
test("staff pins become stale after 45 seconds, not 120 seconds",()=>{
 assert.match(staff,/age>=0&&age<=45000/);
 assert.doesNotMatch(staff,/Date\.now\(\)-Date\.parse\(p\.updated_at\)<=120000/);
});
test("only pizzas and drinks may be optionally ticked and no Rider pickup is blocked",()=>{
 assert.match(rider,/itemController\?\.render\(order\)/);
 assert.doesNotMatch(rider,/itemController\.mayStartRoute\(/);
 assert.match(nativeUI,/function optionalPackingCategory/);
 assert.match(nativeUI,/disabled=\{!optional\}/);
 assert.doesNotMatch(nativeUI,/checkAndAdvance\(/);
 assert.match(read("docs/rider-items.js"),/REVISIÓN OPCIONAL/);
});
test("premium manager and rider CSS exist in page after original styles",()=>{
 assert.match(staffHtml,/docs\/live-pro-v4\.css/);
 assert.match(riderHtml,/docs\/rider-pro-v4\.css/);
 assert.match(read("docs/live-pro-v4.css"),/\.ops-pro-hero/);
 assert.match(read("docs/live-pro-v4.css"),/@media\(max-width:690px\)/);
 assert.match(read("docs/rider-pro-v4.css"),/#dashboard \.order-card/);
 assert.match(read("docs/rider-pro-v4.css"),/#dashboard \.payment-confirmation/);
});
test("no real credentials or database migration introduced by UI design",()=>{
 for(const p of ["docs/live-pro-v4.css","docs/rider-pro-v4.css","docs/last-finance-diagnostic.mjs"]){
  const src=read(p);
  assert.doesNotMatch(src,/service_role_key|twilio_auth_token|auth\/v1\/admin\/users|fetch\(["']https:/i);
 }
});

test("PWA app-shell cache includes the new UI assets without storing orders or API data",()=>{
 const sw=read("rider-sw.js");
 for(const path of ["docs/rider-pro-v3.css","docs/rider-pro-v4.css","docs/rider-packing.css",
  "docs/rider-items.js","docs/rider-profiles.js","docs/rider.js"]){
  assert.match(sw,new RegExp(path.replace(".","\\.")));
 }
 assert.match(sw,/const CACHE="estambul-rider-shell-v24"/);
 assert.match(sw,/reqUrl\.origin!==self\.location\.origin/);
 assert.match(sw,/Never cache Supabase endpoints/);
 assert.doesNotMatch(sw,/ed_orders|customer_phone|access_token|refresh_token|service_role/i);
});
test("the private dashboards stay hidden until session permissions are verified",()=>{
 assert.match(read("docs/live-pro-v4.css"),/\[hidden\]\{display:none!important\}/);
 assert.match(read("docs/rider-pro-v4.css"),/\[hidden\]\{display:none!important\}/);
 assert.match(staffHtml,/id="appSection" hidden/);
 assert.match(riderHtml,/id="dashboard" hidden/);
});
