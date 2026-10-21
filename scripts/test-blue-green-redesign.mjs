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
test("five independent Rider profiles supported across web and native with password gating",()=>{
 const pwa=read("docs/rider-profiles.js"),web=read("docs/rider.js"),native=read("apps/rider/lib/rider-profiles.ts");
 assert.match(pwa,/length:5/);
 assert.match(pwa,/n<=5/);
 assert.match(web,/slot>5/);
 assert.match(native,/\[1,2,3,4,5\]/);
 assert.match(native,/slot<=5/);
 assert.match(read("apps/rider/app/index.tsx"),/Redirect href="\/connected"/);
 for(let n=1;n<=5;n++)assert.match(rider,new RegExp('data-rider-slot="'+n+'"'));
 assert.match(read("apps/rider/app/connected.tsx"),/riderSlotFromName\(state\.rider\.display_name\)!==slot/);
 assert.match(read("apps/rider/app/connected.tsx"),/screen==="wallet"/);
 assert.match(read("apps/rider/app/connected.tsx"),/accessibilityRole="tab"/);
 assert.doesNotMatch(rider,/data-rider-slot="6"/);
 assert.match(read("docs/ed-admin.js"),/Repartidores \(5\)/);
});
test("new navigation is not a simulated data source",()=>{
 const js=read("docs/ed-rider-ui.js");
 assert.doesNotMatch(js,/fetch\s*\(|setInterval\s*\(|\.status\s*=/);
 assert.match(js,/dataset\.edView/);
 assert.match(read("rider-sw.js"),/estambul-rider-shell-v29/);
 assert.match(read("rider-sw.js"),/ed-rider-blue-green.css/);
 const window={};
 vm.runInNewContext(read("docs/track-state.js"),{window});
 const present=window.ESTAMBUL_TRACK_PRESENTATION.presentation;
 assert.equal(present("en_ruta").title,"On the way");
 assert.equal(present("entregado").progress,100);
});

test("only admin can authorize five rider emails; passwords are chosen by Riders",()=>{
 const ops=read("docs/live.js");
 const html=read("live.html"),preview=read("preview/backoffice.html");
 const sql=read("supabase/migrations/024_admin_authorize_five_rider_emails.sql");
 for(let n=1;n<=5;n++){assert.match(html,new RegExp('id="riderInviteEmail'+n+'"'));assert.match(preview,new RegExp('id="riderInviteEmail'+n+'"'));}
 assert.match(ops,/member\?\.role!=="admin"/);
 assert.match(ops,/ed_admin_authorize_rider_email/);
 assert.doesNotMatch(ops,/functions\/v1\/ed-invite-riders/);
 assert.match(sql,/m\.role='admin'/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/not between 1 and 5/);
 assert.match(sql,/revoke all on function public\.ed_admin_authorize_rider_email/);
 assert.match(sql,/grant execute on function public\.ed_admin_authorize_rider_email\(integer,text\) to authenticated/);
 assert.match(html,/Crear cuenta Rider/);
});
