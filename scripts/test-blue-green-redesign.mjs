import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const live=read("live.html"),rider=read("rider.html"),track=read("track.html");
test("all real entrypoints load the new approved styles",()=>{
 for(const page of [live,rider,track])assert.match(page,/docs\/ed-blue-green\.css/);
 assert.match(live,/docs\/ed-admin\.js/);
 assert.match(rider,/docs\/ed-rider-blue-green\.css/);
 assert.match(rider,/docs\/ed-rider-ui\.js/);
 assert.match(track,/docs\/ed-client-blue-green\.css/);
 for(const id of ["opsLiveMapPanel","opsSpotlight","ordersArea","riderDirectory","shiftHistoryCard","notifyAdminCard"]){
  assert.match(live,new RegExp('id="'+id+'"'));
 }
 for(const id of ["dashboard","activeDeliveries","dayCloseSection","gpsSection"]){
  assert.match(rider,new RegExp('id="'+id+'"'));
 }
});
test("login and privacy gates survive the new styles",()=>{
 assert.match(live,/id="appSection" hidden/);
 assert.match(rider,/id="dashboard" hidden/);
 assert.match(track,/id="orderContent" hidden/);
 assert.match(read("docs/ed-blue-green.css"),/\[hidden\]\{display:none!important\}/);
 assert.match(read("docs/ed-client-blue-green.css"),/#liveMapPanel/);
 assert.match(track,/noindex,nofollow,noarchive/);
});
test("Last.app webhook, manual assignments and private tracking remain the only real data origin",()=>{
 const ops=read("docs/live.js");
 const map=read("docs/visual-ops-map-v5.js");
 const trackJs=read("docs/track.js");
 const admin=read("docs/ed-admin.js");
 assert.match(ops,/Asignación manual desde LastPOS/);
 assert.match(admin,/LastPOS/);
 assert.doesNotMatch(admin,/fetch\s*\(|\.insert\s*\(|\.update\s*\(/);
 assert.match(map,/positions\.filter\(readyPos\)/);
 assert.match(trackJs,/data\.status==="en_ruta"&&data\.live_location/);
 assert.match(trackJs,/p_token:token/);
 assert.match(trackJs,/data\.eta_minutes!=null&&Number\.isFinite\(eta\)/);
 assert.match(trackJs,/el\("notFound"\)\.hidden=true;el\("orderContent"\)\.hidden=false/);
});
test("six independent Rider profiles supported across web and native with password gating",()=>{
 const pwa=read("docs/rider-profiles.js"),web=read("docs/rider.js"),native=read("apps/rider/lib/rider-profiles.ts");
 assert.match(pwa,/length:6/);
 assert.match(pwa,/n<=6/);
 assert.match(web,/slot>6/);
 assert.match(native,/\[1,2,3,4,5,6\]/);
 assert.match(native,/slot<=6/);
 assert.match(read("apps/rider/app/index.tsx"),/Redirect href="\/connected"/);
 for(let n=1;n<=6;n++)assert.match(rider,new RegExp('data-rider-slot="'+n+'"'));
 assert.match(read("apps/rider/app/connected.tsx"),/riderSlotFromName\(state\.rider\.display_name\)!==slot/);
});
test("new navigation is not a simulated data source",()=>{
 const js=read("docs/ed-rider-ui.js");
 assert.doesNotMatch(js,/fetch\s*\(|setInterval\s*\(|\.status\s*=/);
 assert.match(js,/data\.edView/);
 assert.match(read("rider-sw.js"),/estambul-rider-shell-v28/);
 assert.match(read("rider-sw.js"),/ed-rider-blue-green.css/);
 const window={};
 vm.runInNewContext(read("docs/track-state.js"),{window});
 const present=window.ESTAMBUL_TRACK_PRESENTATION.presentation;
 assert.equal(present("en_ruta").title,"On the way");
 assert.equal(present("entregado").progress,100);
});
