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
 assert.match(read("rider-sw.js"),/estambul-rider-shell-v30/);
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

test("Back Office recovery requires a verified recovery token and preserves admin membership",()=>{
 const recovery=read("docs/admin-email-recovery.js");
 const html=read("live.html");
 const js=read("docs/live.js");
 for(const id of ["forgotPasswordButton","recoveryEmailStatus","passwordRecoveryForm","recoveryNewPassword","recoveryConfirmPassword"])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(recovery,/auth\/v1\/recover/);
 assert.match(recovery,/auth\/v1\/verify/);
 assert.match(recovery,/auth\/v1\/user/);
 assert.match(recovery,/ed_members\?select=role/);
 assert.match(recovery,/window\.history\.replaceState/);
 assert.doesNotMatch(recovery,/service_role_key|SUPABASE_SERVICE_ROLE_KEY|TWILIO_AUTH_TOKEN/i);
 assert.match(js,/ESTAMBUL_ADMIN_RECOVERY/);
});
test("Last health read-only RPC is staff-scoped, reports real events, never sends messages",()=>{
 const sql=read("supabase/migrations/025_staff_last_health.sql");
 const op=read("docs/live.js");
 const admin=read("docs/ed-admin.js");
 assert.match(sql,/ed_staff_last_health/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/m\.role in \('admin','dispatcher'\)/);
 assert.match(sql,/e\.received_at>l\.updated_at/);
 assert.match(sql,/revoke all on function public\.ed_staff_last_health/);
 assert.doesNotMatch(sql,/insert into|update public\.ed_orders|delete from|twilio/i);
 assert.match(op,/\/rest\/v1\/rpc\/ed_staff_last_health/);
 assert.match(admin,/id="edLastHealth"/);
});

test("Rider can request email recovery without saving passwords",()=>{
 const html=read("rider.html"),rider=read("docs/rider.js");
 assert.match(html,/id="riderForgotPassword"/);
 assert.match(html,/id="riderPasswordRecoveryStatus"/);
 assert.match(rider,/\/auth\/v1\/recover\?redirect_to=/);
 assert.match(rider,/selectedRiderSlot===null/);
 assert.match(rider,/auth\/v1\/token\?grant_type=password/);
 assert.match(rider,/token_hash/);
 assert.match(rider,/window\.history\.replaceState/);
 assert.doesNotMatch(read("rider-sw.js"),/ed_orders|access_token|refresh_token|service_role/i);
});

test("Auth 400 with unconfirmed email is actionable and confirmation resend is user initiated",()=>{
 const backoffice=read("docs/live.js");
 const html=read("live.html");
 assert.match(backoffice,/o\?\.msg/);
 assert.match(backoffice,/email_not_confirmed/);
 assert.match(backoffice,/auth\/v1\/resend\?redirect_to=/);
 assert.match(backoffice,/type:"signup",email/);
 assert.match(backoffice,/el\("resendSignupEmail"\)\.hidden=false/);
 assert.match(html,/id="resendSignupEmail"/);
 assert.match(html,/docs\/live\.js\?v=28/);
 assert.doesNotMatch(backoffice,/SUPABASE_SERVICE_ROLE_KEY|email_confirm:\s*true/);
});

test("Back Office authenticates even when an optional admin section is absent",()=>{
 const source=read("docs/live.js");
 const start=source.indexOf("function logged(){");
 const end=source.indexOf("async function reload(){",start);
 assert.ok(start>=0&&end>start);
 const fn=source.slice(start,end);
 const widgets=new Map([
  ["loginSection",{hidden:false}],["appSection",{hidden:true}],["logout",{hidden:true}],
  ["noConfig",{hidden:false}],["staffView",{hidden:true}],["riderView",{hidden:true}],
  ["accountLabel",{textContent:""}],["viewTitle",{textContent:""}],
  ["viewSub",{textContent:""}],["connection",{textContent:""}]
 ]);
 const el=id=>widgets.get(id)||null;
 // Historical mobile cached HTML may omit inviteCard and operationsResetCard.
 assert.doesNotThrow(()=>vm.runInNewContext(fn+"\nlogged();",{
   el,member:{role:"admin"},account:{name:"ESTAMBUL DELIVERY"}
 }));
 assert.equal(widgets.get("appSection").hidden,false);
 assert.equal(widgets.get("loginSection").hidden,true);
 assert.equal(widgets.get("staffView").hidden,false);
 assert.equal(widgets.get("connection").textContent,"Conectado");
 assert.match(read("live.html"),/docs\/live\.js\?v=28/);
});

test("optional admin DOM button controls never block authenticated Back Office",()=>{
 const js=read("docs/live.js");
 assert.match(js,/function setDisabled\(id,value\)/);
 assert.match(js,/if\(node\)node\.disabled=Boolean\(value\)/);
 assert.match(js,/function setTextIfPresent\(id,text\)/);
 for(const id of ["resetOperationsButton","restoreOperationsButton","signUpButton","signInButton","sendInvitations"]){
   assert.doesNotMatch(js,new RegExp('el\\("'+id+'"\\)\\.disabled\\s*='));
   assert.match(js,new RegExp('setDisabled\\("'+id+'"'));
 }
 for(const id of ["resetOperationsButton","restoreOperationsButton","signUpButton","sendInvitations"]){
   assert.match(js,new RegExp('el\\("'+id+'"\\)\\?\\.addEventListener'));
 }
 const helper=js.slice(js.indexOf('function setDisabled('),js.indexOf('function setTextIfPresent('));
 const absent=()=>null;
 assert.doesNotThrow(()=>vm.runInNewContext('const el=()=>null;'+helper+'setDisabled("resetOperationsButton",true);'));
 const ui={disabled:false};
 vm.runInNewContext('const el=()=>node;'+helper+'setDisabled("resetOperationsButton",true);',{node:ui});
 assert.equal(ui.disabled,true);
 assert.match(read("live.html"),/docs\/live\.js\?v=28/);
});
