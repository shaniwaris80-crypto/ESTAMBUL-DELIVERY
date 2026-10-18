import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
function setup(){
 const values=new Map();
 const window={localStorage:{getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)}};
 vm.runInNewContext(read("docs/rider-profiles.js"),{window});
 return {p:window.ESTAMBUL_RIDER_PROFILES,values};
}
test("five fixed Rider identities are exposed, no more",()=>{
 const {p}=setup();
 assert.deepEqual(Array.from(p.profiles,x=>x.slot),[1,2,3,4,5]);
 assert.ok(p.profiles.every(x=>/^RIDER 0[1-5]$/.test(x.label)));
 assert.ok(Object.isFrozen(p.profiles));
});
test("account name must match chosen Rider ID exactly",()=>{
 const {p}=setup();
 assert.equal(p.slotForName("rider1"),1);
 assert.equal(p.slotForName("Rider 2"),2);
 assert.equal(p.slotForName("rider-03"),3);
 assert.equal(p.slotForName("rider_5"),5);
 assert.equal(p.slotForName("rider10"),null);
 assert.equal(p.slotForName("Rider 6"),null);
 assert.equal(p.slotForName("administrador"),null);
});
test("only email identifiers are remembered after explicit successful login",()=>{
 const {p,values}=setup();
 assert.equal(p.readEmail(1),"");
 assert.equal(p.rememberEmail(1,"rider1@example.com"),true);
 assert.equal(p.readEmail(1),"rider1@example.com");
 assert.equal(p.readEmail(2),"");
 assert.equal(p.rememberEmail(6,"rider6@example.com"),false);
 assert.equal(p.rememberEmail(2,"not-an-email"),false);
 assert.equal(values.size,1);
 p.forgetEmail(1);assert.equal(p.readEmail(1),"");
});
test("never caches plaintext passwords, tokens or active orders in slot helper",()=>{
 const source=read("docs/rider-profiles.js");
 assert.doesNotMatch(source,/access_token|refresh_token|service_role|ed_orders|supabase\.co/i);
 assert.doesNotMatch(source,/setItem\([^\n]*password/i);
 assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|WebSocket/);
});
test("legacy Supabase Auth login and role checks remain in the PWA",()=>{
 const source=read("docs/rider.js");
 assert.match(source,/auth\/v1\/token\?grant_type=password/);
 assert.match(source,/ed_members\?select=account_id,role,active/);
 assert.match(source,/private,preauthorized invitation|preauthorized invitation/);
 assert.match(source,/riderProfiles\?\.slotForName\(current\.display_name\)!==selectedRiderSlot/);
 const login=source.indexOf("async function signIn("),authenticate=source.indexOf("  await authenticate();",login),
 remember=source.indexOf("riderProfiles.rememberEmail(selectedRiderSlot,email)",login);
 assert.ok(authenticate>login&&remember>authenticate);
});
test("mobile/native login also rejects mismatching profiles",()=>{
 const source=read("apps/rider/app/connected.tsx");
 assert.match(source,/riderSlotFromName\(state\.rider\.display_name\)!==slot/);
 assert.match(source,/await logoutRider\(\)/);
 assert.match(source,/await saveRiderEmail\(slot,email\.trim\(\)\)/);
 assert.match(read("apps/rider/lib/rider-profiles.ts"),/expo-secure-store/);
});
test("five cards, password input and password reset still exist",()=>{
 const html=read("rider.html");
 for(let n=1;n<=5;n++)assert.match(html,new RegExp('data-rider-slot="'+n+'"'));
 for(const id of ["riderProfiles","riderProfileHint","riderEmailGroup","forgetRiderDevice","loginForm","password","loginError","setPassword","passwordSetupForm","dashboard","dayCloseSection","toggleGps"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing HTML ID "+id);
 }
 assert.match(html,/docs\/rider-pro-v3\.css/);
 assert.match(html,/docs\/rider-profiles\.js/);
});
test("no generated rider passwords, fake active assignments or production database mutations",()=>{
 const files=["docs/rider-profiles.js","docs/rider-pro-v3.css","apps/rider/lib/rider-profiles.ts"];
 for(const path of files)assert.doesNotMatch(read(path),/TWILIO_AUTH_TOKEN|SUPABASE_SERVICE_ROLE_KEY|INSERT INTO|UPDATE public\.ed_riders/i);
});
